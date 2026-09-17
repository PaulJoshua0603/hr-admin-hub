"use client";

import { useState } from "react";
import { v4 as uuid } from "uuid";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, CollapsibleSection, Input, SectionHeading } from "@/components/ui";
import { EmployeeNameInput } from "@/components/EmployeeNameInput";
import { addMonthsISO, formatDate, formatTime24, todayISO } from "@/lib/dates";
import { useNotifications } from "@/lib/notificationContext";
import type {
  ER2ReportRow,
  RegularizationReportRow,
  EventReportRow,
  PlanReportRow,
  CustomReportTable,
  COERequest,
  COECategory,
} from "@/types";
import { EMPLOYMENT_MILESTONE_MONTHS } from "@/types";
import { ReportExportSection } from "./ExportSection";
import { SixthMonthReport } from "./SixthMonthReport";
import { ER2FormSection } from "./ER2FormSection";

export default function ReportsPage() {
  return (
    <div>
      <SectionHeading
        title="Reports"
        subtitle="Click a report to open it. Everything here is automatically included whenever you export the Centralized COE Tracker to Excel."
      />
      <div className="flex flex-col gap-6">
        <ER2Table />
        <ER2FormSection />
        <RegularizationTable />
        <COEReportSection />
        <SixthMonthReport />
        <EventsTable />
        <PlanTable />
        <CustomTablesSection />
        <ReportExportSection />
        
      </div>
    </div>
  );
}

/* ------------------------------ Shared bits ------------------------------ */

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-3">
      <button onClick={onEdit} className="text-xs text-accent hover:underline">
        Edit
      </button>
      <button onClick={onDelete} className="text-xs text-ink-muted hover:text-warn">
        Delete
      </button>
    </div>
  );
}

function EditActions({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-3">
      <button onClick={onSave} className="text-xs text-accent hover:underline">
        Save
      </button>
      <button onClick={onCancel} className="text-xs text-ink-muted hover:text-ink">
        Cancel
      </button>
    </div>
  );
}

function toISO(day: string): string {
  return day ? new Date(day).toISOString() : "";
}

/** Record count for a table. Derived from the store, so it tracks add/edit/delete. */
function TableTotal({ label, count }: { label: string; count: number }) {
  return (
    <p className="mt-3 text-sm font-medium text-ink">
      {label}: {count}
    </p>
  );
}

/* ------------------------------ ER2 Form ------------------------------ */

type ER2Draft = { employeeName: string; position: string; department: string; dateCreated: string };

function ER2Table() {
  const { items, hydrated, add, update, remove } = useSupabaseStore<ER2ReportRow>("hr_report_er2", []);
  /** Latest first — the newest record is the one being worked on. */
  const sortedItems = [...items].sort((a, b) => (a.dateCreated < b.dateCreated ? 1 : -1));
  const { notify } = useNotifications();
  const [form, setForm] = useState<ER2Draft>({
    employeeName: "",
    position: "",
    department: "",
    dateCreated: todayISO().slice(0, 10),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ER2Draft>({
    employeeName: "",
    position: "",
    department: "",
    dateCreated: todayISO().slice(0, 10),
  });

  function addRow() {
    if (!form.employeeName.trim()) return;
    add({
      id: uuid(),
      employeeName: form.employeeName,
      position: form.position,
      department: form.department,
      dateCreated: toISO(form.dateCreated) || todayISO(),
    });
    setForm({ employeeName: "", position: "", department: "", dateCreated: todayISO().slice(0, 10) });
    notify("ER2 row added", "created");
  }

  function startEdit(r: ER2ReportRow) {
    setEditingId(r.id);
    setDraft({
      employeeName: r.employeeName,
      position: r.position,
      department: r.department,
      dateCreated: r.dateCreated.slice(0, 10),
    });
  }

  function saveEdit(id: string) {
    if (!draft.employeeName.trim()) return;
    update(id, {
      employeeName: draft.employeeName,
      position: draft.position,
      department: draft.department,
      dateCreated: toISO(draft.dateCreated) || todayISO(),
    });
    setEditingId(null);
    notify("ER2 row updated", "updated");
  }

  if (!hydrated) return null;
  return (
    <CollapsibleSection title="ER2 Form for PhilHealth Report" count={items.length}>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
        <EmployeeNameInput
          value={form.employeeName}
          onChange={(employeeName) => setForm((f) => ({ ...f, employeeName }))}
          onSelect={(e) =>
            setForm((f) => ({
              ...f,
              employeeName: e.name,
              position: e.position,
              department: e.department,
            }))
          }
        />
        <Input placeholder="Position" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} />
        <Input placeholder="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
        <Input type="date" value={form.dateCreated} onChange={(e) => setForm((f) => ({ ...f, dateCreated: e.target.value }))} />
        <Button onClick={addRow}>+ Add</Button>
      </div>
      <TableTotal label="Total Employees" count={items.length} />
      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Employee Name</th>
                <th className="px-3 py-2">Position</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Date Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <EmployeeNameInput
                        value={draft.employeeName}
                        onChange={(employeeName) => setDraft((d) => ({ ...d, employeeName }))}
                        onSelect={(e) =>
                          setDraft((d) => ({
                            ...d,
                            employeeName: e.name,
                            position: e.position,
                            department: e.department,
                          }))
                        }
                        className="min-w-[180px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.position} onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={draft.dateCreated}
                        onChange={(e) => setDraft((d) => ({ ...d, dateCreated: e.target.value }))}
                        className="min-w-[150px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <EditActions onSave={() => saveEdit(r.id)} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{r.employeeName}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.position || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.department || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.dateCreated, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2">
                      <RowActions
                        onEdit={() => startEdit(r)}
                        onDelete={() => {
                          remove(r.id);
                          notify("ER2 row deleted", "deleted");
                        }}
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------- Confirmation of Regularization ------------------------- */

/**
 * The 6th-month milestone date for a hire date, ready for a date input.
 *
 * The letter confirms regularization on the day the Employment Milestones panel says it
 * falls, so the report derives it the same way that panel does rather than asking the user
 * to copy it across and risk the two disagreeing. It stays editable: the date can be moved
 * if regularization actually happened on another day.
 */
function sixthMonthDateInput(dateHired?: string): string {
  if (!dateHired) return "";
  return addMonthsISO(dateHired, EMPLOYMENT_MILESTONE_MONTHS.sixthMonth).slice(0, 10);
}

type RegDraft = {
  employeeName: string;
  position: string;
  department: string;
  dateOfRegularization: string;
  dateCreated: string;
};

function emptyRegDraft(): RegDraft {
  return {
    employeeName: "",
    position: "",
    department: "",
    dateOfRegularization: todayISO().slice(0, 10),
    dateCreated: todayISO().slice(0, 10),
  };
}

function RegularizationTable() {
  const { items, hydrated, add, update, remove } = useSupabaseStore<RegularizationReportRow>(
    "hr_report_regularization",
    []
  );
  /** Latest first. */
  const sortedItems = [...items].sort((a, b) => (a.dateCreated < b.dateCreated ? 1 : -1));
  const { notify } = useNotifications();
  const [form, setForm] = useState<RegDraft>(emptyRegDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RegDraft>(emptyRegDraft());

  function addRow() {
    if (!form.employeeName.trim()) return;
    add({
      id: uuid(),
      employeeName: form.employeeName,
      position: form.position,
      department: form.department,
      dateOfRegularization: toISO(form.dateOfRegularization),
      dateCreated: toISO(form.dateCreated) || todayISO(),
    });
    setForm(emptyRegDraft());
    notify("Regularization row added", "created");
  }

  function startEdit(r: RegularizationReportRow) {
    setEditingId(r.id);
    setDraft({
      employeeName: r.employeeName,
      position: r.position,
      department: r.department,
      dateOfRegularization: r.dateOfRegularization.slice(0, 10),
      dateCreated: r.dateCreated.slice(0, 10),
    });
  }

  function saveEdit(id: string) {
    if (!draft.employeeName.trim()) return;
    update(id, {
      employeeName: draft.employeeName,
      position: draft.position,
      department: draft.department,
      dateOfRegularization: toISO(draft.dateOfRegularization),
      dateCreated: toISO(draft.dateCreated) || todayISO(),
    });
    setEditingId(null);
    notify("Regularization row updated", "updated");
  }

  if (!hydrated) return null;
  return (
    <CollapsibleSection title="Confirmation of Regularization Report" count={items.length}>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-6 sm:items-end">
        <EmployeeNameInput
          value={form.employeeName}
          onChange={(employeeName) => setForm((f) => ({ ...f, employeeName }))}
          onSelect={(e) =>
            setForm((f) => ({
              ...f,
              employeeName: e.name,
              position: e.position,
              department: e.department,
              dateOfRegularization: sixthMonthDateInput(e.dateHired) || f.dateOfRegularization,
            }))
          }
        />
        <Input placeholder="Position" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} />
        <Input placeholder="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Date Created
          <Input type="date" value={form.dateCreated} onChange={(e) => setForm((f) => ({ ...f, dateCreated: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Date of Regularization
          <Input type="date" value={form.dateOfRegularization} onChange={(e) => setForm((f) => ({ ...f, dateOfRegularization: e.target.value }))} />
        </label>
        <Button onClick={addRow} className="self-end">+ Add</Button>
      </div>
      <TableTotal label="Total Employees" count={items.length} />
      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Employee Name</th>
                <th className="px-3 py-2">Position</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Date Created</th>
                <th className="px-3 py-2">Date of Regularization</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <EmployeeNameInput
                        value={draft.employeeName}
                        onChange={(employeeName) => setDraft((d) => ({ ...d, employeeName }))}
                        onSelect={(e) =>
                          setDraft((d) => ({
                            ...d,
                            employeeName: e.name,
                            position: e.position,
                            department: e.department,
                            dateOfRegularization:
                              sixthMonthDateInput(e.dateHired) || d.dateOfRegularization,
                          }))
                        }
                        className="min-w-[180px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.position} onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={draft.dateCreated}
                        onChange={(e) => setDraft((d) => ({ ...d, dateCreated: e.target.value }))}
                        className="min-w-[150px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={draft.dateOfRegularization}
                        onChange={(e) => setDraft((d) => ({ ...d, dateOfRegularization: e.target.value }))}
                        className="min-w-[150px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <EditActions onSave={() => saveEdit(r.id)} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{r.employeeName}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.position || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.department || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.dateCreated, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.dateOfRegularization, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2">
                      <RowActions
                        onEdit={() => startEdit(r)}
                        onDelete={() => {
                          remove(r.id);
                          notify("Regularization row deleted", "deleted");
                        }}
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------ COE tables ------------------------------ */

type COEDraft = {
  employeeName: string;
  position: string;
  department: string;
  email: string;
  purpose: string;
  dateRequested: string;
  dateGiven: string;
};

function emptyCOEDraft(): COEDraft {
  return {
    employeeName: "",
    position: "",
    department: "",
    email: "",
    purpose: "",
    dateRequested: todayISO().slice(0, 10),
    dateGiven: "",
  };
}

/**
 * Reads and writes the same `hr_coe_requests` store the Centralized COE Tracker on the
 * Employees page uses, so records stay in step in both places.
 */
function COEReportSection() {
  const { items, hydrated, add, update, remove } = useSupabaseStore<COERequest>("hr_coe_requests", []);
  const { notify } = useNotifications();

  if (!hydrated) return null;

  const sorted = [...items].sort((a, b) => (a.dateRequested < b.dateRequested ? 1 : -1));

  return (
    <div className="flex flex-col gap-6">
      <COECategoryTable
        category="withPurpose"
        title="COE with Purpose"
        rows={sorted.filter((r) => r.category !== "endOfEmployment")}
        add={add}
        update={update}
        remove={remove}
        notify={notify}
      />
      <COECategoryTable
        category="endOfEmployment"
        title="COE for Resigned Employees"
        rows={sorted.filter((r) => r.category === "endOfEmployment")}
        add={add}
        update={update}
        remove={remove}
        notify={notify}
      />
    </div>
  );
}

function COECategoryTable({
  category,
  title,
  rows,
  add,
  update,
  remove,
  notify,
}: {
  category: COECategory;
  title: string;
  rows: COERequest[];
  add: (item: COERequest) => void;
  update: (id: string, patch: Partial<COERequest>) => void;
  remove: (id: string) => void;
  notify: (message: string, kind?: "created" | "updated" | "deleted") => void;
}) {
  const withPurpose = category !== "endOfEmployment";
  const [form, setForm] = useState<COEDraft>(emptyCOEDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<COEDraft>(emptyCOEDraft());

  function addRow() {
    if (!form.employeeName.trim()) return;
    add({
      id: uuid(),
      category,
      employeeName: form.employeeName.trim(),
      position: form.position,
      department: form.department,
      email: form.email,
      purpose: withPurpose ? form.purpose : "",
      dateRequested: toISO(form.dateRequested) || todayISO(),
      dateGiven: form.dateGiven ? toISO(form.dateGiven) : undefined,
    });
    setForm(emptyCOEDraft());
    notify(`${title} record added`, "created");
  }

  function startEdit(r: COERequest) {
    setEditingId(r.id);
    setDraft({
      employeeName: r.employeeName,
      position: r.position,
      department: r.department,
      email: r.email || "",
      purpose: r.purpose || "",
      dateRequested: r.dateRequested.slice(0, 10),
      dateGiven: r.dateGiven ? r.dateGiven.slice(0, 10) : "",
    });
  }

  function saveEdit(id: string) {
    if (!draft.employeeName.trim()) return;
    update(id, {
      employeeName: draft.employeeName.trim(),
      position: draft.position,
      department: draft.department,
      email: draft.email,
      purpose: withPurpose ? draft.purpose : "",
      dateRequested: toISO(draft.dateRequested) || todayISO(),
      dateGiven: draft.dateGiven ? toISO(draft.dateGiven) : undefined,
    });
    setEditingId(null);
    notify(`${title} record updated`, "updated");
  }

  return (
    <CollapsibleSection
      title={title}
      count={rows.length}
      subtitle="Shared with the Centralized COE Tracker under Employees — edits here show up there, and the other way around."
    >
      <div className={`mt-3 grid grid-cols-1 gap-2 sm:items-end ${withPurpose ? "sm:grid-cols-7" : "sm:grid-cols-6"}`}>
        <EmployeeNameInput
          value={form.employeeName}
          onChange={(employeeName) => setForm((f) => ({ ...f, employeeName }))}
          onSelect={(e) =>
            setForm((f) => ({
              ...f,
              employeeName: e.name,
              position: e.position,
              department: e.department,
              email: e.email || f.email,
            }))
          }
        />
        <Input placeholder="Position" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} />
        <Input placeholder="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
        <Input placeholder="Email Address" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        {withPurpose && (
          <Input placeholder="Purpose" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
        )}
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Date Requested
          <Input type="date" value={form.dateRequested} onChange={(e) => setForm((f) => ({ ...f, dateRequested: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Date Issued
          <Input type="date" value={form.dateGiven} onChange={(e) => setForm((f) => ({ ...f, dateGiven: e.target.value }))} />
        </label>
      </div>
      <Button className="mt-2" onClick={addRow}>+ Add</Button>

      <TableTotal label="Total Employees" count={rows.length} />
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1040px] text-left text-sm">
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
              {rows.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <EmployeeNameInput
                        value={draft.employeeName}
                        onChange={(employeeName) => setDraft((d) => ({ ...d, employeeName }))}
                        onSelect={(e) =>
                          setDraft((d) => ({
                            ...d,
                            employeeName: e.name,
                            position: e.position,
                            department: e.department,
                            email: e.email || d.email,
                          }))
                        }
                        className="min-w-[180px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.position} onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} className="min-w-[180px]" />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={draft.dateRequested}
                        onChange={(e) => setDraft((d) => ({ ...d, dateRequested: e.target.value }))}
                        className="min-w-[150px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {withPurpose ? (
                        <Input value={draft.purpose} onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))} />
                      ) : (
                        <span className="text-ink-muted">Resigned</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={draft.dateGiven}
                        onChange={(e) => setDraft((d) => ({ ...d, dateGiven: e.target.value }))}
                        className="min-w-[150px]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <EditActions onSave={() => saveEdit(r.id)} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{r.employeeName}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.position || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.department || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.email || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.dateRequested, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2 text-ink-muted">{withPurpose ? r.purpose || "—" : "Resigned"}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {r.dateGiven ? formatDate(r.dateGiven, "MMMM d, yyyy") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <RowActions
                        onEdit={() => startEdit(r)}
                        onDelete={() => {
                          remove(r.id);
                          notify(`COE record deleted for "${r.employeeName}"`, "deleted");
                        }}
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------ Events Attended ------------------------------ */

type EventDraft = { eventName: string; date: string; time: string; endTime: string; location: string };

function emptyEventDraft(): EventDraft {
  return { eventName: "", date: todayISO().slice(0, 10), time: "", endTime: "", location: "" };
}

function EventsTable() {
  const { items, hydrated, add, update, remove } = useSupabaseStore<EventReportRow>("hr_report_events", []);
  /** Most recent event first. */
  const sortedItems = [...items].sort((a, b) => (a.date < b.date ? 1 : -1));
  const { notify } = useNotifications();
  const [form, setForm] = useState<EventDraft>(emptyEventDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft>(emptyEventDraft());

  function addRow() {
    if (!form.eventName.trim()) return;
    add({
      id: uuid(),
      eventName: form.eventName,
      date: toISO(form.date),
      time: form.time,
      endTime: form.endTime,
      location: form.location,
    });
    setForm(emptyEventDraft());
    notify("Event row added", "created");
  }

  function startEdit(r: EventReportRow) {
    setEditingId(r.id);
    setDraft({
      eventName: r.eventName,
      date: r.date.slice(0, 10),
      time: r.time,
      endTime: r.endTime || "",
      location: r.location,
    });
  }

  function saveEdit(id: string) {
    if (!draft.eventName.trim()) return;
    update(id, {
      eventName: draft.eventName,
      date: toISO(draft.date),
      time: draft.time,
      endTime: draft.endTime,
      location: draft.location,
    });
    setEditingId(null);
    notify("Event row updated", "updated");
  }

  if (!hydrated) return null;
  return (
    <CollapsibleSection title="Events Attended Report" count={items.length}>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-6 sm:items-end">
        <Input placeholder="Event Name" value={form.eventName} onChange={(e) => setForm((f) => ({ ...f, eventName: e.target.value }))} />
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Date
          <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Start Time
          <Input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          End Time
          <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
        </label>
        <Input placeholder="Location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
        <Button onClick={addRow}>+ Add</Button>
      </div>
      <TableTotal label="Total Events" count={items.length} />
      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Event Name</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Start Time</th>
                <th className="px-3 py-2">End Time</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Input value={draft.eventName} onChange={(e) => setDraft((d) => ({ ...d, eventName: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} className="min-w-[150px]" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="time" value={draft.time} onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="time" value={draft.endTime} onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <EditActions onSave={() => saveEdit(r.id)} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{r.eventName}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.date, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatTime24(r.time) || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatTime24(r.endTime || "") || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.location || "—"}</td>
                    <td className="px-3 py-2">
                      <RowActions
                        onEdit={() => startEdit(r)}
                        onDelete={() => {
                          remove(r.id);
                          notify("Event row deleted", "deleted");
                        }}
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------ Plan for Next Week ------------------------------ */

type PlanDraft = { plan: string; startDate: string; endDate: string };

function PlanTable() {
  const { items, hydrated, add, update, remove } = useSupabaseStore<PlanReportRow>("hr_report_plans", []);
  /** Most recent plan first, by the week it starts. */
  const sortedItems = [...items].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const { notify } = useNotifications();
  const [form, setForm] = useState<PlanDraft>({ plan: "", startDate: todayISO().slice(0, 10), endDate: todayISO().slice(0, 10) });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft>({ plan: "", startDate: todayISO().slice(0, 10), endDate: todayISO().slice(0, 10) });

  function addRow() {
    if (!form.plan.trim()) return;
    add({ id: uuid(), plan: form.plan, startDate: toISO(form.startDate), endDate: toISO(form.endDate) });
    setForm({ plan: "", startDate: todayISO().slice(0, 10), endDate: todayISO().slice(0, 10) });
    notify("Plan added", "created");
  }

  function startEdit(r: PlanReportRow) {
    setEditingId(r.id);
    setDraft({ plan: r.plan, startDate: r.startDate.slice(0, 10), endDate: r.endDate.slice(0, 10) });
  }

  function saveEdit(id: string) {
    if (!draft.plan.trim()) return;
    update(id, { plan: draft.plan, startDate: toISO(draft.startDate), endDate: toISO(draft.endDate) });
    setEditingId(null);
    notify("Plan updated", "updated");
  }

  if (!hydrated) return null;
  return (
    <CollapsibleSection title="Plan for Next Week" count={items.length}>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <Input placeholder="Plan for Next Week" value={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))} className="sm:col-span-2" />
        <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
        <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
      </div>
      <Button className="mt-2" onClick={addRow}>+ Add</Button>
      <TableTotal label="Total Plans" count={items.length} />
      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Plan for Next Week</th>
                <th className="px-3 py-2">Start Date</th>
                <th className="px-3 py-2">End Date</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Input value={draft.plan} onChange={(e) => setDraft((d) => ({ ...d, plan: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="date" value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} className="min-w-[150px]" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="date" value={draft.endDate} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} className="min-w-[150px]" />
                    </td>
                    <td className="px-3 py-2">
                      <EditActions onSave={() => saveEdit(r.id)} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{r.plan}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.startDate, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.endDate, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2">
                      <RowActions
                        onEdit={() => startEdit(r)}
                        onDelete={() => {
                          remove(r.id);
                          notify("Plan deleted", "deleted");
                        }}
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------ Custom Tables ------------------------------ */

function CustomTablesSection() {
  const { items, hydrated, add, update, remove } = useSupabaseStore<CustomReportTable>(
    "hr_report_custom_tables",
    []
  );
  const { notify } = useNotifications();
  const [showNewTable, setShowNewTable] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColumns, setNewColumns] = useState("");

  function createTable() {
    if (!newTitle.trim() || !newColumns.trim()) return;
    const columns = newColumns.split(",").map((c) => c.trim()).filter(Boolean);
    add({ id: uuid(), title: newTitle.trim(), columns, rows: [] });
    setNewTitle("");
    setNewColumns("");
    setShowNewTable(false);
    notify(`Custom table "${newTitle.trim()}" created`, "created");
  }

  if (!hydrated) return null;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl text-ink">Additional Custom Tables</h2>
        <Button variant="ghost" onClick={() => setShowNewTable((s) => !s)}>
          + New custom table
        </Button>
      </div>

      {showNewTable && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input placeholder="Table title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <Input
              placeholder="Columns, comma separated (e.g. Name, Amount, Notes)"
              value={newColumns}
              onChange={(e) => setNewColumns(e.target.value)}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <Button onClick={createTable}>Create</Button>
            <Button variant="ghost" onClick={() => setShowNewTable(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {items.map((table) => (
          <CustomTableCard
            key={table.id}
            table={table}
            onUpdate={(next) => update(table.id, next)}
            onDelete={() => {
              remove(table.id);
              notify(`Custom table "${table.title}" deleted`, "deleted");
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CustomTableCard({
  table,
  onUpdate,
  onDelete,
}: {
  table: CustomReportTable;
  onUpdate: (next: Partial<CustomReportTable>) => void;
  onDelete: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draftRow, setDraftRow] = useState<Record<string, string>>({});

  const nameColumn = table.columns.find((c) => /name/i.test(c));

  function addRow() {
    if (table.columns.every((c) => !newRow[c]?.trim())) return;
    onUpdate({ rows: [...table.rows, newRow] });
    setNewRow({});
  }

  function deleteRow(idx: number) {
    onUpdate({ rows: table.rows.filter((_, i) => i !== idx) });
    if (editingIdx === idx) setEditingIdx(null);
  }

  function saveRow(idx: number) {
    onUpdate({ rows: table.rows.map((row, i) => (i === idx ? draftRow : row)) });
    setEditingIdx(null);
  }

  function applyPicked(
    setRow: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    position: string,
    department: string
  ) {
    const positionCol = table.columns.find((c) => /position/i.test(c));
    const departmentCol = table.columns.find((c) => /department/i.test(c));
    setRow((r) => ({
      ...r,
      ...(positionCol ? { [positionCol]: position } : {}),
      ...(departmentCol ? { [departmentCol]: department } : {}),
    }));
  }

  function cellInput(
    col: string,
    row: Record<string, string>,
    setRow: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) {
    const value = row[col] || "";
    if (col === nameColumn) {
      return (
        <EmployeeNameInput
          value={value}
          placeholder={col}
          onChange={(next) => setRow((r) => ({ ...r, [col]: next }))}
          onSelect={(e) => {
            setRow((r) => ({ ...r, [col]: e.name }));
            applyPicked(setRow, e.position, e.department);
          }}
          className="min-w-[180px]"
        />
      );
    }
    return (
      <Input
        placeholder={col}
        value={value}
        onChange={(e) => setRow((r) => ({ ...r, [col]: e.target.value }))}
      />
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{table.title}</h3>
        <div className="flex gap-2">
          <button onClick={() => setAdding((a) => !a)} className="text-xs text-accent hover:underline">
            {adding ? "Done adding" : "+ Add row"}
          </button>
          <button onClick={onDelete} className="text-xs text-warn hover:underline">
            Delete table
          </button>
        </div>
      </div>

      {adding && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {table.columns.map((col) => (
            <div key={col} className="max-w-[220px] flex-1">
              {cellInput(col, newRow, setNewRow)}
            </div>
          ))}
          <Button variant="ghost" onClick={addRow}>+ Add row</Button>
        </div>
      )}

      <TableTotal label="Total Records" count={table.rows.length} />
      {table.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[500px] text-left text-sm">
            <thead>
              <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                {table.columns.map((col) => (
                  <th key={col} className="px-3 py-2">{col}</th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, idx) =>
                editingIdx === idx ? (
                  <tr key={idx} className="border-t border-border">
                    {table.columns.map((col) => (
                      <td key={col} className="px-3 py-2">
                        {cellInput(col, draftRow, setDraftRow)}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <EditActions onSave={() => saveRow(idx)} onCancel={() => setEditingIdx(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={idx} className="border-t border-border">
                    {table.columns.map((col) => (
                      <td key={col} className="px-3 py-2 text-ink-muted">{row[col] || "—"}</td>
                    ))}
                    <td className="px-3 py-2">
                      <RowActions
                        onEdit={() => {
                          setEditingIdx(idx);
                          setDraftRow({ ...row });
                        }}
                        onDelete={() => deleteRow(idx)}
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
