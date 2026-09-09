"use client";

import { useState } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { format } from "date-fns";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { addDaysISO, formatDate, isOverdue, todayISO } from "@/lib/dates";
import { Button, Card, Input, Pill, SectionHeading } from "@/components/ui";
import {
  emptyPreEmploymentChecklist,
  emptyRequirements,
  getLackingRequirements,
  getMissingCriticalItems,
  defaultOnboardingChecklist,
  type Employee,
  type MilestoneNote,
  type COERequest,
} from "@/types";
import { useNotifications } from "@/lib/notificationContext";

function isProfileComplete(e: Employee): boolean {
  const hasDetails = !!e.birthday && !!e.dateHired;
  const hasCompensation = !!e.basicSalary && !!e.totalMonthlyGrossCompensation;
  const hasIdentification =
    !!e.philhealthNo && !!e.companyIdNumber && !!e.biometricsNo && !!e.realcognitaEmail && !!e.homeAddress;
  const hasRequirements = getLackingRequirements(e).length === 0;
  const hasOnboarding = (e.onboardingChecklist?.length || 0) > 0;
  return hasDetails && hasCompensation && hasIdentification && hasRequirements && hasOnboarding;
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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
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
    if (val instanceof Date) return val.toISOString();
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!trimmed || /not yet set/i.test(trimmed)) return undefined;
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof val === "number") {
      // Excel serial date
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? undefined : d.toISOString();
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
        const resigned = /resign|terminat/i.test(statusRaw);
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
            <label className="cursor-pointer">
              <span
                className={`inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-background ${
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
  const [expanded, setExpanded] = useState(true);
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

  const activeRows: FilterRow[] = employees
    .filter((e) => !e.lastDay && e.resignedStatus !== "resigned")
    .filter((e) => inRange(e.dateAdded, startDate, endDate))
    .map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position || "",
      department: e.department || "",
      email: e.realcognitaEmail || "",
      supervisor: e.immediateSupervisor || "",
      date: e.dateAdded,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const resignedRows: FilterRow[] = employees
    .filter((e) => e.lastDay && inRange(e.lastDay, startDate, endDate))
    .map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position || "",
      department: e.department || "",
      email: e.realcognitaEmail || "",
      supervisor: e.immediateSupervisor || "",
      date: e.lastDay!,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

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

  function computeActiveResignedForRange(rangeStart: string, rangeEnd: string) {
    const active = employees
      .filter((e) => !e.lastDay && e.resignedStatus !== "resigned")
      .filter((e) => inRange(e.dateAdded, rangeStart, rangeEnd));
    const resigned = employees.filter((e) => e.lastDay && inRange(e.lastDay, rangeStart, rangeEnd));
    return { active, resigned };
  }

  async function handleExportActiveResigned() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      function buildSheet(sheetName: string, rangeStart: string, rangeEnd: string) {
        const ws = wb.addWorksheet(sheetName);
        ws.columns = [{ width: 26 }, { width: 22 }, { width: 20 }, { width: 28 }, { width: 16 }];
        const { active, resigned } = computeActiveResignedForRange(rangeStart, rangeEnd);

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
          ws.addRow([e.name, e.position || "", e.department || "", e.realcognitaEmail || "", formatDate(e.lastDay!, "MMMM d, yyyy")])
        );
        ws.addRow([]);
        const totalRow = ws.addRow([`Total: ${active.length + resigned.length} (Active: ${active.length}, Resigned: ${resigned.length})`]);
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
      a.download = `${dynamicFileName("Active/Resigned")}.xlsx`;
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
              <p className="mt-4 text-sm font-medium text-ink">
                Active Employees — Total: {activeRows.length}
              </p>
              {activeRows.length === 0 ? (
                <div className="mt-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
                  No active employees in this date range.
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
                        <th className="px-3 py-2">Date Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRows.map((r) => (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-6 text-sm font-medium text-ink">
                Resigned Employees — Total: {resignedRows.length}
              </p>
              {resignedRows.length === 0 ? (
                <div className="mt-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
                  No resigned employees in this date range.
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
                        <th className="px-3 py-2">Separation Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resignedRows.map((r) => (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mt-4 text-sm font-medium text-ink">Total: {rows.length}</p>

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
                              <Input
                                placeholder="e.g. Done, Messaged"
                                defaultValue={noteFor(r.id, milestoneType)}
                                onBlur={(e) => setNoteFor(r.id, milestoneType, e.target.value)}
                                className="min-w-[160px]"
                              />
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

/* ------------------------- Centralized COE Tracker ------------------------- */

function CentralizedCOETracker({ employees }: { employees: Employee[] }) {
  const { items: requests, hydrated, remove } = useSupabaseStore<COERequest>(
    "hr_coe_requests",
    []
  );
  const { update: updateEmployee } = useSupabaseStore<Employee>("hr_employees", []);
  const [expanded, setExpanded] = useState(false);
  const today = new Date();
  const [preset, setPreset] = useState<TimeframePreset>("month");
  const [startDate, setStartDate] = useState(startOfMonthISO(today));
  const [endDate, setEndDate] = useState(endOfMonthISO(today));
  const [exporting, setExporting] = useState(false);
  const { notify } = useNotifications();

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
    if (preset === "week") {
      const sameMonth = monday.getMonth() === friday.getMonth();
      const coverage = sameMonth
        ? `${format(monday, "MMMM d")}-${format(friday, "d, yyyy")}`
        : `${format(monday, "MMMM d")}-${format(friday, "MMMM d, yyyy")}`;
      return `COE_${coverage}`;
    }
    if (preset === "year") return `COE_${monday.getFullYear()}`;
    return `COE_${format(monday, "MMMM yyyy")}`;
  }

  async function handleExport() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      function buildSheet(name: string, rows: COERequest[]) {
        const ws = wb.addWorksheet(name);
        ws.columns = [
          { width: 26 },
          { width: 24 },
          { width: 20 },
          { width: 16 },
          { width: 24 },
          { width: 16 },
        ];
        const headerRow = ws.addRow([
          "Employee Name",
          "Position",
          "Department",
          "Date Requested",
          "Purpose",
          "Date Issued",
        ]);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
        });
        rows.forEach((r) => {
          ws.addRow([
            r.employeeName,
            r.position,
            r.department,
            formatDate(r.dateRequested, "MMMM d, yyyy"),
            r.category === "endOfEmployment" ? "Resigned" : r.purpose || "—",
            r.dateGiven ? formatDate(r.dateGiven, "MMMM d, yyyy") : "—",
          ]);
        });
      }

      buildSheet(
        "COE with Purpose",
        filtered.filter((r) => r.category !== "endOfEmployment")
      );
      buildSheet(
        "COE for Resigned",
        filtered.filter((r) => r.category === "endOfEmployment")
      );

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

          <p className="mt-4 text-sm font-medium text-ink">Total: {filtered.length}</p>

          {filtered.length === 0 ? (
            <div className="mt-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
              No COE requests logged in this date range.
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead>
                  <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2">Employee Name</th>
                    <th className="px-3 py-2">Position</th>
                    <th className="px-3 py-2">Department</th>
                    <th className="px-3 py-2">Date Requested</th>
                    <th className="px-3 py-2">Purpose</th>
                    <th className="px-3 py-2">Date Issued</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const emp = employees.find(
                      (e) => e.name.trim().toLowerCase() === r.employeeName.trim().toLowerCase()
                    );
                    return (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-2 text-ink">
                          {emp ? (
                            <Link href={`/employees/${emp.id}`} className="hover:text-accent">
                              {r.employeeName}
                            </Link>
                          ) : (
                            r.employeeName
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{r.position || "—"}</td>
                        <td className="px-3 py-2 text-ink-muted">{r.department || "—"}</td>
                        <td className="px-3 py-2 text-ink-muted">{formatDate(r.dateRequested, "MMMM d, yyyy")}</td>
                        <td className="px-3 py-2 text-ink-muted">
                          {r.category === "endOfEmployment" ? "Resigned" : r.purpose || "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">
                          {r.dateGiven ? formatDate(r.dateGiven, "MMMM d, yyyy") : "—"}
                        </td>
                        <td className="px-3 py-2">
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
                                  notify(
                                    `${r.employeeName} — milestone tracking restored`,
                                    "updated"
                                  );
                                }
                              }
                            }}
                            className="text-xs text-ink-muted hover:text-warn"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
