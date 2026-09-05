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
  getMissingCriticalItems,
  defaultOnboardingChecklist,
  type Employee,
} from "@/types";
import { useNotifications } from "@/lib/notificationContext";

export default function EmployeesPage() {
  const { items: employees, hydrated, add, update } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );
  const { notify } = useNotifications();
  const [showForm, setShowForm] = useState(false);
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

  if (!hydrated) return null;

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
        action={<Button onClick={() => setShowForm((s) => !s)}>+ Add employee</Button>}
      />

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
        {employees.map((e) => {
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
