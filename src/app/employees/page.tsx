"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { format } from "date-fns";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { addDaysISO, daysUntil, formatDate, formatTime12, isOverdue, todayISO } from "@/lib/dates";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Pill,
  SearchInput,
  SectionHeading,
  StatCard,
  StatusSelect,
  TableWrap,
} from "@/components/ui";
import {
  emptyPreEmploymentChecklist,
  emptyRequirements,
  getLackingRequirements,
  getMissingCriticalItems,
  defaultOnboardingChecklist,
  type Employee,
  type MilestoneNote,
  type COERequest,
  type ER2ReportRow,
  type RegularizationReportRow,
  type EventReportRow,
  type PlanReportRow,
  type CustomReportTable,
} from "@/types";
import { useNotifications } from "@/lib/notificationContext";
import { groupEmployees, isAwaitingOnboarding, resignedCoeIndex, separationDate as separationDateOf } from "@/lib/employeeStatus";
import {
  SIXTH_MONTH_NOTE_REFERENCE,
  sixthMonthNoteLabels,
  sixthMonthNoteOptions,
  sixthMonthNoteTone,
} from "@/lib/milestoneNotes";
import { EmployeeNameInput } from "@/components/EmployeeNameInput";

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

function isActive(e: Employee): boolean {
  return !e.lastDay && e.resignedStatus !== "resigned";
}

export default function EmployeesPage() {
  const { items: employees, hydrated, add, update, remove, setItems } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );
  const { notify } = useNotifications();
  const [showForm, setShowForm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncFileRef = useRef<HTMLInputElement | null>(null);
  const [syncPreview, setSyncPreview] = useState<{
    changes: StatusSyncChange[];
    examined: number;
    unmatched: string[];
  } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmBulkComplete, setConfirmBulkComplete] = useState(false);
  const [confirmDateFix, setConfirmDateFix] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [dateSent, setDateSent] = useState(todayISO().slice(0, 10));
  const [dateHired, setDateHired] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editDepartment, setEditDepartment] = useState("");


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

      setSyncPreview({ changes, examined, unmatched });
      if (changes.length === 0) {
        notify(`Checked ${examined} matching records — everything already matches the file.`, "info");
      }
    } catch {
      notify("Could not read that file. Export it as .xlsx and try again.", "warn");
    } finally {
      setSyncing(false);
      if (syncFileRef.current) syncFileRef.current.value = "";
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

  function startEdit(e: Employee) {
    setEditingId(e.id);
    setEditName(e.name);
    setEditPosition(e.position || "");
    setEditDepartment(e.department || "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function saveEdit(id: string) {
    if (!editName.trim()) return;
    update(id, {
      name: editName.trim(),
      position: editPosition.trim() || undefined,
      department: editDepartment.trim() || undefined,
    });
    notify(`Employee updated: "${editName.trim()}"`, "updated");
    setEditingId(null);
  }

  function handleAdd() {
    if (!name.trim()) return;
    const dateAdded = todayISO();
    const sentISO = dateSent ? new Date(dateSent).toISOString() : dateAdded;
    add({
      id: uuid(),
      name: name.trim(),
      position: position.trim() || undefined,
      department: department.trim() || undefined,
      dateAdded,
      dateRequirementsSent: sentISO,
      dateHired: dateHired ? new Date(dateHired).toISOString() : undefined,
      requirementsDeadline: addDaysISO(sentISO, 14),
      requirements: emptyRequirements(),
      preEmploymentChecklist: emptyPreEmploymentChecklist(),
      onboardingChecklist: defaultOnboardingChecklist(),
      isRegular: false,
    });
    notify(`Employee added: "${name.trim()}"`, "created");
    setName("");
    setPosition("");
    setDepartment("");
    setDateSent(todayISO().slice(0, 10));
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
        let name = fullNameCol;
        if (!name) {
          const first = String(row["First Name"] || "").trim();
          const middle = String(row["Middle Name"] || "").trim();
          const last = String(row["Last Name"] || "").trim();
          name = formatFullName(first, middle, last);
        }
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
        action={
          <div className="flex flex-wrap items-center gap-2">
            {duplicateCount > 0 && (
              <Button variant="ghost" onClick={() => setShowDuplicates((s) => !s)}>
                ⚠ {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"}
              </Button>
            )}
            <input
              ref={syncFileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={syncing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleStatusSync(file);
              }}
            />
            <Button
              variant="secondary"
              disabled={syncing}
              onClick={() => syncFileRef.current?.click()}
              title="Re-read the HR export and correct employment status and separation dates on existing records"
            >
              {syncing ? "Checking…" : "Sync status / separation dates"}
            </Button>
            <label className="cursor-pointer">
              <span
                className={`inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-sm font-medium text-ink hover:bg-background ${
                  importing ? "opacity-50" : ""
                }`}
              >
                {importing ? "Importing…" : "Import from Excel"}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportExcel(file);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="cursor-pointer">
              <span
                className={`inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-background ${
                  importing ? "opacity-50" : ""
                }`}
              >
                {importing ? "Updating…" : "Update Email/Supervisor"}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportEmailSupervisor(file);
                  e.target.value = "";
                }}
              />
            </label>
            <Button onClick={() => setShowForm((s) => !s)}>+ Add employee</Button>
            {employees.length > 0 &&
              (confirmBulkComplete ? (
                <div className="flex items-center gap-1.5">
                  <Button variant="danger" onClick={bulkMarkComplete}>
                    Confirm mark all complete
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmBulkComplete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmBulkComplete(true)}>
                  Bulk: Mark Requirements/Onboarding Complete
                </Button>
              ))}
            {employees.length > 0 &&
              (confirmDateFix ? (
                <div className="flex items-center gap-1.5">
                  <Button variant="danger" onClick={bulkFixDateShift}>
                    Confirm +1 day fix
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDateFix(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDateFix(true)}>
                  Fix Imported Date Shift (+1 day)
                </Button>
              ))}
            {employees.length > 0 &&
              (confirmDeleteAll ? (
                <div className="flex items-center gap-1.5">
                  <Button variant="danger" onClick={deleteAllEmployees}>
                    Confirm delete all ({employees.length})
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDeleteAll(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmDeleteAll(true)}>
                  Delete all employees
                </Button>
              ))}
          </div>
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
            <Input
              placeholder="Employee name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="Position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
            <Input
              placeholder="Department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Date MC sent pre-employment requirements
              <Input
                type="date"
                value={dateSent}
                onChange={(e) => setDateSent(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Requirements Deadline
              <Input
                type="date"
                value={dateSent ? addDaysISO(new Date(dateSent).toISOString(), 14).slice(0, 10) : ""}
                disabled
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
          <p className="mt-2 text-xs text-ink-muted">
            Requirements deadline auto-fills to 2 weeks after the date sent.
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

          if (editingId === e.id) {
            return (
              <Card key={e.id} className="flex flex-col gap-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="Employee name"
                    value={editName}
                    onChange={(ev) => setEditName(ev.target.value)}
                    autoFocus
                  />
                  <Input
                    placeholder="Position"
                    value={editPosition}
                    onChange={(ev) => setEditPosition(ev.target.value)}
                  />
                  <Input
                    placeholder="Department"
                    value={editDepartment}
                    onChange={(ev) => setEditDepartment(ev.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => saveEdit(e.id)}>Save</Button>
                  <Button variant="ghost" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </Card>
            );
          }

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
                <Button variant="ghost" onClick={() => startEdit(e)}>
                  Edit
                </Button>
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

function EmployeeCountSummary({ employees }: { employees: Employee[] }) {
  const [openGroup, setOpenGroup] = useState<CountGroup | null>(null);
  const [search, setSearch] = useState("");
  const { items: coeRequests } = useSupabaseStore<COERequest>("hr_coe_requests", []);

  // Same split the Active/Resigned view uses, so the two screens cannot disagree.
  const { active: current, newHires, resigned } = groupEmployees(employees, coeRequests);

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

type FilterCategory = "milestones" | "activeResigned" | "newHires";
type MilestoneType = "birthday" | "third" | "sixth" | "oneYear";
type TimeframePreset = "week" | "month" | "year" | "custom";

type FilterRow = {
  id: string;
  name: string;
  position: string;
  department: string;
  email: string;
  supervisor: string;
  date: string; // ISO
};

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
  const [openCountList, setOpenCountList] = useState<"active" | "newHires" | "resigned" | null>(null);
  const [countSearch, setCountSearch] = useState("");
  const { update: updateEmployee } = useSupabaseStore<Employee>("hr_employees", []);

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

  // Active, new hires and resigned are shown in full rather than filtered by the date
  // range above — these lists answer "who works here now", not "who changed this period".
  const activeRows: FilterRow[] = employees
    .filter((e) => separationDate(e) === null && !isAwaitingOnboarding(e))
    .map((e) => toFilterRow(e, e.dateAdded))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Hired on paper but their onboarding date is still ahead of them.
  const newHireRows: FilterRow[] = employees
    .filter((e) => separationDate(e) === null && isAwaitingOnboarding(e))
    .map((e) => toFilterRow(e, e.dateHired!))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const resignedRows: FilterRow[] = employees
    .map((e) => ({ e, date: separationDate(e) }))
    .filter((x): x is { e: Employee; date: string } => x.date !== null)
    .map(({ e, date }) => toFilterRow(e, date))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // COE records naming someone who isn't in the employee list yet still belong here.
  const knownNames = new Set(employees.map((e) => e.name.trim().toLowerCase()));
  const orphanResignedRows: FilterRow[] = [...coeIndex.entries()]
    .filter(([name]) => !knownNames.has(name))
    .map(([name, date]) => {
      const record = coeRequests.find(
        (r) => r.category === "endOfEmployment" && r.employeeName.trim().toLowerCase() === name
      );
      return {
        id: `coe-${name}`,
        name: record?.employeeName || name,
        position: record?.position || "",
        department: record?.department || "",
        email: record?.email || "",
        supervisor: "",
        date,
      };
    });

  const allResignedRows: FilterRow[] = [...resignedRows, ...orphanResignedRows].sort((a, b) =>
    a.date < b.date ? 1 : -1
  );

  const rows: FilterRow[] = (() => {
    if (category === "activeResigned") return [];
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
        .filter((e) => {
          if (!e.birthday) return false;
          const b = new Date(e.birthday);
          const thisYear = new Date(today.getFullYear(), b.getMonth(), b.getDate())
            .toISOString()
            .slice(0, 10);
          return inRange(thisYear, startDate, endDate);
        })
        .map((e) => {
          const b = new Date(e.birthday!);
          const thisYear = new Date(today.getFullYear(), b.getMonth(), b.getDate()).toISOString();
          return {
            id: e.id,
            name: e.name,
            position: e.position || "",
            department: e.department || "",
            email: e.realcognitaEmail || "",
            supervisor: e.immediateSupervisor || "",
            date: thisYear,
          };
        });
    }
    const monthsMap: Record<MilestoneType, number> = { birthday: 0, third: 3, sixth: 6, oneYear: 12 };
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
  const dateColumnLabel =
    category === "newHires" ? "Hired Date" : MILESTONE_LABELS[milestoneType];

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
   * Mirrors the on-screen Active/Resigned lists — every employee, not just those whose
   * dates fall in the selected range, and counting COE-for-Resigned records the same way.
   */
  function computeActiveResigned() {
    const active = employees.filter(
      (e) => separationDate(e) === null && !isAwaitingOnboarding(e)
    );
    const newHires = employees.filter(
      (e) => separationDate(e) === null && isAwaitingOnboarding(e)
    );
    const resigned = employees.filter((e) => separationDate(e) !== null);
    return { active, newHires, resigned };
  }

  async function handleExportActiveResigned() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      function buildSheet(sheetName: string) {
        const ws = wb.addWorksheet(sheetName);
        ws.columns = [{ width: 26 }, { width: 22 }, { width: 20 }, { width: 28 }, { width: 16 }];
        const { active, newHires, resigned } = computeActiveResigned();

        const activeTitle = ws.addRow([`Active Employees (${active.length})`]);
        ws.mergeCells(activeTitle.number, 1, activeTitle.number, 5);
        activeTitle.getCell(1).font = { bold: true, color: { argb: "FF0A2E2A" } };
        activeTitle.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
        const activeHeader = ws.addRow(["Employee Name", "Position", "Department", "Email", "Date Added"]);
        activeHeader.eachCell((c) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        active.forEach((e) =>
          ws.addRow([e.name, e.position || "", e.department || "", e.realcognitaEmail || "", formatDate(e.dateAdded, "MMMM d, yyyy")])
        );
        ws.addRow([]);

        const newHireTitle = ws.addRow([`New Hires — not yet onboarded (${newHires.length})`]);
        ws.mergeCells(newHireTitle.number, 1, newHireTitle.number, 5);
        newHireTitle.getCell(1).font = { bold: true, color: { argb: "FF0A2E2A" } };
        newHireTitle.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
        const newHireHeader = ws.addRow(["Employee Name", "Position", "Department", "Email", "Onboarding Date"]);
        newHireHeader.eachCell((c) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        newHires.forEach((e) =>
          ws.addRow([
            e.name,
            e.position || "",
            e.department || "",
            e.realcognitaEmail || "",
            e.dateHired ? formatDate(e.dateHired, "MMMM d, yyyy") : "—",
          ])
        );
        ws.addRow([]);

        const resignedTitle = ws.addRow([`Resigned Employees (${resigned.length})`]);
        ws.mergeCells(resignedTitle.number, 1, resignedTitle.number, 5);
        resignedTitle.getCell(1).font = { bold: true, color: { argb: "FF0A2E2A" } };
        resignedTitle.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
        const resignedHeader = ws.addRow(["Employee Name", "Position", "Department", "Email", "Separation Date"]);
        resignedHeader.eachCell((c) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        resigned.forEach((e) =>
          ws.addRow([
            e.name,
            e.position || "",
            e.department || "",
            e.realcognitaEmail || "",
            separationDate(e) ? formatDate(separationDate(e)!, "MMMM d, yyyy") : "—",
          ])
        );
        ws.addRow([]);
        const totalRow = ws.addRow([
          `Total: ${active.length + newHires.length + resigned.length} ` +
            `(Active: ${active.length}, New Hires: ${newHires.length}, Resigned: ${resigned.length})`,
        ]);
        totalRow.getCell(1).font = { bold: true };
      }

      // Both lists cover everyone on file, so one sheet says it all.
      buildSheet("Active & Resigned");

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Active and Resigned Employees - ${format(today, "MMMM d, yyyy")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Exported Active/Resigned report to Excel", "created");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportNewHires() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      function buildSheet(sheetName: string, rangeStart: string, rangeEnd: string) {
        const ws = wb.addWorksheet(sheetName);
        ws.columns = [{ width: 26 }, { width: 22 }, { width: 20 }, { width: 28 }, { width: 16 }];
        const newHires = employees.filter((e) => e.dateHired && inRange(e.dateHired, rangeStart, rangeEnd));
        const headerRow = ws.addRow(["Employee Name", "Position", "Department", "Email", "Hired Date"]);
        headerRow.eachCell((c) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        newHires.forEach((e) =>
          ws.addRow([e.name, e.position || "", e.department || "", e.realcognitaEmail || "", formatDate(e.dateHired!, "MMMM d, yyyy")])
        );
        ws.addRow([]);
        const totalRow = ws.addRow([`Total: ${newHires.length}`]);
        totalRow.getCell(1).font = { bold: true };
      }

      buildSheet("This Week", startOfWeekISO(today), endOfWeekISO(today));
      buildSheet("This Month", startOfMonthISO(today), endOfMonthISO(today));
      buildSheet("This Year", startOfYearISO(today), endOfYearISO(today));

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

  async function handleExport() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      type Sheet = ReturnType<InstanceType<typeof ExcelJS.Workbook>["addWorksheet"]>;

      /** Prints what each 6th-month status means under the sheet, for whoever reads the file. */
      function appendNoteReference(ws: Sheet) {
        ws.addRow([]);
        const caption = ws.addRow(["Notes — dropdown options and meanings"]);
        caption.getCell(1).font = { bold: true, size: 12 };
        const header = ws.addRow(["Dropdown Option", "Meaning"]);
        header.eachCell((cell, col) => {
          if (col > 2) return;
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        SIXTH_MONTH_NOTE_REFERENCE.forEach(([option, meaning]) => {
          const row = ws.addRow([option, meaning]);
          row.getCell(1).font = { bold: true };
          row.getCell(2).alignment = { wrapText: true };
        });
      }

      function buildSheet(sheetName: string, type: MilestoneType, sheetRows: FilterRow[]) {
        const ws = wb.addWorksheet(sheetName);
        ws.columns = [
          { width: 26 },
          { width: 26 },
          { width: 20 },
          { width: 22 },
          { width: 28 },
          { width: 18 },
          { width: 24 },
        ];
        const titleRow = ws.addRow([sheetName]);
        ws.mergeCells(titleRow.number, 1, titleRow.number, 7);
        titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: "FF0A2E2A" } };
        titleRow.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE4F0EE" },
        };
        const headerRow = ws.addRow([
          "Employee Name",
          "Position",
          "Department",
          "Immediate Supervisor",
          "Email",
          MILESTONE_LABELS[type],
          "Notes",
        ]);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        sheetRows.forEach((r) => {
          ws.addRow([
            r.name,
            r.position,
            r.department,
            r.supervisor,
            r.email,
            formatDate(r.date, "MMMM d, yyyy"),
            noteFor(r.id, type),
          ]);
        });
        if (type === "sixth") appendNoteReference(ws);
      }

      function computeRowsFor(type: MilestoneType): FilterRow[] {
        if (type === "birthday") {
          return employees
            .filter((e) => e.birthday)
            .map((e) => {
              const b = new Date(e.birthday!);
              const thisYear = new Date(today.getFullYear(), b.getMonth(), b.getDate()).toISOString();
              return {
                id: e.id,
                name: e.name,
                position: e.position || "",
                department: e.department || "",
                email: e.realcognitaEmail || "",
                supervisor: e.immediateSupervisor || "",
                date: thisYear,
              };
            })
            .filter((r) => inRange(r.date, startDate, endDate))
            .sort((a, b) => (a.date < b.date ? -1 : 1));
        }
        const monthsMap: Record<MilestoneType, number> = { birthday: 0, third: 3, sixth: 6, oneYear: 12 };
        return employees
          .filter((e) => e.dateHired && !e.lastDay)
          .map((e) => {
            const d = new Date(e.dateHired!);
            d.setMonth(d.getMonth() + monthsMap[type]);
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

      buildSheet("Birthdays", "birthday", computeRowsFor("birthday"));
      buildSheet("3rd Month", "third", computeRowsFor("third"));
      buildSheet("6th Month", "sixth", computeRowsFor("sixth"));
      buildSheet("1 Year", "oneYear", computeRowsFor("oneYear"));

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
      notify(`Exported milestone report to Excel`, "created");
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
            Filter by Milestones, Active, Resigned, or New Hires within a date range.
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
                { id: "activeResigned" as const, label: "Active/Resigned" },
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
            <Button variant="ghost" onClick={() => applyPreset("week")}>
              This Week
            </Button>
            <Button variant="ghost" onClick={() => applyPreset("month")}>
              This Month
            </Button>
            <Button variant="ghost" onClick={() => applyPreset("year")}>
              This Year
            </Button>
            {isMilestoneView && (
              <Button onClick={handleExport} disabled={exporting} className="ml-auto">
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            )}
            {category === "activeResigned" && (
              <Button onClick={handleExportActiveResigned} disabled={exporting} className="ml-auto">
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            )}
            {category === "newHires" && (
              <Button onClick={handleExportNewHires} disabled={exporting} className="ml-auto">
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            )}
          </div>

          {category === "activeResigned" ? (
            <>
              <p className="mt-4 text-xs text-ink-muted">
                Everyone on file, matching the count cards at the top of Employees. The date range above
                applies to the milestone and new-hire views, not to these. New Hires are people whose
                onboarding date is still ahead of them — they move into Active on their start date.
                Resigned includes anyone with a COE for Resigned in the Centralized COE Tracker; a COE
                with Purpose keeps an employee on the active list.
              </p>

              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    { key: "active" as const, label: "Active Employees", rows: activeRows },
                    { key: "newHires" as const, label: "New Hires", rows: newHireRows },
                    { key: "resigned" as const, label: "Resigned Employees", rows: allResignedRows },
                  ]
                ).map((card) => (
                  <StatCard
                    key={card.key}
                    value={card.rows.length}
                    label={`${card.label} — Total Employees`}
                    hint={openCountList === card.key ? "Hide list" : "View list"}
                    active={openCountList === card.key}
                    onClick={() => {
                      setCountSearch("");
                      setOpenCountList(openCountList === card.key ? null : card.key);
                    }}
                  />
                ))}
              </div>

              {/* Shows at a glance whether the three buckets account for everyone on file. */}
              <div className="mt-3 rounded-xl border border-border bg-background px-4 py-3 text-xs">
                <span className="text-ink-muted">Headcount check: </span>
                <span className="font-medium tabular-nums text-ink">
                  {activeRows.length} active + {newHireRows.length} new hires + {resignedRows.length}{" "}
                  resigned = {activeRows.length + newHireRows.length + resignedRows.length}
                </span>
                <span className="text-ink-muted"> of {employees.length} employee records on file.</span>
                {activeRows.length + newHireRows.length + resignedRows.length !== employees.length && (
                  <span className="ml-1 font-medium text-warn">
                    Mismatch of{" "}
                    {Math.abs(
                      employees.length - (activeRows.length + newHireRows.length + resignedRows.length)
                    )}{" "}
                    — every record should land in exactly one bucket.
                  </span>
                )}
                {orphanResignedRows.length > 0 && (
                  <span className="ml-1 text-ink-muted">
                    Resigned also lists {orphanResignedRows.length} COE record
                    {orphanResignedRows.length === 1 ? "" : "s"} whose employee is not on file, so that
                    card reads {allResignedRows.length}.
                  </span>
                )}
              </div>

              {openCountList && (
                <CountListPanel
                  title={
                    openCountList === "active"
                      ? "Active Employees"
                      : openCountList === "newHires"
                        ? "New Hires"
                        : "Resigned Employees"
                  }
                  kind={openCountList}
                  rows={
                    openCountList === "active"
                      ? activeRows
                      : openCountList === "newHires"
                        ? newHireRows
                        : allResignedRows
                  }
                  employees={employees}
                  search={countSearch}
                  onSearch={setCountSearch}
                  onSeparationDateChange={(employeeId, day) =>
                    updateEmployee(employeeId, {
                      lastDay: day ? new Date(day).toISOString() : undefined,
                      resignedStatus: day ? "resigned" : undefined,
                    })
                  }
                />
              )}
            </>
          ) : (
            <>
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
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">{dateColumnLabel}</th>
                        {isMilestoneView && <th className="px-3 py-2">Notes</th>}
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
                          <td className="px-3 py-2 text-ink-muted">{r.email || "—"}</td>
                          <td className="px-3 py-2 text-ink-muted">{formatDate(r.date, "MMMM d, yyyy")}</td>
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
                                  tone={sixthMonthNoteTone}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}


/**
 * The list behind an Active / New Hires / Resigned count card. One component for all
 * three so the search, the Employee ID column and the row layout stay identical, and
 * only the trailing date column differs.
 */
function CountListPanel({
  title,
  kind,
  rows,
  employees,
  search,
  onSearch,
  onSeparationDateChange,
}: {
  title: string;
  kind: "active" | "newHires" | "resigned";
  rows: FilterRow[];
  employees: Employee[];
  search: string;
  onSearch: (v: string) => void;
  onSeparationDateChange: (employeeId: string, day: string) => void;
}) {
  const employeeId = (id: string) =>
    employees.find((e) => e.id === id)?.companyIdNumber || "";

  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter((r) =>
        [r.name, r.position, r.department, r.email, employeeId(r.id)].some((v) =>
          (v || "").toLowerCase().includes(term)
        )
      )
    : rows;

  const dateHeading =
    kind === "resigned" ? "Separation Date" : kind === "newHires" ? "Onboarding Date" : "Date Added";

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          {title} — Total Employees: {visible.length}
          {term ? ` of ${rows.length}` : ""}
        </p>
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder="Search name, ID, position, department, email"
          className="w-full sm:w-96"
        />
      </div>

      {kind === "newHires" && (
        <p className="mb-2 text-xs text-ink-muted">
          Hired, with an onboarding date still ahead of them — they move into Active on their start
          date, with no action needed here.
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState>
          {term ? `No one matches “${search}”.` : `No ${title.toLowerCase()} on file.`}
        </EmptyState>
      ) : (
        <TableWrap maxHeight="32rem">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Employee ID</th>
                <th className="px-3 py-2">Employee Name</th>
                <th className="px-3 py-2">Position</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">{dateHeading}</th>
                {kind === "newHires" && <th className="px-3 py-2">Starts In</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const orphan = r.id.startsWith("coe-");
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink-muted">{employeeId(r.id) || "—"}</td>
                    <td className="px-3 py-2 text-ink">
                      {orphan ? (
                        r.name
                      ) : (
                        <Link href={`/employees/${r.id}`} className="hover:text-accent">
                          {r.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.position || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.department || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.email || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {kind === "resigned" && !orphan ? (
                        <div className="flex flex-col gap-0.5">
                          <Input
                            type="date"
                            value={r.date ? r.date.slice(0, 10) : ""}
                            onChange={(e) => onSeparationDateChange(r.id, e.target.value)}
                            className="min-w-[150px]"
                          />
                          <span className="text-[11px] text-ink-muted">
                            {r.date ? formatDate(r.date, "MMMM d, yyyy") : "No date on record"}
                          </span>
                        </div>
                      ) : r.date ? (
                        formatDate(r.date, "MMMM d, yyyy")
                      ) : (
                        "—"
                      )}
                    </td>
                    {kind === "newHires" && (
                      <td className="px-3 py-2">
                        {(() => {
                          const days = daysUntil(r.date);
                          return (
                            <Pill tone={days <= 7 ? "accent" : "neutral"}>
                              {days <= 0 ? "Starting today" : days === 1 ? "1 day" : `${days} days`}
                            </Pill>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
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
  const { items: regRows } = useSupabaseStore<RegularizationReportRow>("hr_report_regularization", []);
  const { items: eventRows } = useSupabaseStore<EventReportRow>("hr_report_events", []);
  const { items: planRows } = useSupabaseStore<PlanReportRow>("hr_report_plans", []);
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
        if (regRows.length > 0) {
          const s = wbInner.addWorksheet("Confirmation of Regularization");
          s.columns = [{ width: 26 }, { width: 24 }, { width: 20 }, { width: 20 }, { width: 18 }];
          const t = s.addRow(["Confirmation of Regularization Report"]);
          t.getCell(1).font = { bold: true, size: 12 };
          const h = s.addRow(["Employee Name", "Position", "Department", "Date of Regularization", "Date Created"]);
          h.eachCell((c) => {
            c.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
          });
          regRows.forEach((r) =>
            s.addRow([
              r.employeeName,
              r.position,
              r.department,
              formatDate(r.dateOfRegularization, "MMMM d, yyyy"),
              formatDate(r.dateCreated, "MMMM d, yyyy"),
            ])
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
        if (planRows.length > 0) {
          const s = wbInner.addWorksheet("Plan for Next Week");
          s.columns = [{ width: 34 }, { width: 18 }, { width: 18 }];
          const t = s.addRow(["Plan for Next Week"]);
          t.getCell(1).font = { bold: true, size: 12 };
          const h = s.addRow(["Plan for Next Week", "Start Date", "End Date"]);
          h.eachCell((c) => {
            c.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
          });
          planRows.forEach((r) =>
            s.addRow([r.plan, formatDate(r.startDate, "MMMM d, yyyy"), formatDate(r.endDate, "MMMM d, yyyy")])
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
