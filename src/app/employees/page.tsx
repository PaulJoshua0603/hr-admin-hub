"use client";

import { useState } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { format } from "date-fns";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import {
  addDaysISO,
  addMonthsISO,
  formatDate,
  formatTime12,
  isOverdue,
  todayISO,
} from "@/lib/dates";
import {
  Button,
  buttonClasses,
  Card,
  FileButton,
  Input,
  Pill,
  SectionHeading,
  StatCard,
  StatusSelect,
  TableWrap,
  Textarea,
  ToolbarDivider,
} from "@/components/ui";
import {
  DEFAULT_WORK_LOCATION,
  EMPLOYMENT_MILESTONE_MONTHS,
  defaultOnboardingChecklist,
  emptyPreEmploymentChecklist,
  emptyRequirements,
  getLackingRequirements,
  getMissingCriticalItems,
  type COERequest,
  type CustomReportTable,
  type Employee,
  type ER2ReportRow,
  type EventReportRow,
  type MilestoneNote,
  regularizationNewGross,
  withNotesTaskListAdditions,
} from "@/types";
import { useNotifications } from "@/lib/notificationContext";
import {
  buildPerformanceEvaluationDocx,
  performanceEvaluationDocxFileName,
} from "@/lib/performanceEvalDocx";
import {
  groupEmployees,
  resignedCoeIndex,
  separationDate as separationDateOf,
} from "@/lib/employeeStatus";
import {
  NOT_SET_LABEL,
  milestoneNoteTone,
  sixthMonthNoteLabels,
  sixthMonthNoteOptions,
  thirdMonthNoteLabels,
  thirdMonthNoteOptions,
} from "@/lib/milestoneNotes";
import { EmployeeNameInput } from "@/components/EmployeeNameInput";
import { employeeNameParts } from "@/lib/employeeNamePdf";
import {
  buildThirdMonthEvaluationDocx,
  thirdMonthEvaluationFileName,
} from "@/lib/thirdMonthEvaluation";

function isProfileComplete(e: Employee): boolean {
  const hasDetails = !!e.birthday && !!e.dateHired;
  const hasCompensation = !!e.basicSalary && !!e.totalMonthlyGrossCompensation;
  const hasIdentification =
    !!e.philhealthNo && !!e.companyIdNumber && !!e.biometricsNo && !!e.realcognitaEmail && !!e.homeAddress;
  const hasRequirements = getLackingRequirements(e).length === 0;
  const hasOnboarding = (e.onboardingChecklist?.length || 0) > 0;
  return hasDetails && hasCompensation && hasIdentification && hasRequirements && hasOnboarding;
}

/**
 * Employee Status values in the HR export that mean the person has left. AWOL belongs
 * here — someone absent without leave has gone, they just have no separation date on
 * record, which is why those rows show "Not yet set". "End of Contract" is deliberately
 * excluded: the source data lists those people among the active staff.
 */
function isSeparatedStatus(status: string): boolean {
  return /resign|terminat|awol/i.test(status.trim());
}

/**
 * Status values known to mean the person is still employed. Anything that is neither
 * these nor a separation status is reported back rather than assumed — an unrecognised
 * value used to count silently as active, so a status this app had never seen would keep
 * someone in the headcount with nothing to show for it.
 */
function isKnownActiveStatus(status: string): boolean {
  return /^(active|regular|probationary|probation|project[- ]based|contractual|consultant|part[- ]time|full[- ]time|trainee|intern)$/i.test(
    status.trim()
  );
}

function isActive(e: Employee): boolean {
  return !e.lastDay && e.resignedStatus !== "resigned";
}

export default function EmployeesPage() {
  const { items: employees, hydrated, add, remove, setItems } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );
  const { notify } = useNotifications();
  const [showForm, setShowForm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPreview, setSyncPreview] = useState<{
    changes: StatusSyncChange[];
    examined: number;
    unmatched: string[];
    /** Status values in the file this app does not recognise, with how often they appear. */
    unknownStatuses: { status: string; count: number }[];
  } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmBulkComplete, setConfirmBulkComplete] = useState(false);
  const [confirmDateFix, setConfirmDateFix] = useState(false);
  const [confirmTaskListSync, setConfirmTaskListSync] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  /** Set once the full name is typed over, so editing the parts stops overwriting it. */
  const [nameEdited, setNameEdited] = useState(false);
  const [isReliever, setIsReliever] = useState(false);
  const [relieverEndDate, setRelieverEndDate] = useState("");
  const [replacedEmployeeName, setReplacedEmployeeName] = useState("");
  const [relieverReason, setRelieverReason] = useState("");
  const [replacedPosition, setReplacedPosition] = useState("");
  const [replacedJobDuties, setReplacedJobDuties] = useState("");
  const [workLocation, setWorkLocation] = useState(DEFAULT_WORK_LOCATION);
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [client, setClient] = useState("");
  const [dateHired, setDateHired] = useState("");


  /**
   * Re-reads the HR export and corrects only employment status and separation date on
   * records that already exist, matched on Employee ID. Everything else on the record is
   * left alone, so this can be re-run against a fresh export without disturbing data
   * that was maintained inside this app.
   */
  type StatusSyncChange = {
    employee: Employee;
    employeeId: string;
    status: string;
    nextResigned: boolean;
    nextLastDay?: string;
    reasons: string[];
  };

  async function handleStatusSync(file: File) {
    setSyncing(true);
    try {
      const XLSX = await import("@e965/xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const byId = new Map<string, Employee>();
      const byName = new Map<string, Employee>();
      employees.forEach((e) => {
        if (e.companyIdNumber) byId.set(String(e.companyIdNumber).trim(), e);
        byName.set(e.name.trim().toLowerCase(), e);
      });

      const changes: StatusSyncChange[] = [];
      const unmatched: string[] = [];
      const unknown = new Map<string, number>();
      let examined = 0;

      for (const row of rows) {
        const employeeId = String(row["Employee ID"] || "").trim();
        const status = String(row["Employee Status"] || "").trim();
        if (!employeeId && !status) continue;

        let name = String(row["Employee Name"] || "").trim();
        if (!name) {
          name = formatFullName(
            String(row["First Name"] || "").trim(),
            String(row["Middle Name"] || "").trim(),
            String(row["Last Name"] || "").trim()
          );
        }
        const employee =
          (employeeId && byId.get(employeeId)) || byName.get(name.trim().toLowerCase());
        if (!employee) {
          if (employeeId || name) unmatched.push(`${employeeId || "no ID"} ${name}`.trim());
          continue;
        }
        examined++;

        const nextResigned = isSeparatedStatus(status);
        if (status && !nextResigned && !isKnownActiveStatus(status)) {
          unknown.set(status, (unknown.get(status) || 0) + 1);
        }
        const nextLastDay = parseExcelDate(row["Separation Date"]);
        const wasResigned = employee.resignedStatus === "resigned" || !!employee.lastDay;
        const reasons: string[] = [];

        if (nextResigned !== wasResigned) {
          reasons.push(nextResigned ? `marked resigned (${status || "no status"})` : "restored to active");
        }
        if ((nextLastDay || "") !== (employee.lastDay || "")) {
          reasons.push(
            nextLastDay
              ? `separation date → ${formatDate(nextLastDay, "MMMM d, yyyy")}`
              : "separation date cleared"
          );
        }
        if (reasons.length > 0) {
          changes.push({ employee, employeeId, status, nextResigned, nextLastDay, reasons });
        }
      }

      const unknownStatuses = [...unknown.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);
      setSyncPreview({ changes, examined, unmatched, unknownStatuses });
      if (changes.length === 0) {
        notify(`Checked ${examined} matching records — everything already matches the file.`, "info");
      }
    } catch {
      notify("Could not read that file. Export it as .xlsx and try again.", "warn");
    } finally {
      setSyncing(false);
    }
  }

  function applyStatusSync() {
    if (!syncPreview) return;
    const next = employees.map((e) => {
      const change = syncPreview.changes.find((c) => c.employee.id === e.id);
      if (!change) return e;
      return {
        ...e,
        resignedStatus: change.nextResigned ? ("resigned" as const) : ("active" as const),
        lastDay: change.nextLastDay,
      };
    });
    setItems(next);
    notify(`Updated status and separation date on ${syncPreview.changes.length} employees`, "updated");
    setSyncPreview(null);
  }

  /**
   * The full name, built from the parts the same way an import builds it ("First M. Last")
   * unless it has been typed over by hand.
   */
  const composedName = formatFullName(firstName, middleName, lastName);
  const effectiveName = nameEdited || !composedName ? name : composedName;

  function handleAdd() {
    const finalName = effectiveName.trim();
    if (!finalName) return;
    const dateAdded = todayISO();
    // No longer asked for on the form; the requirements clock starts the day they're added,
    // and the date can still be set on the employee's own page.
    const sentISO = dateAdded;
    add({
      id: uuid(),
      name: finalName,
      // Kept separately from the display name so forms needing "SURNAME, FIRST MIDDLE"
      // can print the full middle name rather than an initial.
      firstName: firstName.trim() || undefined,
      middleName: middleName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      position: position.trim() || undefined,
      department: department.trim() || undefined,
      client: client.trim() || undefined,
      // Only carried when this is a reliever, so an ordinary hire keeps a clean record.
      isReliever: isReliever || undefined,
      relieverEndDate: isReliever && relieverEndDate ? new Date(relieverEndDate).toISOString() : undefined,
      replacedEmployeeName: isReliever ? replacedEmployeeName.trim() || undefined : undefined,
      relieverReason: isReliever ? relieverReason.trim() || undefined : undefined,
      replacedPosition: isReliever ? replacedPosition.trim() || undefined : undefined,
      replacedJobDuties: isReliever ? replacedJobDuties.trim() || undefined : undefined,
      workLocation: isReliever ? workLocation.trim() || undefined : undefined,
      dateAdded,
      dateRequirementsSent: sentISO,
      dateHired: dateHired ? new Date(dateHired).toISOString() : undefined,
      requirementsDeadline: addDaysISO(sentISO, 14),
      requirements: emptyRequirements(),
      preEmploymentChecklist: emptyPreEmploymentChecklist(),
      onboardingChecklist: defaultOnboardingChecklist(),
      isRegular: false,
    });
    notify(`Employee added: "${finalName}"`, "created");
    setName("");
    setLastName("");
    setFirstName("");
    setMiddleName("");
    setNameEdited(false);
    setIsReliever(false);
    setRelieverEndDate("");
    setReplacedEmployeeName("");
    setRelieverReason("");
    setReplacedPosition("");
    setReplacedJobDuties("");
    setWorkLocation(DEFAULT_WORK_LOCATION);
    setPosition("");
    setDepartment("");
    setClient("");
    setDateHired("");
    setShowForm(false);
  }

  function parseExcelDate(val: unknown): string | undefined {
    if (!val) return undefined;
    if (val instanceof Date) {
      // Re-anchor to UTC midnight using the LOCAL calendar fields the xlsx
      // library gave us, so the imported day never shifts due to timezone.
      return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate())).toISOString();
    }
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!trimmed || /not yet set/i.test(trimmed)) return undefined;
      const d = new Date(trimmed);
      if (isNaN(d.getTime())) return undefined;
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
    }
    if (typeof val === "number") {
      // Excel serial date (days since 1899-12-30), UTC-anchored directly.
      const utcMs = Math.round((val - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      if (isNaN(d.getTime())) return undefined;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    }
    return undefined;
  }

  function toTitleCase(text: string): string {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function formatFullName(first: string, middle: string, last: string): string {
    const firstFormatted = toTitleCase(first);
    const lastFormatted = toTitleCase(last);
    const middleInitial = middle.trim() ? `${middle.trim().charAt(0).toUpperCase()}.` : "";
    return [firstFormatted, middleInitial, lastFormatted].filter(Boolean).join(" ").trim();
  }

  function formatGrossAmount(val: unknown): string | undefined {
    let num: number | undefined;
    if (typeof val === "number") num = val;
    else if (typeof val === "string" && val.trim()) {
      const parsed = parseFloat(val.replace(/,/g, ""));
      if (!isNaN(parsed)) num = parsed;
    }
    if (num === undefined) return undefined;
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function handleImportExcel(file: File) {
    setImporting(true);
    try {
      const XLSX = await import("@e965/xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const imported: Employee[] = [];
      for (const row of rows) {
        const fullNameCol = String(row["Full Name"] || row["Employee Name"] || "").trim();
        const firstName = String(row["First Name"] || "").trim();
        const middleName = String(row["Middle Name"] || "").trim();
        const lastName = String(row["Last Name"] || "").trim();
        let name = fullNameCol;
        if (!name) name = formatFullName(firstName, middleName, lastName);
        if (!name || /^admin\b/i.test(name)) continue;

        const statusRaw = String(row["Employee Status"] || "").trim();
        const resigned = isSeparatedStatus(statusRaw);
        const rawAddress = String(row["Address"] || "")
          .replace(/^\s*Address\s*1:\s*/i, "")
          .replace(/\s*Philippines\.?\s*$/i, "")
          .replace(/\n+/g, " ")
          .trim();
        const dateAdded = todayISO();
        const gross = formatGrossAmount(row["Monthly Gross"]);
        const basicSalary = formatGrossAmount(row["Base Salary"]);
        const lastDay = parseExcelDate(row["Separation Date"]);
        const emailRaw = String(row["Email"] || row["Contact Info"] || "")
          .replace(/^\s*Email:\s*/i, "")
          .trim();

        imported.push({
          id: uuid(),
          name,
          position: String(row["Position"] || "").trim() || undefined,
          department: String(row["Department"] || "").trim() || undefined,
          gender: String(row["Gender"] || "").trim() || undefined,
          birthday: parseExcelDate(row["Birthday"]),
          dateAdded,
          requirementsDeadline: addDaysISO(dateAdded, 14),
          requirements: emptyRequirements(),
          preEmploymentChecklist: emptyPreEmploymentChecklist(),
          onboardingChecklist: defaultOnboardingChecklist(),
          isRegular: statusRaw.toLowerCase() === "regular",
          resignedStatus: resigned ? "resigned" : "active",
          reasonForLeaving: String(row["Reason for Leaving"] || "").trim() || undefined,
          dateHired: parseExcelDate(row["Hire Date"]),
          lastDay,
          homeAddress: rawAddress || undefined,
          homeCity: String(row["City"] || "").trim() || undefined,
          firstName: firstName || undefined,
          middleName: middleName || undefined,
          lastName: lastName || undefined,
          companyIdNumber: String(row["Employee ID"] || "").trim() || undefined,
          biometricsNo: String(row["Biometric ID"] || "").trim() || undefined,
          philhealthNo: String(row["PhilHealth"] || "").trim() || undefined,
          basicSalary: basicSalary,
          totalMonthlyGrossCompensation: gross,
          realcognitaEmail: emailRaw || undefined,
          immediateSupervisor:
            String(row["Immediate Supervisor"] || "").trim() || undefined,
        });
      }

      if (imported.length === 0) {
        notify("No valid rows found to import.", "warn");
        return;
      }

      setItems([...employees, ...imported]);
      notify(`Imported ${imported.length} employee(s) from Excel`, "created");
    } catch (err) {
      notify(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
    } finally {
      setImporting(false);
    }
  }

  /**
   * Fills in the separate Last / Middle / First name columns on records that already
   * exist, matched on Employee ID and falling back to the display name.
   *
   * Records imported before those columns existed only have a display name like
   * "Patricia Mae B. Mallari", and a display name cannot be taken apart reliably — the
   * middle name has already been shortened to an initial, and a surname of two or three
   * words ("San Pedro III", "Dela Cruz") is indistinguishable from a middle name. That is
   * why the ER2 form can only print "MALLARI, PATRICIA MAE B." today. With the real parts
   * on file it prints the full middle name.
   *
   * Only the three name fields are written; the display name and everything else on the
   * record are left exactly as they are.
   */
  async function handleImportNameParts(file: File) {
    setImporting(true);
    try {
      const XLSX = await import("@e965/xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const byId = new Map<string, Record<string, unknown>>();
      const byName = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const id = String(row["Employee ID"] || "").trim();
        if (id) byId.set(id, row);
        const first = String(row["First Name"] || "").trim();
        const middle = String(row["Middle Name"] || "").trim();
        const last = String(row["Last Name"] || "").trim();
        const display = formatFullName(first, middle, last).toLowerCase();
        if (display) byName.set(display, row);
      }

      let matched = 0;
      let withMiddle = 0;
      const updated = employees.map((e) => {
        const row =
          byId.get(String(e.companyIdNumber || "").trim()) || byName.get(e.name.trim().toLowerCase());
        if (!row) return e;
        const firstName = String(row["First Name"] || "").trim();
        const middleName = String(row["Middle Name"] || "").trim();
        const lastName = String(row["Last Name"] || "").trim();
        if (!firstName && !middleName && !lastName) return e;
        matched += 1;
        if (middleName) withMiddle += 1;
        return {
          ...e,
          firstName: firstName || e.firstName,
          middleName: middleName || e.middleName,
          lastName: lastName || e.lastName,
        };
      });

      if (matched === 0) {
        notify(
          "No matching employees found. The file needs Employee ID, Last Name, Middle Name and First Name columns.",
          "warn"
        );
        return;
      }
      setItems(updated);
      notify(
        `Updated name parts on ${matched} employee(s) — ${withMiddle} now carry a full middle name`,
        "updated"
      );
    } catch (err) {
      notify(`Update failed: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportEmailSupervisor(file: File) {
    setImporting(true);
    try {
      const XLSX = await import("@e965/xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      let matched = 0;
      const updated = employees.map((e) => {
        const row = rows.find(
          (r) =>
            String(r["Employee Name"] || "").trim().toLowerCase() === e.name.trim().toLowerCase()
        );
        if (!row) return e;
        const email = String(row["Email"] || "").trim();
        const supervisor = String(row["Immediate Supervisor"] || "").trim();
        if (!email && !supervisor) return e;
        matched += 1;
        return {
          ...e,
          realcognitaEmail: email || e.realcognitaEmail,
          immediateSupervisor: supervisor || e.immediateSupervisor,
        };
      });

      if (matched === 0) {
        notify("No matching employee names found to update.", "warn");
        return;
      }
      setItems(updated);
      notify(`Updated Email/Supervisor for ${matched} employee(s)`, "updated");
    } catch (err) {
      notify(`Update failed: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
    } finally {
      setImporting(false);
    }
  }

  if (!hydrated) return null;

  const duplicateGroups = (() => {
    const byName = new Map<string, Employee[]>();
    employees.forEach((e) => {
      const key = e.name.trim().toLowerCase();
      if (!key) return;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(e);
    });
    return Array.from(byName.values()).filter((group) => group.length > 1);
  })();
  const duplicateCount = duplicateGroups.reduce((sum, g) => sum + g.length - 1, 0);

  function deleteDuplicate(id: string, name: string) {
    remove(id);
    notify(`Duplicate removed: "${name}"`, "deleted");
  }

  function keepNewestDeleteRest(group: Employee[]) {
    const sorted = [...group].sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : -1));
    const [keep, ...rest] = sorted;
    setItems(employees.filter((e) => !rest.some((r) => r.id === e.id)));
    notify(`Kept "${keep.name}" (newest), removed ${rest.length} duplicate(s)`, "deleted");
  }

  function deleteAllEmployees() {
    setItems([]);
    notify(`Deleted all ${employees.length} employee(s)`, "deleted");
    setConfirmDeleteAll(false);
  }

  const SEPTEMBER_EXCLUDED_NAMES = [
    "Wilmar L. Gonzales",
    "Mark Joseph M. Cabalquinto",
    "Hazel E. Bayani",
    "Maria Elena S. Mirador",
    "Rachelle Jade A. Pedron",
    "Elaiza Laceda",
    "Precious G. Abalos",
  ].map((n) => n.trim().toLowerCase());

  function bulkMarkComplete() {
    const now = todayISO();
    const updated = employees.map((e) => {
      if (SEPTEMBER_EXCLUDED_NAMES.includes(e.name.trim().toLowerCase())) return e;
      return {
        ...e,
        requirements: { listOfRequirements: "complete", preEmploymentMedical: "complete" } as Employee["requirements"],
        requirementsCompletedAt: now,
        onboardingChecklist: (e.onboardingChecklist || []).map((cat) => ({
          ...cat,
          items: cat.items.map((it) => ({ ...it, checked: true })),
        })),
      };
    });
    setItems(updated);
    notify(
      `Marked requirements/onboarding complete for existing employees (excluded ${SEPTEMBER_EXCLUDED_NAMES.length} September hires)`,
      "updated"
    );
    setConfirmBulkComplete(false);
  }

  function bulkSyncTaskLists() {
    let added = 0;
    const updated = employees.map((e) => {
      const before = (e.onboardingChecklist || []).reduce((n, c) => n + c.items.length, 0);
      const onboardingChecklist = withNotesTaskListAdditions(e.onboardingChecklist || []);
      added += onboardingChecklist.reduce((n, c) => n + c.items.length, 0) - before;
      return { ...e, onboardingChecklist };
    });
    setItems(updated);
    notify(
      added
        ? `Added ${added} missing task list item(s) across ${employees.length} employee(s)`
        : "Every employee already has the full task list",
      added ? "updated" : "info"
    );
    setConfirmTaskListSync(false);
  }

  function bulkFixDateShift() {
    function plusOneDay(iso?: string): string | undefined {
      if (!iso) return iso;
      const d = new Date(iso);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString();
    }
    const updated = employees.map((e) => ({
      ...e,
      birthday: plusOneDay(e.birthday),
      dateHired: plusOneDay(e.dateHired),
      lastDay: plusOneDay(e.lastDay),
      dateRequirementsSent: plusOneDay(e.dateRequirementsSent),
      lastPayDate: plusOneDay(e.lastPayDate),
    }));
    setItems(updated);
    notify(`Corrected date shift (+1 day) for ${employees.length} employee(s)`, "updated");
    setConfirmDateFix(false);
  }

  function statusOf(e: Employee) {
    const complete = Object.values(e.requirements).every(
      (s) => s === "complete"
    );
    if (complete) return { tone: "success" as const, label: "Complete" };
    if (isOverdue(e.requirementsDeadline))
      return { tone: "warn" as const, label: "Overdue" };
    return { tone: "accent" as const, label: "In progress" };
  }

  return (
    <div>
      <SectionHeading
        title="Employees"
        subtitle={`${employees.length} employee${employees.length === 1 ? "" : "s"} on file. Onboarding requirements, milestones, and regularization tracking.`}
        toolbar={
          <>
            {/* Everyday action first, then the data tools, then the destructive ones set
                apart — so "Delete all employees" is never a neighbour of a routine button. */}
            <Button onClick={() => setShowForm((s) => !s)}>+ Add employee</Button>

            <ToolbarDivider />

            <FileButton
              accept=".xlsx,.xls"
              disabled={importing}
              onFile={handleImportExcel}
              title="Add or update employee records from an HR export"
            >
              {importing ? "Importing…" : "Import from Excel"}
            </FileButton>
            <FileButton
              accept=".xlsx,.xls"
              disabled={importing}
              onFile={handleImportEmailSupervisor}
              title="Fill in company email and immediate supervisor on existing records"
            >
              {importing ? "Updating…" : "Update email / supervisor"}
            </FileButton>
            <FileButton
              accept=".xlsx,.xls"
              disabled={importing}
              onFile={handleImportNameParts}
              title="Fill in Last / Middle / First name on existing records so forms can print the full middle name"
            >
              {importing ? "Updating…" : "Update full names"}
            </FileButton>
            <FileButton
              accept=".xlsx,.xls"
              disabled={syncing}
              onFile={handleStatusSync}
              title="Re-read the HR export and correct employment status and separation dates"
            >
              {syncing ? "Checking…" : "Sync status / separation dates"}
            </FileButton>

            {duplicateCount > 0 && (
              <Button variant="ghost" onClick={() => setShowDuplicates((s) => !s)}>
                ⚠ {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"}
              </Button>
            )}

            {employees.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {confirmBulkComplete ? (
                  <>
                    <Button variant="danger" onClick={bulkMarkComplete}>
                      Confirm mark all complete
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmBulkComplete(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmBulkComplete(true)}>
                    Mark all complete
                  </Button>
                )}

                {confirmTaskListSync ? (
                  <>
                    <Button variant="danger" onClick={bulkSyncTaskLists}>
                      Confirm add task list items
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmTaskListSync(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmTaskListSync(true)}
                    title="Adds any standard Notes / Task List item an employee is missing, keeping their ticks and their own additions"
                  >
                    Sync onboarding task lists
                  </Button>
                )}

                {confirmDateFix ? (
                  <>
                    <Button variant="danger" onClick={bulkFixDateShift}>
                      Confirm +1 day fix
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDateFix(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmDateFix(true)}>
                    Fix date shift (+1 day)
                  </Button>
                )}

                <ToolbarDivider />

                {confirmDeleteAll ? (
                  <>
                    <Button variant="danger" onClick={deleteAllEmployees}>
                      Confirm delete all ({employees.length})
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDeleteAll(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="danger" onClick={() => setConfirmDeleteAll(true)}>
                    Delete all employees
                  </Button>
                )}
              </div>
            )}
          </>
        }
      />

      {syncPreview && (
        <Card className="mb-6 border-accent">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Status sync — {syncPreview.changes.length} record
                {syncPreview.changes.length === 1 ? "" : "s"} will change
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Matched {syncPreview.examined} employees by Employee ID. Only employment status and
                separation date are touched; nothing else on the record is altered.
                {syncPreview.unmatched.length > 0 &&
                  ` ${syncPreview.unmatched.length} row${
                    syncPreview.unmatched.length === 1 ? "" : "s"
                  } in the file had no matching employee and were skipped.`}
              </p>
              {syncPreview.unknownStatuses.length > 0 && (
                <p className="mt-2 text-xs text-warn">
                  Unrecognised Employee Status value
                  {syncPreview.unknownStatuses.length === 1 ? "" : "s"} in this file, left as
                  active:{" "}
                  {syncPreview.unknownStatuses
                    .map((u) => `"${u.status}" (${u.count})`)
                    .join(", ")}
                  . If any of these mean the person has left, tell me and I will add them.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={applyStatusSync} disabled={syncPreview.changes.length === 0}>
                Apply {syncPreview.changes.length} change
                {syncPreview.changes.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" onClick={() => setSyncPreview(null)}>
                Cancel
              </Button>
            </div>
          </div>

          {syncPreview.changes.length > 0 && (
            <TableWrap className="mt-3" maxHeight="24rem">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2">Employee ID</th>
                    <th className="px-3 py-2">Employee Name</th>
                    <th className="px-3 py-2">Status in file</th>
                    <th className="px-3 py-2">What changes</th>
                  </tr>
                </thead>
                <tbody>
                  {syncPreview.changes.map((c) => (
                    <tr key={c.employee.id} className="border-t border-border">
                      <td className="px-3 py-2 text-ink-muted">{c.employeeId || "—"}</td>
                      <td className="px-3 py-2 text-ink">{c.employee.name}</td>
                      <td className="px-3 py-2">
                        <Pill tone={c.nextResigned ? "warn" : "success"}>{c.status || "—"}</Pill>
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{c.reasons.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      <EmployeeCountSummary employees={employees} />

      <AdvancedFilterView employees={employees} />
      <CentralizedCOETracker employees={employees} />

      {showDuplicates && duplicateGroups.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-1 text-sm font-semibold text-ink">
            Duplicate names ({duplicateGroups.length} group{duplicateGroups.length === 1 ? "" : "s"})
          </h2>
          <p className="mb-3 text-xs text-ink-muted">
            Employees sharing the exact same name (case-insensitive). Delete the ones you don&apos;t need.
          </p>
          <div className="flex flex-col gap-4">
            {duplicateGroups.map((group, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">{group[0].name}</p>
                  <button
                    onClick={() => keepNewestDeleteRest(group)}
                    className="text-xs text-accent hover:underline"
                  >
                    Keep newest, delete rest
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {group.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link href={`/employees/${e.id}`} className="min-w-0 truncate text-ink hover:text-accent">
                        {[e.position, e.department].filter(Boolean).join(" · ") || "No details"} — added{" "}
                        {formatDate(e.dateAdded)}
                      </Link>
                      <button
                        onClick={() => deleteDuplicate(e.id, e.name)}
                        className="shrink-0 text-xs text-warn hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showForm && (
        <Card className="mb-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Last Name
              <Input
                placeholder="e.g. Bayani"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              First Name
              <Input
                placeholder="e.g. Hazel"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Middle Name
              <Input
                placeholder="e.g. Enteria"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted sm:col-span-3">
              Full Name
              <Input
                placeholder="Fills in from the three names above"
                value={effectiveName}
                onChange={(e) => {
                  setNameEdited(true);
                  setName(e.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Position
              <Input
                placeholder="Position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Department
              <Input
                placeholder="Department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Client
              <Input
                placeholder="Client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Hired/Onboarding Date
              <Input
                type="date"
                value={dateHired}
                onChange={(e) => setDateHired(e.target.value)}
              />
            </label>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={isReliever}
              onChange={(e) => setIsReliever(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            Reliever — this employee is temporarily covering for someone
          </label>

          {isReliever && (
            <div className="mt-3 grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                End date of the reliever assignment
                <Input
                  type="date"
                  value={relieverEndDate}
                  onChange={(e) => setRelieverEndDate(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Employee being replaced
                <EmployeeNameInput
                  placeholder="Full name of the employee being covered"
                  value={replacedEmployeeName}
                  onChange={setReplacedEmployeeName}
                  onSelect={(picked) => {
                    setReplacedEmployeeName(picked.name);
                    // The position being covered is that employee's own, so it is filled
                    // in — but only when blank, never over something already typed.
                    if (!replacedPosition.trim() && picked.position) setReplacedPosition(picked.position);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Position being replaced
                <Input
                  placeholder="e.g. Quantity Surveyor"
                  value={replacedPosition}
                  onChange={(e) => setReplacedPosition(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Reason for the replacement
                <Input
                  placeholder="e.g. Maternity leave"
                  value={relieverReason}
                  onChange={(e) => setRelieverReason(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted sm:col-span-2">
                Job duties of the position being replaced
                <Textarea
                  rows={3}
                  placeholder="Printed under Scope of Work on the temporary contract"
                  value={replacedJobDuties}
                  onChange={(e) => setReplacedJobDuties(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted sm:col-span-2">
                Work location
                <select
                  value={workLocation === DEFAULT_WORK_LOCATION ? DEFAULT_WORK_LOCATION : "other"}
                  onChange={(e) =>
                    setWorkLocation(e.target.value === DEFAULT_WORK_LOCATION ? DEFAULT_WORK_LOCATION : "")
                  }
                  className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-ink"
                >
                  <option value={DEFAULT_WORK_LOCATION}>{DEFAULT_WORK_LOCATION}</option>
                  <option value="other">Other — type it below</option>
                </select>
                {workLocation !== DEFAULT_WORK_LOCATION && (
                  <Input
                    placeholder="Type the work location"
                    value={workLocation}
                    onChange={(e) => setWorkLocation(e.target.value)}
                  />
                )}
              </label>
            </div>
          )}

          <p className="mt-2 text-xs text-ink-muted">
            Full Name fills in from Last / First / Middle as &ldquo;First M. Last&rdquo; — type over
            it if this person is written differently. The three names are stored separately so the
            ER2 PhilHealth form can print the full middle name instead of an initial. Everything
            entered here can be seen and edited later by clicking the employee&apos;s name.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={handleAdd}>Save employee</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {employees.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
            No employees added yet.
          </div>
        )}
        {[...employees]
          .sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : a.dateAdded > b.dateAdded ? -1 : 0))
          .map((e) => {
          const status = statusOf(e);
          const missingCritical = getMissingCriticalItems(e);

          return (
            <Card key={e.id} className="flex items-center justify-between hover:border-accent transition-colors">
              <Link href={`/employees/${e.id}`} className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{e.name}</p>
                <p className="text-xs text-ink-muted">
                  {[e.position, e.department].filter(Boolean).join(" · ") || "—"}
                </p>
                {missingCritical.length > 0 && (
                  <p className="mt-1 text-xs text-warn">
                    Missing: {missingCritical.join(", ")}
                  </p>
                )}
              </Link>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-muted">
                  Requirements due {formatDate(e.requirementsDeadline)}
                </span>
                <Pill tone={isProfileComplete(e) ? "success" : "warn"}>
                  {isProfileComplete(e) ? "Profile complete" : "Profile incomplete"}
                </Pill>
                <Pill tone={isActive(e) ? "accent" : "neutral"}>
                  {isActive(e) ? "Active" : "Inactive"}
                </Pill>
                <Pill tone={status.tone}>{status.label}</Pill>
                {/* Name, position, department and client are all edited on the employee's
                    own page now, under Employee details, alongside everything else. */}
                <Link href={`/employees/${e.id}`} className={buttonClasses("ghost")}>
                  Edit details
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------- Advanced Filtering & Views ------------------------- */

type CountGroup = "current" | "newHires" | "resigned";

/** Whoever has not yet reached the 6th-month milestone from their hire date. */
function isUnderProbation(e: Employee, now: Date = new Date()): boolean {
  if (!e.dateHired) return false;
  const sixthMonth = new Date(addMonthsISO(e.dateHired, EMPLOYMENT_MILESTONE_MONTHS.sixthMonth));
  return sixthMonth.getTime() > now.getTime();
}

/**
 * Three sheets: Current Employees (with a New Hires section beneath its total), employees
 * still under their 6-month probationary period, and Resigned Employees. The full name
 * prints as one column — a reader filing this by hand wants "Juan Dela Cruz", not three
 * cells to reassemble — and rows within a sheet are still ordered by surname, because that
 * is the order a personnel file is kept in even when the column itself is not split.
 */
async function exportEmployeeCounts(
  current: Employee[],
  newHires: Employee[],
  resigned: Employee[],
  coeIndex: Map<string, string>
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  type Sheet = ReturnType<InstanceType<typeof ExcelJS.Workbook>["addWorksheet"]>;

  const bySurname = (a: Employee, b: Employee) =>
    employeeNameParts(a).surname.localeCompare(employeeNameParts(b).surname);
  // "Dela Cruz, Juan P." — the one column reads in filing order, in normal case rather
  // than the all-caps the folder label uses.
  const filingName = (e: Employee) => {
    const { surname, first, middleInitial } = employeeNameParts(e);
    if (!surname) return e.name || "";
    return [`${surname},`, first, middleInitial].filter(Boolean).join(" ");
  };

  const BASE_COLUMNS = [
    { header: "Employee ID", width: 14 },
    { header: "Full Name", width: 30 },
    { header: "Last Name", width: 18 },
    { header: "Middle Name", width: 18 },
    { header: "First Name", width: 20 },
    { header: "Department", width: 20 },
    { header: "Immediate Supervisor", width: 24 },
  ];

  // The split name columns prefer what was entered in Employee details; older records
  // that only carry a full name fall back to reading it apart (middle initial at best).
  const nameColumns = (e: Employee) => {
    const parts = employeeNameParts(e);
    return [
      e.lastName?.trim() || parts.surname,
      e.middleName?.trim() || parts.middleInitial,
      e.firstName?.trim() || parts.first,
    ];
  };

  function addRows(ws: Sheet, rows: Employee[], dateLabel: string, extra?: string) {
    const columns = [...BASE_COLUMNS, { header: dateLabel, width: 18 }];
    if (extra) columns.push({ header: extra, width: 20 });
    ws.columns = columns.map((c) => ({ width: c.width }));

    const header = ws.addRow(columns.map((c) => c.header));
    header.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
    });

    [...rows].sort(bySurname).forEach((e) => {
      const row = [
        e.companyIdNumber || "",
        filingName(e),
        ...nameColumns(e),
        e.department || "",
        e.immediateSupervisor || "",
        e.dateHired ? formatDate(e.dateHired, "MMMM d, yyyy") : "",
      ];
      if (extra) {
        const sep = separationDateOf(e, coeIndex);
        row.push(sep ? formatDate(sep, "MMMM d, yyyy") : "");
      }
      ws.addRow(row);
    });
  }

  // Current Employees: the active roster, its total, then New Hires as a second section
  // on the same sheet rather than a sheet of their own.
  const currentSheet = wb.addWorksheet("Current Employees");
  addRows(currentSheet, current, "Date Hired");
  currentSheet.addRow([]);
  const currentTotal = currentSheet.addRow([`Total Current Employees: ${current.length}`]);
  currentTotal.getCell(1).font = { bold: true };
  currentSheet.addRow([]);
  const newHireTitle = currentSheet.addRow([`New Hires (${newHires.length})`]);
  newHireTitle.getCell(1).font = { bold: true, color: { argb: "FF0A2E2A" } };
  newHireTitle.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
  addRows(currentSheet, newHires, "Date Hired");
  currentSheet.addRow([]);
  const newHireTotal = currentSheet.addRow([`Total New Hires: ${newHires.length}`]);
  newHireTotal.getCell(1).font = { bold: true };

  // Under 6-Month Probation: already working, but short of the milestone that ends it.
  const probationary = current.filter((e) => isUnderProbation(e));
  const probationSheet = wb.addWorksheet("Under 6-Month Probation");
  addRows(probationSheet, probationary, "Date Hired");
  probationSheet.addRow([]);
  const probationTotal = probationSheet.addRow([`Total: ${probationary.length}`]);
  probationTotal.getCell(1).font = { bold: true };

  // Resigned Employees.
  const resignedSheet = wb.addWorksheet("Resigned Employees");
  addRows(resignedSheet, resigned, "Date Hired", "Date of Resignation");
  resignedSheet.addRow([]);
  const resignedTotal = resignedSheet.addRow([`Total: ${resigned.length}`]);
  resignedTotal.getCell(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Employees - ${format(new Date(), "MMMM d, yyyy")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return current.length + newHires.length + resigned.length;
}

function EmployeeCountSummary({ employees }: { employees: Employee[] }) {
  const [openGroup, setOpenGroup] = useState<CountGroup | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const { items: coeRequests } = useSupabaseStore<COERequest>("hr_coe_requests", []);
  const { notify } = useNotifications();

  // Same split the Active/Resigned view uses, so the two screens cannot disagree.
  const { active: current, newHires, resigned, coeIndex } = groupEmployees(employees, coeRequests);

  const groups: { key: CountGroup; label: string; list: Employee[] }[] = [
    { key: "current", label: "Current Employees", list: current },
    { key: "newHires", label: "New Hires (future onboarding date)", list: newHires },
    { key: "resigned", label: "Resigned Employees", list: resigned },
  ];

  function toggle(key: CountGroup) {
    setSearch("");
    setOpenGroup((prev) => (prev === key ? null : key));
  }

  const active = groups.find((g) => g.key === openGroup);
  const term = search.trim().toLowerCase();
  const visible = active
    ? [...active.list]
        .filter((e) =>
          !term
            ? true
            : [e.name, e.position, e.department].some((v) => (v || "").toLowerCase().includes(term))
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {groups.map((g) => (
          <StatCard
            key={g.key}
            value={g.list.length}
            label={g.label}
            hint={openGroup === g.key ? "Hide list" : "View list"}
            active={openGroup === g.key}
            onClick={() => toggle(g.key)}
          />
        ))}
      </div>

      <Button
        onClick={async () => {
          setExporting(true);
          try {
            const count = await exportEmployeeCounts(current, newHires, resigned, coeIndex);
            notify(`Exported ${count} employee(s) across 3 sheets`, "created");
          } finally {
            setExporting(false);
          }
        }}
        disabled={exporting}
        className="mt-3"
        title="One sheet each for Current Employees, New Hires, and Resigned Employees"
      >
        {exporting ? "Exporting…" : "Export to Excel"}
      </Button>

      {active && (
        <Card className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">
              {active.label} — {visible.length}
              {term ? ` of ${active.list.length}` : ""}
            </h2>
            <div className="flex items-center gap-2">
              <div className="w-64">
                <Input
                  placeholder="Search name, position, department"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="ghost" onClick={() => setOpenGroup(null)}>
                Close
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-ink-muted">No employees to show.</p>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto">
              <div className="flex flex-col gap-1">
                {visible.map((e) => (
                  <Link
                    key={e.id}
                    href={`/employees/${e.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:border-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{e.name}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {[e.position, e.department].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {active.key === "resigned"
                        ? e.lastDay
                          ? `Last day ${formatDate(e.lastDay)}`
                          : "Resigned"
                        : e.dateHired
                          ? `${active.key === "newHires" ? "Onboarding" : "Hired"} ${formatDate(e.dateHired)}`
                          : "—"}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

type FilterCategory = "milestones" | "newHires";
type MilestoneType = "birthday" | "relieverEnd" | "third" | "sixth" | "oneYear";
type TimeframePreset = "week" | "month" | "year" | "custom";

type FilterRow = {
  id: string;
  name: string;
  position: string;
  department: string;
  email: string;
  supervisor: string;
  date: string; // ISO
  /** Only on a Reliever Contract row: who and what the reliever is standing in for. */
  replacedName?: string;
  replacedReason?: string;
  replacedPosition?: string;
  /** Only on a Resigned row: why they left, when the system can say. */
  reason?: string;
  /**
   * The date to show, when it differs from the one the row is filtered and sorted on — a
   * birthday row is placed by this year's occurrence but shows the birthday as recorded.
   */
  displayDate?: string;
};

/**
 * This year's occurrence of a birthday, as the same UTC-midnight form every stored date
 * uses. Built from the UTC day and month on purpose: rebuilding it as local midnight and
 * converting back lands on the previous day anywhere east of UTC, which is how a 28
 * September birthday was showing as the 27th.
 */
function birthdayThisYear(birthday: string, year: number): string {
  const b = new Date(birthday);
  return new Date(Date.UTC(year, b.getUTCMonth(), b.getUTCDate())).toISOString();
}

function inRange(iso: string, start: string, end: string): boolean {
  const d = iso.slice(0, 10);
  return d >= start && d <= end;
}

function startOfWeekISO(base: Date): string {
  const day = base.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  const monday = new Date(base);
  monday.setDate(base.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}
function endOfWeekISO(base: Date): string {
  const start = startOfWeekISO(base);
  const d = new Date(start);
  d.setDate(d.getDate() + 4); // Monday + 4 = Friday
  return d.toISOString().slice(0, 10);
}
function startOfMonthISO(base: Date): string {
  return new Date(base.getFullYear(), base.getMonth(), 1).toISOString().slice(0, 10);
}
function endOfMonthISO(base: Date): string {
  return new Date(base.getFullYear(), base.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function startOfYearISO(base: Date): string {
  return new Date(base.getFullYear(), 0, 1).toISOString().slice(0, 10);
}
function endOfYearISO(base: Date): string {
  return new Date(base.getFullYear(), 11, 31).toISOString().slice(0, 10);
}

function ddmmyyyy(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function spelledOut(iso: string): string {
  if (!iso) return "";
  return formatDate(iso, "MMMM d, yyyy");
}

const MILESTONE_LABELS: Record<MilestoneType, string> = {
  birthday: "Birthday",
  relieverEnd: "Reliever Contract",
  third: "3rd Month",
  sixth: "6th Month",
  oneYear: "1 Year",
};

function AdvancedFilterView({ employees }: { employees: Employee[] }) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<FilterCategory>("milestones");
  const [milestoneType, setMilestoneType] = useState<MilestoneType>("birthday");
  const today = new Date();
  const [preset, setPreset] = useState<TimeframePreset>("month");
  const [startDate, setStartDate] = useState(startOfMonthISO(today));
  const [endDate, setEndDate] = useState(endOfMonthISO(today));
  const [exporting, setExporting] = useState(false);
  const { notify } = useNotifications();
  const { items: milestoneNotes, add: addNote, update: updateNote } = useSupabaseStore<MilestoneNote>(
    "hr_milestone_notes",
    []
  );
  // Same store the Centralized COE Tracker writes, so a COE for Resigned added there
  // shows up in the Resigned Employees list here without any copying between the two.
  const { items: coeRequests } = useSupabaseStore<COERequest>("hr_coe_requests", []);
  const { update: updateEmployee } = useSupabaseStore<Employee>("hr_employees", []);

  function noteFor(employeeId: string, type: MilestoneType): string {
    const n = milestoneNotes.find((m) => m.employeeId === employeeId && m.milestoneType === type);
    return n?.note || "";
  }

  function setNoteFor(employeeId: string, type: MilestoneType, value: string) {
    const existing = milestoneNotes.find((m) => m.employeeId === employeeId && m.milestoneType === type);
    if (existing) {
      updateNote(existing.id, { note: value });
    } else {
      addNote({ id: `${employeeId}-${type}`, employeeId, milestoneType: type, note: value });
    }
  }

  // Shared classification — the same split the Employees count cards use.
  const coeIndex = resignedCoeIndex(coeRequests);

  /**
   * The blank Performance Evaluation form, uploaded once and reused for everyone.
   *
   * A quarter-megabyte, and this page — the one people land on — used to pull it down on
   * every visit whether or not the 6th Month tab, the only place it is used, was ever
   * opened. `autoLoad` only fires once that tab actually is.
   */
  const { items: perfTemplates, setItems: setPerfTemplates } = useSupabaseStore<{
    id: string;
    dataUrl: string;
    fileName: string;
    uploadedAt: string;
  }>("hr_perf_eval_docx_template", [], {
    autoLoad: category === "milestones" && milestoneType === "sixth",
  });
  const perfTemplate = perfTemplates[0];
  const [perfBusyId, setPerfBusyId] = useState<string | null>(null);
  const [thirdBusyId, setThirdBusyId] = useState<string | null>(null);

  async function uploadPerfTemplate(file: File) {
    // A Word form, because the filled evaluation goes out as Word for people to edit.
    if (!/.docx$/i.test(file.name)) {
      notify("The Performance Evaluation template needs to be a Word (.docx) file.", "warn");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      notify("That file is over 8MB — save a lighter copy and try again.", "warn");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
    setPerfTemplates([
      { id: "template", dataUrl, fileName: file.name, uploadedAt: todayISO() },
    ]);
    notify(`Performance Evaluation template saved (${file.name})`, "created");
  }

  /**
   * The blank 3rd Month Probationary Evaluation, as a Word file. Loaded on the same terms
   * as the 6th-month one: only once the tab that uses it is open.
   */
  const { items: thirdTemplates, setItems: setThirdTemplates } = useSupabaseStore<{
    id: string;
    dataUrl: string;
    fileName: string;
    uploadedAt: string;
  }>("hr_third_month_eval_template", [], {
    autoLoad: category === "milestones" && milestoneType === "third",
  });
  const thirdTemplate = thirdTemplates[0];

  async function uploadThirdTemplate(file: File) {
    if (!/\.docx$/i.test(file.name)) {
      notify("The 3rd Month evaluation template needs to be a Word (.docx) file.", "warn");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      notify("That file is over 8MB — save a lighter copy and try again.", "warn");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
    setThirdTemplates([{ id: "template", dataUrl, fileName: file.name, uploadedAt: todayISO() }]);
    notify(`3rd Month evaluation template saved (${file.name})`, "created");
  }

  /** Puts one employee's name on the 3rd-month form and downloads it as Word. */
  async function downloadThirdEval(row: FilterRow) {
    if (!thirdTemplate) {
      notify("Upload the blank 3rd Month Evaluation (.docx) first.", "warn");
      return;
    }
    const employee = employees.find((e) => e.id === row.id);
    if (!employee) return;
    setThirdBusyId(row.id);
    try {
      const result = await buildThirdMonthEvaluationDocx(thirdTemplate.dataUrl, employee);
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = thirdMonthEvaluationFileName(employee.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(
        result.named
          ? `3rd Month Evaluation ready for ${employee.name}`
          : "Downloaded, but the template has no “NAME:” line — the name will need writing in.",
        result.named ? "created" : "warn"
      );
    } catch (err) {
      notify(
        `Could not build the form: ${err instanceof Error ? err.message : "Unknown error"}`,
        "warn"
      );
    } finally {
      setThirdBusyId(null);
    }
  }

  /** Fills the template for one employee and downloads it under their name. */
  async function downloadPerfEval(row: FilterRow) {
    if (!perfTemplate) {
      notify("Upload the blank Performance Evaluation (Word) first.", "warn");
      return;
    }
    const employee = employees.find((e) => e.id === row.id);
    if (!employee) return;
    setPerfBusyId(row.id);
    try {
      const result = await buildPerformanceEvaluationDocx(perfTemplate.dataUrl, {
        fullName: employee.name,
        department: employee.department || "",
        position: employee.position || "",
        dateEmployed: employee.dateHired ? formatDate(employee.dateHired, "MMMM d, yyyy") : "",
        // The "To" of the period covered is the 6th-month milestone shown in this table.
        sixthMonth: formatDate(row.date, "MMMM d, yyyy"),
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = performanceEvaluationDocxFileName(employee.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (result.missing.length > 0) {
        notify(
          `Downloaded, but these fields were not found in the template: ${result.missing.join(", ")}. Check it is the blank form.`,
          "warn"
        );
      } else {
        notify(`Performance Evaluation ready for ${employee.name}`, "created");
      }
    } catch (err) {
      notify(`Could not build the form: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
    } finally {
      setPerfBusyId(null);
    }
  }

  const separationDate = (e: Employee) => separationDateOf(e, coeIndex);

  function toFilterRow(e: Employee, date: string): FilterRow {
    return {
      id: e.id,
      name: e.name,
      position: e.position || "",
      department: e.department || "",
      email: e.realcognitaEmail || "",
      supervisor: e.immediateSupervisor || "",
      date,
    };
  }

  const rows: FilterRow[] = (() => {
    if (category === "newHires") {
      return employees
        .filter((e) => e.dateHired && inRange(e.dateHired, startDate, endDate))
        .map((e) => ({
          id: e.id,
          name: e.name,
          position: e.position || "",
          department: e.department || "",
          email: e.realcognitaEmail || "",
          supervisor: e.immediateSupervisor || "",
          date: e.dateHired!,
        }));
    }
    // milestones
    if (milestoneType === "birthday") {
      return employees
        .filter((e) => e.birthday && separationDate(e) === null && inRange(birthdayThisYear(e.birthday, today.getFullYear()), startDate, endDate))
        .map((e) => ({
          id: e.id,
          name: e.name,
          position: e.position || "",
          department: e.department || "",
          email: e.realcognitaEmail || "",
          supervisor: e.immediateSupervisor || "",
          // Filtered and sorted on this year's occurrence, but shown as recorded.
          date: birthdayThisYear(e.birthday!, today.getFullYear()),
          displayDate: e.birthday,
        }));
    }
    if (milestoneType === "relieverEnd") {
      // Driven by the date entered on the reliever engagement, not by the hire date.
      return employees
        .filter((e) => e.isReliever && e.relieverEndDate && !e.lastDay)
        .map((e) => ({
          id: e.id,
          name: e.name,
          position: e.position || "",
          department: e.department || "",
          email: e.realcognitaEmail || "",
          supervisor: e.immediateSupervisor || "",
          date: new Date(e.relieverEndDate!).toISOString(),
          replacedName: e.replacedEmployeeName || "",
          replacedReason: e.relieverReason || "",
          replacedPosition: e.replacedPosition || "",
        }))
        .filter((r) => inRange(r.date, startDate, endDate));
    }
    const monthsMap: Record<MilestoneType, number> = { birthday: 0, relieverEnd: 0, third: 3, sixth: 6, oneYear: 12 };
    const months = monthsMap[milestoneType];
    return employees
      .filter((e) => e.dateHired && !e.lastDay)
      .map((e) => {
        const d = new Date(e.dateHired!);
        d.setMonth(d.getMonth() + months);
        return {
          id: e.id,
          name: e.name,
          position: e.position || "",
          department: e.department || "",
          email: e.realcognitaEmail || "",
          supervisor: e.immediateSupervisor || "",
          date: d.toISOString(),
        };
      })
      .filter((r) => inRange(r.date, startDate, endDate));
  })().sort((a, b) => (a.date < b.date ? -1 : 1));

  const isMilestoneView = category === "milestones";
  const isRelieverView = isMilestoneView && milestoneType === "relieverEnd";
  const dateColumnLabel =
    category === "newHires"
      ? "Hired Date"
      : isRelieverView
        ? "Reliever Contract End Date"
        : MILESTONE_LABELS[milestoneType];

  function exportFileName(): string {
    const monday = new Date(startDate);
    const friday = new Date(endDate);
    if (preset === "week") {
      const sameMonth = monday.getMonth() === friday.getMonth();
      const coverage = sameMonth
        ? `${format(monday, "MMMM d")}-${format(friday, "d, yyyy")}`
        : `${format(monday, "MMMM d")}-${format(friday, "MMMM d, yyyy")}`;
      return `Employee Milestones - ${coverage}`;
    }
    if (preset === "year") {
      return `Employee Milestones - ${monday.getFullYear()}`;
    }
    return `Employee Milestones - ${format(monday, "MMMM yyyy")}`;
  }

  function dynamicFileName(prefix: string): string {
    const monday = new Date(startDate);
    const friday = new Date(endDate);
    if (preset === "week") {
      const sameMonth = monday.getMonth() === friday.getMonth();
      const coverage = sameMonth
        ? `${format(monday, "MMMM")}${format(monday, "dd")}-${format(friday, "dd, yyyy")}`
        : `${format(monday, "MMMM dd")}-${format(friday, "MMMM dd, yyyy")}`;
      return `${prefix}-${coverage}`;
    }
    if (preset === "year") return `${prefix}-${monday.getFullYear()}`;
    return `${prefix}-${format(monday, "MMMM, yyyy")}`;
  }

  /**
   * New hires in the selected date range, earliest hire first, on one sheet named for
   * the month the range starts in.
   */
  async function handleExportNewHires() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      // One sheet for the selected range, named for its month: "September New Hires",
      // titled "September 2026 New Hires".
      const rangeStart = new Date(`${startDate}T00:00:00`);
      const ws = wb.addWorksheet(`${format(rangeStart, "MMMM")} New Hires`);
      ws.columns = [{ width: 8 }, { width: 30 }, { width: 24 }, { width: 22 }, { width: 20 }];

      const titleRow = ws.addRow([`${format(rangeStart, "MMMM yyyy")} New Hires`]);
      ws.mergeCells(titleRow.number, 1, titleRow.number, 5);
      titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: "FF0A2E2A" } };
      titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
      titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

      const headerRow = ws.addRow(["No.", "Employee Name", "Position", "Department", "Hired Date"]);
      headerRow.eachCell((c) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
      });

      const newHires = employees
        .filter((e) => e.dateHired && inRange(e.dateHired, startDate, endDate))
        .sort((a, b) => (a.dateHired! < b.dateHired! ? -1 : a.dateHired! > b.dateHired! ? 1 : 0));
      // "No." is how many started on that same day, not a running count.
      const hiredOnDay = new Map<string, number>();
      newHires.forEach((e) => {
        const day = e.dateHired!.slice(0, 10);
        hiredOnDay.set(day, (hiredOnDay.get(day) || 0) + 1);
      });
      newHires.forEach((e) =>
        ws.addRow([
          hiredOnDay.get(e.dateHired!.slice(0, 10)) || 0,
          e.name,
          e.position || "",
          e.department || "",
          formatDate(e.dateHired!, "MMMM d, yyyy"),
        ])
      );
      ws.addRow([]);
      const totalRow = ws.addRow([`Total: ${newHires.length}`]);
      totalRow.getCell(1).font = { bold: true };
      for (let col = 1; col <= 5; col++) {
        totalRow.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${dynamicFileName("New Hires")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Exported New Hires report to Excel", "created");
    } finally {
      setExporting(false);
    }
  }

  /**
   * Exports the milestone currently being looked at, and only that one, split into a
   * sheet per calendar month falling inside the chosen date range.
   *
   * It used to write all five milestones into one workbook regardless of what was on
   * screen, which meant every export had to be pruned by hand before it could be sent on.
   */
  async function handleExport() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      const type = milestoneType;
      const isThird = type === "third";
      const isSixth = type === "sixth";
      const isReliever = type === "relieverEnd";
      const isBirthday = type === "birthday";
      // Birthday and 6th Month sheets get the centred title and the yellow total.
      const isFormatted = isSixth || isBirthday;

      /**
       * What each sheet is called inside: "October 2026 Regular Employees" for the 6th
       * month — the month they regularize — and "September 3rd Month Assessment" style for
       * the rest.
       */
      const sheetTitle = (monthLabel: string) =>
        isSixth
          ? `${monthLabel} Regular Employees`
          : isThird
            ? `${monthLabel} ${MILESTONE_LABELS[type]} Assessment`
            : `${monthLabel} ${MILESTONE_LABELS[type]}`;

      const columns = isThird
        ? ["Employee Name", "Position", "Department", "Immediate Supervisor", "3rd Month Date"]
        : isSixth
          ? [
              "Employee Name",
              "Position",
              "Department",
              "Salary Status",
              "Percentage",
              "New Gross",
              "6th Month Date",
            ]
          : isBirthday
            ? ["No.", "Employee Name", "Position", "Department", "Email", "Birthday", "Notes"]
            : [
              "Employee Name",
              "Position",
              "Department",
              "Immediate Supervisor",
              "Email",
              ...(isReliever
                ? ["Employee Being Replaced", "Reason for Replacement", "Position Being Replaced"]
                : []),
              isReliever ? "Reliever Contract End Date" : MILESTONE_LABELS[type],
              "Notes",
            ];

      /** The salary review as the export states it, straight off the employee record. */
      function salaryCells(id: string): [string, string] {
        const e = employees.find((x) => x.id === id);
        const review = e?.sixthMonthSalaryReview;
        if (review === "withIncrease") {
          const percent = (e?.regularizationIncreasePercent || "").trim();
          return ["With Increase", percent ? `${percent}%` : ""];
        }
        // Blank rather than "N/A": an unchanged salary simply has no percentage.
        if (review === "asIs") return ["As Is Salary", ""];
        // Never "As Is Salary" by default — nothing has been decided for this employee yet.
        return [NOT_SET_LABEL, ""];
      }

      function rowFor(r: FilterRow, index: number): (string | number)[] {
        if (isBirthday) {
          return [
            index + 1,
            r.name,
            r.position,
            r.department,
            r.email,
            formatDate(r.displayDate || r.date, "MMMM d, yyyy"),
            noteFor(r.id, type),
          ];
        }
        if (isThird) {
          return [r.name, r.position, r.department, r.supervisor, formatDate(r.date, "MMMM d, yyyy")];
        }
        if (isSixth) {
          const [status, percent] = salaryCells(r.id);
          const employee = employees.find((x) => x.id === r.id);
          // The "New Total Monthly Gross" from the employee's milestone; blank when none.
          const newGross = employee ? regularizationNewGross(employee) : null;
          return [
            r.name,
            r.position,
            r.department,
            status,
            percent,
            newGross ? `₱${newGross}` : "",
            formatDate(r.date, "MMMM d, yyyy"),
          ];
        }
        return [
          r.name,
          r.position,
          r.department,
          r.supervisor,
          r.email,
          ...(isReliever
            ? [r.replacedName || "", r.replacedReason || "", r.replacedPosition || ""]
            : []),
          formatDate(r.displayDate || r.date, "MMMM d, yyyy"),
          noteFor(r.id, type),
        ];
      }

      function buildSheet(monthLabel: string, sheetName: string, sheetRows: FilterRow[]) {
        const ws = wb.addWorksheet(sheetName);
        ws.columns = columns.map((c) => ({ width: c === "No." ? 8 : c.length < 16 ? 22 : c.length + 6 }));

        const titleRow = ws.addRow([sheetTitle(monthLabel)]);
        ws.mergeCells(titleRow.number, 1, titleRow.number, columns.length);
        titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: "FF0A2E2A" } };
        titleRow.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE4F0EE" },
        };
        if (isFormatted) titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

        const headerRow = ws.addRow(columns);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });

        sheetRows.forEach((r, i) => ws.addRow(rowFor(r, i)));
        ws.addRow([]);
        const totalRow = ws.addRow([`Total: ${sheetRows.length}`]);
        totalRow.getCell(1).font = { bold: true };
        // The total is what gets read off the sheet, so it is picked out in yellow.
        if (isFormatted) {
          totalRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
          if (isBirthday) {
            totalRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
          }
        }

        // Beneath the total: the same people grouped under each birthday date.
        if (isBirthday && sheetRows.length > 0) {
          const byDay = new Map<string, FilterRow[]>();
          sheetRows.forEach((r) => {
            const day = formatDate(r.date, "MMMM dd");
            byDay.set(day, [...(byDay.get(day) || []), r]);
          });
          byDay.forEach((people, day) => {
            ws.addRow([]);
            const dayRow = ws.addRow([`${day} (${people.length})`]);
            ws.mergeCells(dayRow.number, 1, dayRow.number, 2);
            dayRow.getCell(1).font = { bold: true, color: { argb: "FF0A2E2A" } };
            dayRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
            people.forEach((p, i) => ws.addRow([i + 1, p.name]));
          });
        }
      }

      function computeRowsFor(kind: MilestoneType): FilterRow[] {
        if (kind === "birthday") {
          return employees
            .filter((e) => e.birthday && separationDate(e) === null)
            .map((e) => ({
              id: e.id,
              name: e.name,
              position: e.position || "",
              department: e.department || "",
              email: e.realcognitaEmail || "",
              supervisor: e.immediateSupervisor || "",
              date: birthdayThisYear(e.birthday!, today.getFullYear()),
              displayDate: e.birthday,
            }))
            .filter((r) => inRange(r.date, startDate, endDate))
            .sort((a, b) => (a.date < b.date ? -1 : 1));
        }
        if (kind === "relieverEnd") {
          return employees
            .filter((e) => e.isReliever && e.relieverEndDate && !e.lastDay)
            .map((e) => ({
              ...toFilterRow(e, new Date(e.relieverEndDate!).toISOString()),
              replacedName: e.replacedEmployeeName || "",
              replacedReason: e.relieverReason || "",
              replacedPosition: e.replacedPosition || "",
            }))
            .filter((r) => inRange(r.date, startDate, endDate))
            .sort((a, b) => (a.date < b.date ? -1 : 1));
        }
        const monthsMap: Record<MilestoneType, number> = {
          birthday: 0,
          relieverEnd: 0,
          third: 3,
          sixth: 6,
          oneYear: 12,
        };
        return employees
          .filter((e) => e.dateHired && !e.lastDay)
          .map((e) => {
            const d = new Date(e.dateHired!);
            d.setMonth(d.getMonth() + monthsMap[kind]);
            return {
              id: e.id,
              name: e.name,
              position: e.position || "",
              department: e.department || "",
              email: e.realcognitaEmail || "",
              supervisor: e.immediateSupervisor || "",
              date: d.toISOString(),
            };
          })
          .filter((r) => inRange(r.date, startDate, endDate))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      }

      // One sheet per month the range actually covers, in date order. A range wholly
      // inside one month therefore produces one sheet, not twelve empty ones.
      const rows = computeRowsFor(type);
      const months = new Map<string, FilterRow[]>();
      rows.forEach((r) => {
        const key = format(new Date(r.date), "yyyy-MM");
        const list = months.get(key);
        if (list) list.push(r);
        else months.set(key, [r]);
      });

      if (months.size === 0) {
        // Still give them a workbook rather than a silent no-op, so an empty month reads
        // as "nobody is due" instead of as a failed download.
        buildSheet(format(new Date(startDate), "MMMM yyyy"), format(new Date(startDate), "MMMM yyyy"), []);
      } else {
        [...months.keys()].sort().forEach((key) => {
          const label = format(new Date(`${key}-01T00:00:00`), "MMMM yyyy");
          buildSheet(label, label, months.get(key) || []);
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${MILESTONE_LABELS[type]} - ${exportFileName()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Exported ${MILESTONE_LABELS[type]} to Excel (${months.size || 1} sheet(s))`, "created");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mb-10">
      <button
        onClick={() => setExpanded((s) => !s)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="font-display text-2xl text-ink">Advanced Filtering & Custom Views</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Filter by Milestones or New Hires within a date range.
          </p>
        </div>
        <span className={`text-ink-muted transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
      </button>

      {expanded && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-lg bg-background p-1 w-fit">
              {([
                { id: "milestones" as const, label: "Milestones" },
                { id: "newHires" as const, label: "New Hires" },
              ]).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    category === c.id ? "bg-surface text-accent shadow-sm" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {isMilestoneView && (
              <div className="flex gap-1 rounded-lg bg-background p-1 w-fit">
                {([
                  { id: "birthday" as const, label: "Birthdays" },
                  { id: "relieverEnd" as const, label: "Reliever Contract" },
                  { id: "third" as const, label: "3rd Month" },
                  { id: "sixth" as const, label: "6th Month" },
                  { id: "oneYear" as const, label: "1 Year" },
                ]).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMilestoneType(m.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      milestoneType === m.id ? "bg-surface text-accent shadow-sm" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Start date
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setPreset("custom");
                  setStartDate(e.target.value);
                }}
              />
              <span className="text-[11px] text-ink-muted">
                {ddmmyyyy(startDate)} — {spelledOut(startDate)}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              End date
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setPreset("custom");
                  setEndDate(e.target.value);
                }}
              />
              <span className="text-[11px] text-ink-muted">
                {ddmmyyyy(endDate)} — {spelledOut(endDate)}
              </span>
            </label>
            {isMilestoneView && (
              <Button
                onClick={handleExport}
                disabled={exporting}
                className="ml-auto"
                title={`Exports ${MILESTONE_LABELS[milestoneType]} only, one sheet per month in the range above`}
              >
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            )}
            {category === "newHires" && (
              <Button onClick={handleExportNewHires} disabled={exporting} className="ml-auto">
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            )}
          </div>

            <>
              {milestoneType === "sixth" && isMilestoneView && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="text-xs text-ink-muted">
                    {perfTemplate
                      ? `Performance Evaluation template: ${perfTemplate.fileName}`
                      : "No Performance Evaluation template uploaded yet."}
                  </span>
                  <FileButton
                    accept=".docx"
                    onFile={uploadPerfTemplate}
                    title="Upload the blank Performance Evaluation (Word) — only the header details are filled in"
                  >
                    {perfTemplate ? "Replace template" : "Import template (Word)"}
                  </FileButton>
                </div>
              )}

              {milestoneType === "third" && isMilestoneView && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="text-xs text-ink-muted">
                    {thirdTemplate
                      ? `3rd Month Evaluation template: ${thirdTemplate.fileName}`
                      : "No 3rd Month Evaluation template uploaded yet."}
                  </span>
                  <FileButton
                    accept=".docx"
                    onFile={uploadThirdTemplate}
                    title="Upload the blank 3rd Month Probationary Evaluation (Word) — only the NAME: line is filled in"
                  >
                    {thirdTemplate ? "Replace template" : "Import template (Word)"}
                  </FileButton>
                </div>
              )}

              <p className="mt-4 text-sm font-medium text-ink">Total Employees: {rows.length}</p>

              {rows.length === 0 ? (
                <div className="mt-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
                  No matching records for this filter and date range.
                </div>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead>
                      <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                        <th className="px-3 py-2">Employee Name</th>
                        <th className="px-3 py-2">Position</th>
                        <th className="px-3 py-2">Department</th>
                        <th className="px-3 py-2">Immediate Supervisor</th>
                        <th className="px-3 py-2">Email</th>
                        {isRelieverView && (
                          <>
                            <th className="px-3 py-2">Employee Being Replaced</th>
                            <th className="px-3 py-2">Reason for Replacement</th>
                            <th className="px-3 py-2">Position Being Replaced</th>
                          </>
                        )}
                        <th className="px-3 py-2">{dateColumnLabel}</th>
                        {isMilestoneView && <th className="px-3 py-2">Notes</th>}
                        {milestoneType === "third" && isMilestoneView && (
                          <th className="px-3 py-2">Performance Evaluation</th>
                        )}
                        {milestoneType === "sixth" && isMilestoneView && (
                          <th className="px-3 py-2">6-Month Salary Review</th>
                        )}
                        {milestoneType === "sixth" && isMilestoneView && (
                          <th className="px-3 py-2">Performance Evaluation</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-3 py-2 text-ink">
                            <Link href={`/employees/${r.id}`} className="hover:text-accent">
                              {r.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-ink-muted">{r.position || "—"}</td>
                          <td className="px-3 py-2 text-ink-muted">{r.department || "—"}</td>
                          <td className="px-3 py-2 text-ink-muted">{r.supervisor || "—"}</td>
                          <td className="px-3 py-2 text-ink-muted">{r.email || "—"}</td>
                          {isRelieverView && (
                            <>
                              <td className="px-3 py-2 text-ink-muted">{r.replacedName || "—"}</td>
                              <td className="px-3 py-2 text-ink-muted">{r.replacedReason || "—"}</td>
                              <td className="px-3 py-2 text-ink-muted">{r.replacedPosition || "—"}</td>
                            </>
                          )}
                          <td className="px-3 py-2 text-ink-muted">
                            {formatDate(r.displayDate || r.date, "MMMM d, yyyy")}
                          </td>
                          {isMilestoneView && (
                            <td className="px-3 py-2">
                              {milestoneType === "sixth" ? (
                                // The 6th-month note tracks the evaluation workflow, so it's a
                                // fixed set of statuses rather than free text.
                                <StatusSelect
                                  value={noteFor(r.id, "sixth")}
                                  onChange={(v) => setNoteFor(r.id, "sixth", v)}
                                  options={sixthMonthNoteOptions(noteFor(r.id, "sixth"))}
                                  labels={sixthMonthNoteLabels(noteFor(r.id, "sixth"))}
                                  tone={milestoneNoteTone}
                                />
                              ) : milestoneType === "third" ? (
                                // The same idea one milestone earlier, with the shorter list
                                // the 3rd-month check-in actually has.
                                <StatusSelect
                                  value={noteFor(r.id, "third")}
                                  onChange={(v) => setNoteFor(r.id, "third", v)}
                                  options={thirdMonthNoteOptions(noteFor(r.id, "third"))}
                                  labels={thirdMonthNoteLabels(noteFor(r.id, "third"))}
                                  tone={milestoneNoteTone}
                                />
                              ) : (
                                <Input
                                  placeholder="e.g. Done, Messaged"
                                  defaultValue={noteFor(r.id, milestoneType)}
                                  onBlur={(e) => setNoteFor(r.id, milestoneType, e.target.value)}
                                  className="min-w-[160px]"
                                />
                              )}
                            </td>
                          )}
                          {milestoneType === "third" && isMilestoneView && (
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!thirdTemplate || thirdBusyId === r.id}
                                onClick={() => downloadThirdEval(r)}
                                title={
                                  thirdTemplate
                                    ? "Downloads the 3rd Month Evaluation with this employee's name filled in"
                                    : "Import the blank Word template above first"
                                }
                              >
                                {thirdBusyId === r.id ? "Building…" : "Download"}
                              </Button>
                            </td>
                          )}
                          {milestoneType === "sixth" && isMilestoneView && (
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1.5">
                                {/* Unset by default: an employee nobody has reviewed yet must
                                    not read as "As Is Salary", which is a decision. */}
                                <select
                                  value={
                                    employees.find((e) => e.id === r.id)?.sixthMonthSalaryReview || ""
                                  }
                                  onChange={(e) => {
                                    const review = e.target.value as "" | "asIs" | "withIncrease";
                                    updateEmployee(r.id, {
                                      sixthMonthSalaryReview: review || undefined,
                                      // Clearing the contract percentage for anything but a raise
                                      // keeps it from silently computing one nobody meant — the
                                      // letters and the Compensation panel both read it.
                                      ...(review === "withIncrease"
                                        ? {}
                                        : { regularizationIncreasePercent: "" }),
                                    });
                                  }}
                                  className="h-9 min-w-[130px] rounded-lg border border-border bg-background px-2 text-sm text-ink"
                                >
                                  <option value="">{NOT_SET_LABEL}</option>
                                  <option value="asIs">As Is Salary</option>
                                  <option value="withIncrease">With Increase</option>
                                </select>
                                {employees.find((e) => e.id === r.id)?.sixthMonthSalaryReview ===
                                  "withIncrease" && (
                                  <span className="relative">
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="e.g. 17"
                                      className="w-24 pr-6 text-sm"
                                      defaultValue={
                                        employees.find((e) => e.id === r.id)
                                          ?.regularizationIncreasePercent || ""
                                      }
                                      onBlur={(e) =>
                                        updateEmployee(r.id, {
                                          regularizationIncreasePercent: e.target.value,
                                        })
                                      }
                                    />
                                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">
                                      %
                                    </span>
                                  </span>
                                )}
                              </div>
                            </td>
                          )}
                          {milestoneType === "sixth" && isMilestoneView && (
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!perfTemplate || perfBusyId === r.id}
                                onClick={() => downloadPerfEval(r)}
                              >
                                {perfBusyId === r.id ? "Building…" : "Download"}
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
        </Card>
      )}
    </div>
  );
}

/* ------------------------- Centralized COE Tracker ------------------------- */

function CentralizedCOETracker({ employees }: { employees: Employee[] }) {
  const { items: requests, hydrated, remove, update: updateRequest } = useSupabaseStore<COERequest>(
    "hr_coe_requests",
    []
  );
  const { update: updateEmployee } = useSupabaseStore<Employee>("hr_employees", []);
  const { items: er2Rows } = useSupabaseStore<ER2ReportRow>("hr_report_er2", []);
  const { items: eventRows } = useSupabaseStore<EventReportRow>("hr_report_events", []);
  const { items: customTables } = useSupabaseStore<CustomReportTable>("hr_report_custom_tables", []);
  const [expanded, setExpanded] = useState(false);
  const today = new Date();
  const [preset, setPreset] = useState<TimeframePreset>("month");
  const [startDate, setStartDate] = useState(startOfMonthISO(today));
  const [endDate, setEndDate] = useState(endOfMonthISO(today));
  const [exporting, setExporting] = useState(false);
  const { notify } = useNotifications();

  const [editingCoeId, setEditingCoeId] = useState<string | null>(null);
  const [coeDraft, setCoeDraft] = useState({
    employeeName: "",
    position: "",
    department: "",
    email: "",
    purpose: "",
  });

  /** The COE's own email if set, else whatever the employee record has on file. */
  function coeEmail(r: COERequest): string {
    if (r.email) return r.email;
    const emp = employees.find(
      (e) => e.name.trim().toLowerCase() === r.employeeName.trim().toLowerCase()
    );
    return emp?.realcognitaEmail || "";
  }

  function startCoeEdit(r: COERequest) {
    setEditingCoeId(r.id);
    setCoeDraft({
      employeeName: r.employeeName,
      position: r.position,
      department: r.department,
      email: coeEmail(r),
      purpose: r.purpose || "",
    });
  }

  function saveCoeEdit(id: string) {
    if (!coeDraft.employeeName.trim()) return;
    updateRequest(id, {
      employeeName: coeDraft.employeeName.trim(),
      position: coeDraft.position,
      department: coeDraft.department,
      email: coeDraft.email,
      purpose: coeDraft.purpose,
    });
    setEditingCoeId(null);
    notify(`COE record updated for "${coeDraft.employeeName.trim()}"`, "updated");
  }

  function applyPreset(p: TimeframePreset) {
    setPreset(p);
    if (p === "week") {
      setStartDate(startOfWeekISO(today));
      setEndDate(endOfWeekISO(today));
    } else if (p === "month") {
      setStartDate(startOfMonthISO(today));
      setEndDate(endOfMonthISO(today));
    } else if (p === "year") {
      setStartDate(startOfYearISO(today));
      setEndDate(endOfYearISO(today));
    }
  }

  if (!hydrated) return null;

  const filtered = [...requests]
    .filter((r) => inRange(r.dateRequested, startDate, endDate))
    .sort((a, b) => (a.dateRequested < b.dateRequested ? 1 : -1));

  function exportFileName(): string {
    const monday = new Date(startDate);
    const friday = new Date(endDate);
    let coverage: string;
    if (preset === "week") {
      const sameMonth = monday.getMonth() === friday.getMonth();
      coverage = sameMonth
        ? `${format(monday, "MMMM d")}-${format(friday, "d, yyyy")}`
        : `${format(monday, "MMMM d")}-${format(friday, "MMMM d, yyyy")}`;
    } else if (preset === "year") {
      coverage = `${monday.getFullYear()}`;
    } else {
      coverage = format(monday, "MMMM yyyy");
    }
    return `Report to Adam - ${coverage}`;
  }

  function coverageLabel(): string {
    const monday = new Date(startDate);
    const friday = new Date(endDate);
    if (preset === "week") {
      const sameMonth = monday.getMonth() === friday.getMonth();
      return sameMonth
        ? `${format(monday, "MMMM d")}–${format(friday, "d, yyyy")}`
        : `${format(monday, "MMMM d")}–${format(friday, "MMMM d, yyyy")}`;
    }
    if (preset === "year") return `${monday.getFullYear()}`;
    return format(monday, "MMMM yyyy");
  }

  async function handleExport() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      const withPurpose = filtered.filter((r) => r.category !== "endOfEmployment");
      const resigned = filtered.filter((r) => r.category === "endOfEmployment");

      const ws = wb.addWorksheet("COE Summary");
      ws.columns = [
        { width: 26 },
        { width: 24 },
        { width: 20 },
        { width: 28 },
        { width: 16 },
        { width: 24 },
        { width: 16 },
      ];
      const coverageRow = ws.addRow([`Coverage: ${coverageLabel()}`]);
      coverageRow.getCell(1).font = { bold: true, size: 12 };
      ws.addRow([`Total COE with Purpose: ${withPurpose.length}`]);
      ws.addRow([`Total COE for Resigned: ${resigned.length}`]);
      ws.addRow([]);

      function appendTable(title: string, rows: COERequest[]) {
        const titleRow = ws.addRow([title]);
        titleRow.getCell(1).font = { bold: true, color: { argb: "FF0A2E2A" } };
        titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
        const headerRow = ws.addRow(["Employee Name", "Position", "Department", "Email Address", "Date Requested", "Purpose", "Date Issued"]);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        rows.forEach((r) => {
          ws.addRow([
            r.employeeName,
            r.position,
            r.department,
            coeEmail(r),
            formatDate(r.dateRequested, "MMMM d, yyyy"),
            r.category === "endOfEmployment" ? "Resigned" : r.purpose || "—",
            r.dateGiven ? formatDate(r.dateGiven, "MMMM d, yyyy") : "—",
          ]);
        });
        ws.addRow([]);
      }

      appendTable("COE with Purpose", withPurpose);
      appendTable("COE for Resigned", resigned);

      function appendReportTablesToWorkbook(wbInner: InstanceType<typeof ExcelJS.Workbook>) {
        if (er2Rows.length > 0) {
          const s = wbInner.addWorksheet("ER2 Form for PhilHealth");
          s.columns = [{ width: 26 }, { width: 24 }, { width: 20 }, { width: 18 }];
          const t = s.addRow(["ER2 Form for PhilHealth Report"]);
          t.getCell(1).font = { bold: true, size: 12 };
          const h = s.addRow(["Employee Name", "Position", "Department", "Date Created"]);
          h.eachCell((c) => {
            c.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
          });
          er2Rows.forEach((r) =>
            s.addRow([r.employeeName, r.position, r.department, formatDate(r.dateCreated, "MMMM d, yyyy")])
          );
        }
        if (eventRows.length > 0) {
          const s = wbInner.addWorksheet("Events Attended");
          s.columns = [{ width: 28 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 26 }];
          const t = s.addRow(["Events Attended Report"]);
          t.getCell(1).font = { bold: true, size: 12 };
          const h = s.addRow(["Event Name", "Date", "Start Time", "End Time", "Location"]);
          h.eachCell((c) => {
            c.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
          });
          eventRows.forEach((r) =>
            s.addRow([
              r.eventName,
              formatDate(r.date, "MMMM d, yyyy"),
              formatTime12(r.time),
              formatTime12(r.endTime || ""),
              r.location,
            ])
          );
        }
        customTables.forEach((ct) => {
          if (ct.rows.length === 0) return;
          const s = wbInner.addWorksheet(ct.title.slice(0, 31) || "Custom Table");
          s.columns = ct.columns.map(() => ({ width: 22 }));
          const t = s.addRow([ct.title]);
          t.getCell(1).font = { bold: true, size: 12 };
          const h = s.addRow(ct.columns);
          h.eachCell((c) => {
            c.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
          });
          ct.rows.forEach((row) => s.addRow(ct.columns.map((col) => row[col] || "")));
        });
      }

      appendReportTablesToWorkbook(wb);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportFileName()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Exported COE tracker to Excel", "created");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mb-10">
      <button
        onClick={() => setExpanded((s) => !s)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="font-display text-2xl text-ink">Centralized COE Tracker</h2>
          <p className="mt-1 text-sm text-ink-muted">
            All generated Certificates of Employment, synced automatically from each employee&apos;s profile.
          </p>
        </div>
        <span className={`text-ink-muted transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
      </button>

      {expanded && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Start date
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setPreset("custom");
                  setStartDate(e.target.value);
                }}
              />
              <span className="text-[11px] text-ink-muted">
                {ddmmyyyy(startDate)} — {spelledOut(startDate)}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              End date
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setPreset("custom");
                  setEndDate(e.target.value);
                }}
              />
              <span className="text-[11px] text-ink-muted">
                {ddmmyyyy(endDate)} — {spelledOut(endDate)}
              </span>
            </label>
            <Button variant="ghost" onClick={() => applyPreset("week")}>
              This Week
            </Button>
            <Button variant="ghost" onClick={() => applyPreset("month")}>
              This Month
            </Button>
            <Button variant="ghost" onClick={() => applyPreset("year")}>
              This Year
            </Button>
            <Button onClick={handleExport} disabled={exporting} className="ml-auto">
              {exporting ? "Exporting…" : "Export to Excel"}
            </Button>
          </div>

          <p className="mt-4 text-sm font-medium text-ink">Total COE Records: {filtered.length}</p>

          {(["withPurpose", "endOfEmployment"] as const).map((cat) => {
            const rowsForCat = filtered.filter((r) =>
              cat === "endOfEmployment" ? r.category === "endOfEmployment" : r.category !== "endOfEmployment"
            );
            return (
              <div key={cat} className="mt-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {cat === "endOfEmployment" ? "COE for Resigned" : "COE with Purpose"}
                </p>
                <p className="mb-2 text-sm font-medium text-ink">Total Employees: {rowsForCat.length}</p>
                {rowsForCat.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
                    No records in this date range.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[1000px] text-left text-sm">
                      <thead>
                        <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                          <th className="px-3 py-2">Employee Name</th>
                          <th className="px-3 py-2">Position</th>
                          <th className="px-3 py-2">Department</th>
                          <th className="px-3 py-2">Email Address</th>
                          <th className="px-3 py-2">Date Requested</th>
                          <th className="px-3 py-2">Purpose</th>
                          <th className="px-3 py-2">Date Issued</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {rowsForCat.map((r) => {
                          const emp = employees.find(
                            (e) => e.name.trim().toLowerCase() === r.employeeName.trim().toLowerCase()
                          );
                          const isEditing = editingCoeId === r.id;
                          return (
                            <tr key={r.id} className="border-t border-border">
                              <td className="px-3 py-2 text-ink">
                                {isEditing ? (
                                  <EmployeeNameInput
                                    value={coeDraft.employeeName}
                                    onChange={(employeeName) => setCoeDraft((d) => ({ ...d, employeeName }))}
                                    onSelect={(entry) =>
                                      setCoeDraft((d) => ({
                                        ...d,
                                        employeeName: entry.name,
                                        position: entry.position,
                                        department: entry.department,
                                        // Pull the newly picked employee's email in too.
                                        email:
                                          employees.find((e) => e.id === entry.id)?.realcognitaEmail || d.email,
                                      }))
                                    }
                                    className="min-w-[180px]"
                                  />
                                ) : emp ? (
                                  <Link href={`/employees/${emp.id}`} className="hover:text-accent">
                                    {r.employeeName}
                                  </Link>
                                ) : (
                                  r.employeeName
                                )}
                              </td>
                              <td className="px-3 py-2 text-ink-muted">
                                {isEditing ? (
                                  <Input
                                    value={coeDraft.position}
                                    onChange={(e) => setCoeDraft((d) => ({ ...d, position: e.target.value }))}
                                    className="min-w-[150px]"
                                  />
                                ) : (
                                  r.position || "—"
                                )}
                              </td>
                              <td className="px-3 py-2 text-ink-muted">
                                {isEditing ? (
                                  <Input
                                    value={coeDraft.department}
                                    onChange={(e) => setCoeDraft((d) => ({ ...d, department: e.target.value }))}
                                    className="min-w-[150px]"
                                  />
                                ) : (
                                  r.department || "—"
                                )}
                              </td>
                              <td className="px-3 py-2 text-ink-muted">
                                {isEditing ? (
                                  <Input
                                    value={coeDraft.email}
                                    onChange={(e) => setCoeDraft((d) => ({ ...d, email: e.target.value }))}
                                    className="min-w-[180px]"
                                  />
                                ) : (
                                  coeEmail(r) || "—"
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col gap-0.5">
                                  <Input
                                    type="date"
                                    value={r.dateRequested.slice(0, 10)}
                                    onChange={(e) =>
                                      updateRequest(r.id, { dateRequested: new Date(e.target.value).toISOString() })
                                    }
                                    className="min-w-[150px]"
                                  />
                                  <span className="text-[11px] text-ink-muted">
                                    {formatDate(r.dateRequested, "MMMM d, yyyy")}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-ink-muted">
                                {r.category === "endOfEmployment" ? (
                                  "Resigned"
                                ) : isEditing ? (
                                  <Input
                                    value={coeDraft.purpose}
                                    onChange={(e) => setCoeDraft((d) => ({ ...d, purpose: e.target.value }))}
                                    className="min-w-[150px]"
                                  />
                                ) : (
                                  r.purpose || "—"
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col gap-0.5">
                                  <Input
                                    type="date"
                                    value={r.dateGiven ? r.dateGiven.slice(0, 10) : ""}
                                    onChange={(e) =>
                                      updateRequest(r.id, {
                                        dateGiven: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                                      })
                                    }
                                    className="min-w-[150px]"
                                  />
                                  {r.dateGiven && (
                                    <span className="text-[11px] text-ink-muted">
                                      {formatDate(r.dateGiven, "MMMM d, yyyy")}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <div className="flex gap-3">
                                    <button
                                      onClick={() => saveCoeEdit(r.id)}
                                      className="text-xs text-accent hover:underline"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => setEditingCoeId(null)}
                                      className="text-xs text-ink-muted hover:text-ink"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex gap-3">
                                    <button
                                      onClick={() => startCoeEdit(r)}
                                      className="text-xs text-accent hover:underline"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => {
                                        remove(r.id);
                                        notify(`COE record deleted for "${r.employeeName}"`, "deleted");
                                        if (r.category === "endOfEmployment") {
                                          const stillHasResignedCOE = requests.some(
                                            (other) =>
                                              other.id !== r.id &&
                                              other.category === "endOfEmployment" &&
                                              other.employeeName.trim().toLowerCase() ===
                                                r.employeeName.trim().toLowerCase()
                                          );
                                          if (!stillHasResignedCOE && emp) {
                                            updateEmployee(emp.id, { lastDay: undefined, resignedStatus: "active" });
                                            notify(`${r.employeeName} — milestone tracking restored`, "updated");
                                          }
                                        }
                                      }}
                                      className="text-xs text-ink-muted hover:text-warn"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
