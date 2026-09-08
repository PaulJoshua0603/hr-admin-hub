"use client";

import { useState } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
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
          realcognitaEmail: String(row["Email"] || "").trim() || undefined,
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

      <AdvancedFilterView employees={employees} />
    </div>
  );
}

/* ------------------------- Advanced Filtering & Views ------------------------- */

type FilterCategory = "milestones" | "resigned" | "newHires";
type MilestoneType = "birthday" | "third" | "sixth" | "oneYear";

type FilterRow = {
  id: string;
  name: string;
  position: string;
  department: string;
  email: string;
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

function AdvancedFilterView({ employees }: { employees: Employee[] }) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<FilterCategory>("milestones");
  const [milestoneType, setMilestoneType] = useState<MilestoneType>("birthday");
  const today = new Date();
  const [startDate, setStartDate] = useState(startOfMonthISO(today));
  const [endDate, setEndDate] = useState(endOfMonthISO(today));
  const [exporting, setExporting] = useState(false);
  const { notify } = useNotifications();

  function applyPreset(preset: "week" | "month") {
    if (preset === "week") {
      setStartDate(startOfWeekISO(today));
      setEndDate(endOfWeekISO(today));
    } else {
      setStartDate(startOfMonthISO(today));
      setEndDate(endOfMonthISO(today));
    }
  }

  const rows: FilterRow[] = (() => {
    if (category === "resigned") {
      return employees
        .filter((e) => e.lastDay && inRange(e.lastDay, startDate, endDate))
        .map((e) => ({
          id: e.id,
          name: e.name,
          position: e.position || "",
          department: e.department || "",
          email: e.realcognitaEmail || "",
          date: e.lastDay!,
        }));
    }
    if (category === "newHires") {
      return employees
        .filter((e) => e.dateHired && inRange(e.dateHired, startDate, endDate))
        .map((e) => ({
          id: e.id,
          name: e.name,
          position: e.position || "",
          department: e.department || "",
          email: e.realcognitaEmail || "",
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
          date: d.toISOString(),
        };
      })
      .filter((r) => inRange(r.date, startDate, endDate));
  })().sort((a, b) => (a.date < b.date ? -1 : 1));

  const dateColumnLabel =
    category === "resigned"
      ? "Separation Date"
      : category === "newHires"
      ? "Hired Date"
      : milestoneType === "birthday"
      ? "Birthday"
      : "Milestone Date";

  async function handleExport() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Filtered View");
      ws.columns = [
        { width: 26 },
        { width: 24 },
        { width: 20 },
        { width: 28 },
        { width: 18 },
      ];
      const headerRow = ws.addRow(["Employee Name", "Position", "Department", "Email", dateColumnLabel]);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } };
      });
      rows.forEach((r) => {
        ws.addRow([r.name, r.position, r.department, r.email, formatDate(r.date, "MMMM d, yyyy")]);
      });
      ws.addRow([]);
      const totalRow = ws.addRow([`Total: ${rows.length}`]);
      totalRow.getCell(1).font = { bold: true };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const catLabel = category === "milestones" ? milestoneType : category;
      a.download = `${catLabel}_${startDate}_to_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Exported ${rows.length} record(s) to Excel`, "created");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mt-10">
      <button
        onClick={() => setExpanded((s) => !s)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="font-display text-2xl text-ink">Advanced Filtering & Custom Views</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Filter by Milestones, Resigned Employees, or New Hires within a date range.
          </p>
        </div>
        <span className={`text-ink-muted transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
      </button>

      {expanded && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-background p-1 w-fit">
              {([
                { id: "milestones" as const, label: "Milestones" },
                { id: "resigned" as const, label: "Resigned Employees" },
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

            {category === "milestones" && (
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
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              End date
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <Button variant="ghost" onClick={() => applyPreset("week")}>
              This Week
            </Button>
            <Button variant="ghost" onClick={() => applyPreset("month")}>
              This Month
            </Button>
            <Button onClick={handleExport} disabled={exporting || rows.length === 0} className="ml-auto">
              {exporting ? "Exporting…" : "Export to Excel"}
            </Button>
          </div>

          <p className="mt-4 text-sm font-medium text-ink">Total: {rows.length}</p>

          {rows.length === 0 ? (
            <div className="mt-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
              No matching records for this filter and date range.
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2">Employee Name</th>
                    <th className="px-3 py-2">Position</th>
                    <th className="px-3 py-2">Department</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">{dateColumnLabel}</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
