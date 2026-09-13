"use client";

import { useState } from "react";
import Link from "next/link";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, Input, StatusSelect } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { inRange, milestoneDate, rangeFor, type RangePreset } from "@/lib/dateRanges";
import { useNotifications } from "@/lib/notificationContext";
import {
  sixthMonthNoteLabels,
  sixthMonthNoteOptions,
  sixthMonthNoteTone,
} from "@/lib/milestoneNotes";
import type { Employee, MilestoneNote } from "@/types";

export type SixthMonthRow = {
  id: string;
  name: string;
  position: string;
  department: string;
  email: string;
  supervisor: string;
  dateHired: string;
  sixthMonth: string;
};

/**
 * The 6th-Month milestone list, derived the same way as the 6th Month view under
 * Employees: active employees with a hire date, their milestone falling in range.
 */
export function sixthMonthRows(employees: Employee[], start: string, end: string): SixthMonthRow[] {
  return employees
    .filter((e) => e.dateHired && !e.lastDay && e.resignedStatus !== "resigned")
    .map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position || "",
      department: e.department || "",
      email: e.realcognitaEmail || "",
      supervisor: e.immediateSupervisor || "",
      dateHired: e.dateHired!,
      sixthMonth: milestoneDate(e.dateHired!, 6),
    }))
    .filter((r) => inRange(r.sixthMonth, start, end))
    .sort((a, b) => (a.sixthMonth < b.sixthMonth ? -1 : 1));
}

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

type RowDraft = {
  position: string;
  department: string;
  email: string;
  supervisor: string;
  dateHired: string;
  note: string;
};

/**
 * Reads employees and milestone notes from the same stores the Employees page uses,
 * so this table and the 6th Month view under Employees always show the same thing and
 * an edit in either place lands in the other.
 */
export function SixthMonthReport() {
  const { items: employees, hydrated, update: updateEmployee } = useSupabaseStore<Employee>("hr_employees", []);
  const {
    items: milestoneNotes,
    add: addNote,
    update: updateNote,
  } = useSupabaseStore<MilestoneNote>("hr_milestone_notes", []);
  const { notify } = useNotifications();

  const monthRange = rangeFor("month", new Date());
  const [preset, setPreset] = useState<RangePreset>("month");
  const [startDate, setStartDate] = useState(monthRange.start);
  const [endDate, setEndDate] = useState(monthRange.end);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowDraft>({
    position: "",
    department: "",
    email: "",
    supervisor: "",
    dateHired: "",
    note: "",
  });

  function applyPreset(next: RangePreset) {
    setPreset(next);
    if (next === "custom") return;
    const r = rangeFor(next, new Date());
    setStartDate(r.start);
    setEndDate(r.end);
  }

  function noteFor(employeeId: string): string {
    return milestoneNotes.find((m) => m.employeeId === employeeId && m.milestoneType === "sixth")?.note || "";
  }

  function saveNote(employeeId: string, value: string) {
    const existing = milestoneNotes.find(
      (m) => m.employeeId === employeeId && m.milestoneType === "sixth"
    );
    if (existing) {
      if (existing.note === value) return;
      updateNote(existing.id, { note: value });
    } else if (value.trim()) {
      addNote({ id: `${employeeId}-sixth`, employeeId, milestoneType: "sixth", note: value });
    }
  }

  function startEdit(r: SixthMonthRow) {
    setEditingId(r.id);
    setDraft({
      position: r.position,
      department: r.department,
      email: r.email,
      supervisor: r.supervisor,
      dateHired: r.dateHired.slice(0, 10),
      note: noteFor(r.id),
    });
  }

  function saveEdit(r: SixthMonthRow) {
    updateEmployee(r.id, {
      position: draft.position.trim() || undefined,
      department: draft.department.trim() || undefined,
      realcognitaEmail: draft.email.trim() || undefined,
      immediateSupervisor: draft.supervisor.trim() || undefined,
      dateHired: draft.dateHired ? new Date(draft.dateHired).toISOString() : undefined,
    });
    saveNote(r.id, draft.note);
    setEditingId(null);
    notify(`${r.name} — 6th-month details updated`, "updated");
  }

  if (!hydrated) return null;

  const rows = sixthMonthRows(employees, startDate, endDate);

  return (
    <Card>
      <h2 className="font-display text-lg text-ink">Employee 6th-Month Report</h2>
      <p className="mt-1 text-xs text-ink-muted">
        The same employees shown under the 6th Month view in Employees — edits here update the employee
        record, so both places stay in step.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant={preset === p.id ? "primary" : "ghost"}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
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
        </label>
      </div>

      <p className="mt-3 text-sm font-medium text-ink">Total Employees: {rows.length}</p>

      {rows.length === 0 ? (
        <div className="mt-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
          No employees reach their 6th month in this date range.
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Employee Name</th>
                <th className="px-3 py-2">Position</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Immediate Supervisor</th>
                <th className="px-3 py-2">Date Hired</th>
                <th className="px-3 py-2">6th Month</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{r.name}</td>
                    <td className="px-3 py-2">
                      <Input value={draft.position} onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={draft.supervisor} onChange={(e) => setDraft((d) => ({ ...d, supervisor: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={draft.dateHired}
                        onChange={(e) => setDraft((d) => ({ ...d, dateHired: e.target.value }))}
                        className="min-w-[150px]"
                      />
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {draft.dateHired
                        ? formatDate(milestoneDate(new Date(draft.dateHired).toISOString(), 6), "MMMM d, yyyy")
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusSelect
                        value={draft.note}
                        onChange={(v) => setDraft((d) => ({ ...d, note: v }))}
                        options={sixthMonthNoteOptions(draft.note)}
                        labels={sixthMonthNoteLabels(draft.note)}
                        tone={sixthMonthNoteTone}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-3">
                        <button onClick={() => saveEdit(r)} className="text-xs text-accent hover:underline">
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs text-ink-muted hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">
                      <Link href={`/employees/${r.id}`} className="hover:text-accent">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.position || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.department || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.email || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.supervisor || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.dateHired, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2 text-ink-muted">{formatDate(r.sixthMonth, "MMMM d, yyyy")}</td>
                    <td className="px-3 py-2">
                      <StatusSelect
                        value={noteFor(r.id)}
                        onChange={(v) => saveNote(r.id, v)}
                        options={sixthMonthNoteOptions(noteFor(r.id))}
                        labels={sixthMonthNoteLabels(noteFor(r.id))}
                        tone={sixthMonthNoteTone}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => startEdit(r)} className="text-xs text-accent hover:underline">
                        Edit
                      </button>
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
