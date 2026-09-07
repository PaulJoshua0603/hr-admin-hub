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
  type COERequest,
  type COECategory,
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
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [profileFilter, setProfileFilter] = useState<"all" | "complete" | "incomplete">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

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
        const fullNameCol = String(row["Full Name"] || "").trim();
        let name = fullNameCol;
        if (!name) {
          const first = String(row["First Name"] || "").trim();
          const middle = String(row["Middle Name"] || "").trim();
          const last = String(row["Last Name"] || "").trim();
          name = formatFullName(first, middle, last);
        }
        if (!name || /^admin\b/i.test(name)) continue;

        const statusRaw = String(row["Employee Status"] || "").trim();
        const resigned = /resign/i.test(statusRaw);
        const rawAddress = String(row["Address"] || "")
          .replace(/^\s*Address\s*1:\s*/i, "")
          .replace(/\s*Philippines\.?\s*$/i, "")
          .replace(/\n+/g, " ")
          .trim();
        const dateAdded = todayISO();
        const gross = formatGrossAmount(row["Monthly Gross"]);
        const lastDay = parseExcelDate(row["Separation Date"]);

        imported.push({
          id: uuid(),
          name,
          position: String(row["Position"] || "").trim() || undefined,
          department: String(row["Department"] || "").trim() || undefined,
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
          companyIdNumber: String(row["Employee ID"] || "").trim() || undefined,
          biometricsNo: String(row["Biometric ID"] || "").trim() || undefined,
          philhealthNo: String(row["PhilHealth"] || "").trim() || undefined,
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
        subtitle="Onboarding requirements, milestones, and regularization tracking."
        action={
          <div className="flex items-center gap-2">
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

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-lg bg-background p-1 w-fit">
          {(["active", "inactive", "all"] as const).map((s) => {
            const count =
              s === "active"
                ? employees.filter(isActive).length
                : s === "inactive"
                ? employees.filter((e) => !isActive(e)).length
                : employees.length;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s ? "bg-surface text-accent shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {s}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    statusFilter === s ? "bg-accent-soft text-accent" : "bg-surface text-ink-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-1 rounded-lg bg-background p-1 w-fit">
          {(["all", "complete", "incomplete"] as const).map((p) => {
            const count =
              p === "all"
                ? employees.length
                : p === "complete"
                ? employees.filter(isProfileComplete).length
                : employees.filter((e) => !isProfileComplete(e)).length;
            return (
              <button
                key={p}
                onClick={() => setProfileFilter(p)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  profileFilter === p ? "bg-surface text-accent shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {p === "all" ? "All profiles" : `${p} profiles`}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    profileFilter === p ? "bg-accent-soft text-accent" : "bg-surface text-ink-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 rounded-lg bg-background p-1 w-fit">
          {(["newest", "oldest"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortOrder(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                sortOrder === s ? "bg-surface text-accent shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              {s === "newest" ? "Newest first" : "Oldest first"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {employees.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
            No employees added yet.
          </div>
        )}
        {employees
          .filter((e) => {
            if (statusFilter === "active" && !isActive(e)) return false;
            if (statusFilter === "inactive" && isActive(e)) return false;
            const complete = isProfileComplete(e);
            if (profileFilter === "complete" && !complete) return false;
            if (profileFilter === "incomplete" && complete) return false;
            return true;
          })
          .sort((a, b) => {
            const diff = a.dateAdded < b.dateAdded ? -1 : a.dateAdded > b.dateAdded ? 1 : 0;
            return sortOrder === "oldest" ? diff : -diff;
          })
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

      <COETrackingSection />
    </div>
  );
}

/* ------------------------------ COE Tracking ------------------------------ */

function COETrackingSection() {
  const { items: requests, hydrated, add, update, remove } = useSupabaseStore<COERequest>(
    "hr_coe_requests",
    []
  );
  const { notify } = useNotifications();
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<COECategory | null>(null);
  const [form, setForm] = useState<{
    category: COECategory;
    employeeName: string;
    position: string;
    department: string;
    purpose: string;
    dateRequested: string;
  }>({
    category: "withPurpose",
    employeeName: "",
    position: "",
    department: "",
    purpose: "",
    dateRequested: todayISO().slice(0, 10),
  });

  function addRequest() {
    if (!form.employeeName.trim()) return;
    add({
      id: uuid(),
      category: form.category,
      employeeName: form.employeeName.trim(),
      position: form.position.trim(),
      department: form.department.trim(),
      purpose: form.purpose.trim(),
      dateRequested: new Date(form.dateRequested).toISOString(),
    });
    notify(`COE request logged for "${form.employeeName.trim()}"`, "created");
    setForm({
      category: "withPurpose",
      employeeName: "",
      position: "",
      department: "",
      purpose: "",
      dateRequested: todayISO().slice(0, 10),
    });
    setShowForm(false);
  }

  function setDateGiven(req: COERequest, value: string) {
    update(req.id, { dateGiven: value ? new Date(value).toISOString() : undefined });
    if (value) notify(`COE marked given for "${req.employeeName}"`, "updated");
  }

  if (!hydrated) return null;

  const withPurpose = [...requests]
    .filter((r) => (r.category || "withPurpose") === "withPurpose")
    .sort((a, b) => (a.dateRequested < b.dateRequested ? 1 : -1));
  const endOfEmployment = [...requests]
    .filter((r) => r.category === "endOfEmployment")
    .sort((a, b) => (a.dateRequested < b.dateRequested ? 1 : -1));

  return (
    <div className="mt-10">
      <button
        onClick={() => setExpanded((s) => !s)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="font-display text-2xl text-ink">Certificate of Employment (COE) Tracking</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {requests.length} request{requests.length === 1 ? "" : "s"} logged. Click to{" "}
            {expanded ? "hide" : "view"} details.
          </p>
        </div>
        <span className={`text-ink-muted transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
      </button>

      {expanded && (
        <div className="mt-4">
          <div className="mb-4 flex justify-end">
            <Button onClick={() => setShowForm((s) => !s)}>+ Log COE request</Button>
          </div>

          {showForm && (
            <Card className="mb-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-ink-muted sm:col-span-2 lg:col-span-3">
                  Category
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, category: e.target.value as COECategory }))
                    }
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="withPurpose">
                      COE with Purpose — still actively employed
                    </option>
                    <option value="endOfEmployment">
                      COE for Employees Who End Their Employment
                    </option>
                  </select>
                </label>
                <Input
                  placeholder="Employee name"
                  value={form.employeeName}
                  onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))}
                  autoFocus
                />
                <Input
                  placeholder="Position"
                  value={form.position}
                  onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                />
                <Input
                  placeholder="Department"
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                />
                <Input
                  placeholder="Purpose (e.g. Bank loan, Visa application)"
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  className="sm:col-span-2 lg:col-span-2"
                />
                <label className="flex flex-col gap-1 text-xs text-ink-muted">
                  Date requested
                  <Input
                    type="date"
                    value={form.dateRequested}
                    onChange={(e) => setForm((f) => ({ ...f, dateRequested: e.target.value }))}
                  />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={addRequest}>Save</Button>
                <Button variant="ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </Card>
          )}

          <COECategoryPanel
            title="COE with Purpose"
            subtitle="Issued to employees still actively working in the company."
            requests={withPurpose}
            open={expandedCategory === "withPurpose"}
            onToggle={() =>
              setExpandedCategory((c) => (c === "withPurpose" ? null : "withPurpose"))
            }
            onDateGiven={setDateGiven}
            onRemove={(id, name) => {
              remove(id);
              notify(`COE request removed for "${name}"`, "deleted");
            }}
          />

          <div className="mt-4">
            <COECategoryPanel
              title="COE for Employees Who End Their Employment"
              subtitle="Issued to employees who have already completed or ended their employment."
              requests={endOfEmployment}
              open={expandedCategory === "endOfEmployment"}
              onToggle={() =>
                setExpandedCategory((c) => (c === "endOfEmployment" ? null : "endOfEmployment"))
              }
              onDateGiven={setDateGiven}
              onRemove={(id, name) => {
                remove(id);
                notify(`COE request removed for "${name}"`, "deleted");
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function COECategoryPanel({
  title,
  subtitle,
  requests,
  open,
  onToggle,
  onDateGiven,
  onRemove,
}: {
  title: string;
  subtitle: string;
  requests: COERequest[];
  open: boolean;
  onToggle: () => void;
  onDateGiven: (req: COERequest, value: string) => void;
  onRemove: (id: string, name: string) => void;
}) {
  return (
    <Card>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-xs text-ink-muted">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="accent">{requests.length}</Pill>
          <span className={`text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        </div>
      </button>

      {open && (
        <div className="mt-4">
          {requests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
              No COE requests logged yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2">Employee Name</th>
                    <th className="px-3 py-2">Position</th>
                    <th className="px-3 py-2">Department</th>
                    <th className="px-3 py-2">Purpose</th>
                    <th className="px-3 py-2">Date Requested</th>
                    <th className="px-3 py-2">Date COE Given</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id} className="border-t border-border">
                      <td className="px-3 py-2 text-ink">{req.employeeName}</td>
                      <td className="px-3 py-2 text-ink-muted">{req.position || "—"}</td>
                      <td className="px-3 py-2 text-ink-muted">{req.department || "—"}</td>
                      <td className="px-3 py-2 text-ink-muted">{req.purpose || "—"}</td>
                      <td className="px-3 py-2 text-ink-muted">{formatDate(req.dateRequested)}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="date"
                          value={req.dateGiven ? req.dateGiven.slice(0, 10) : ""}
                          onChange={(e) => onDateGiven(req, e.target.value)}
                          className="min-w-[150px]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => onRemove(req.id, req.employeeName)}
                          className="text-xs text-ink-muted hover:text-warn"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
