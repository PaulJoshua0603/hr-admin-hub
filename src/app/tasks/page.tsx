"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { formatDate, isOverdue, todayISO } from "@/lib/dates";
import { Button, Card, Input, Pill, SectionHeading, Textarea } from "@/components/ui";
import type { CalendarEvent, RecurrenceLabel, ReminderNote, Task } from "@/types";
import { REMINDER_NOTE_ID } from "@/types";
import { useNotifications } from "@/lib/notificationContext";

const HR_TASK_REFERENCE_TEMPLATE = `BDO Form
- BDO reference sheet
- Endorsement Letter
- A1 - Customer Information
- A3 - Signature Card
- Back of A3
- A4 - ATM Debit Card Form
- Instruction Sheet page 1 & 2

ER2 Sequence
- Authorization Letter
- Ms. Paula ID
- Sir Dennis ID
- ER2 Form 2 Copy
- Philhealth Form
- Birth Certificate

Certificate of Employment (COE)
- Print 2 copies colored
- For signature to Ms. Paula & Ms. Lucia
- Message applicant in MS Teams
- Fill up the applicant Logbook for receiving

Sick Leave
- Email Clinic
- File Leave Form
- Attachment of Assessment of clinic nurse
- Approved of your leave in Sprout

Last Day
- Put in Excel the day after the Last Day date
- HMO Card
- Company Equipments

6th Month of Employee
- Email Applicant CC: Ms. Paula`;

export default function TasksAndRemindersPage() {
  return (
    <div>
      <SectionHeading
        title="Tasks & Notes"
        subtitle="Dated tasks and standing notes, together in one place."
      />
      <TasksSection />
      <div className="mt-10">
        <RemindersSection />
      </div>
    </div>
  );
}

/* ----------------------------- Tasks ----------------------------- */

function TasksSection() {
  const { items: tasks, hydrated, add, update, remove } = useSupabaseStore<Task>(
    "hr_tasks",
    []
  );
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const { notify } = useNotifications();

  const active = tasks.filter((t) => !t.accomplished);
  const withDeadline = active
    .filter((t) => t.deadline)
    .sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1));
  const noDeadline = active.filter((t) => !t.deadline);
  const done = tasks.filter((t) => t.accomplished);

  function openNew() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setShowForm(true);
  }

  function handleSave(task: Task) {
    if (editing) {
      update(task.id, task);
      notify(`Task updated: "${task.title}"`, "updated");
    } else {
      add(task);
      notify(`Task added: "${task.title}"`, "created");
    }
    setShowForm(false);
    setEditing(null);
  }

  if (!hydrated) return null;

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="font-display text-xl text-ink">Tasks</h2>
        <Button onClick={openNew}>+ New task</Button>
      </div>

      {showForm && (
        <TaskForm
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSave={handleSave}
        />
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink-muted">
            With a deadline ({withDeadline.length})
          </h3>
          <div className="flex flex-col gap-3">
            {withDeadline.length === 0 && (
              <EmptyState text="No dated tasks yet." />
            )}
            {withDeadline.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onEdit={() => openEdit(task)}
                onDelete={() => {
                  remove(task.id);
                  notify(`Task deleted: "${task.title}"`, "deleted");
                }}
                onAccomplish={() => {
                  update(task.id, {
                    accomplished: true,
                    accomplishedAt: todayISO(),
                  });
                  notify(`Task accomplished: "${task.title}"`, "updated");
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-medium text-ink-muted">
            No deadline ({noDeadline.length})
          </h3>
          <div className="flex flex-col gap-3">
            {noDeadline.length === 0 && (
              <EmptyState text="Nothing here yet." />
            )}
            {noDeadline.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onEdit={() => openEdit(task)}
                onDelete={() => {
                  remove(task.id);
                  notify(`Task deleted: "${task.title}"`, "deleted");
                }}
                onAccomplish={() => {
                  update(task.id, {
                    accomplished: true,
                    accomplishedAt: todayISO(),
                  });
                  notify(`Task accomplished: "${task.title}"`, "updated");
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 border-t border-border pt-4">
        <button
          onClick={() => setShowDone((s) => !s)}
          className="text-sm text-ink-muted underline decoration-border underline-offset-4 hover:text-ink"
        >
          {showDone ? "Hide" : "Show"} accomplished ({done.length})
        </button>
        {showDone && (
          <div className="mt-4 flex flex-col gap-2">
            {done.map((task) => (
              <Card key={task.id} className="flex items-center justify-between opacity-70">
                <div>
                  <p className="text-sm text-ink line-through">{task.title}</p>
                  {task.accomplishedAt && (
                    <p className="text-xs text-ink-muted">
                      Done {formatDate(task.accomplishedAt)}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => update(task.id, { accomplished: false })}
                  >
                    Reopen
                  </Button>
                  <Button variant="danger" onClick={() => remove(task.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onEdit,
  onDelete,
  onAccomplish,
}: {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
  onAccomplish: () => void;
}) {
  const overdue = task.deadline ? isOverdue(task.deadline) : false;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{task.title}</p>
          {task.notes && (
            <p className="mt-1 text-sm text-ink-muted">{task.notes}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {task.deadline && (
              <Pill tone={overdue ? "warn" : "accent"}>
                {overdue ? "Overdue" : "Due"} {formatDate(task.deadline)}
              </Pill>
            )}
            {task.dateNeeded && (
              <Pill tone="neutral">Needed {formatDate(task.dateNeeded)}</Pill>
            )}
            {task.recurrence && task.recurrence !== "none" && (
              <Pill>
                {task.recurrence === "custom" && task.recurrenceAt
                  ? formatDate(task.recurrenceAt, "MMM d, yyyy h:mm a")
                  : task.recurrence}
              </Pill>
            )}
            <span className="text-xs text-ink-muted">
              Input: {formatDate(task.inputDate || task.createdAt)}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={onAccomplish}>Mark accomplished</Button>
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

function TaskForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Task | null;
  onSave: (task: Task) => void;
  onCancel: () => void;
}) {
  const [inputDate, setInputDate] = useState(
    initial?.inputDate
      ? initial.inputDate.slice(0, 10)
      : initial?.createdAt
      ? initial.createdAt.slice(0, 10)
      : todayISO().slice(0, 10)
  );
  const [title, setTitle] = useState(initial?.title || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [deadline, setDeadline] = useState(
    initial?.deadline ? initial.deadline.slice(0, 10) : ""
  );
  const [dateNeeded, setDateNeeded] = useState(
    initial?.dateNeeded ? initial.dateNeeded.slice(0, 10) : ""
  );
  const [recurrence, setRecurrence] = useState<RecurrenceLabel>(initial?.recurrence || "none");
  const [recurrenceDate, setRecurrenceDate] = useState(
    initial?.recurrenceAt ? initial.recurrenceAt.slice(0, 10) : ""
  );
  const [recurrenceTime, setRecurrenceTime] = useState(
    initial?.recurrenceAt ? initial.recurrenceAt.slice(11, 16) : ""
  );

  const canSave = title.trim().length > 0 && inputDate.length > 0;

  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Input Date
          <Input
            type="date"
            value={inputDate}
            onChange={(e) => setInputDate(e.target.value)}
          />
        </label>
        <Input
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <Textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Deadline (leave blank if none)
            <Input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Date Needed (leave blank if none)
            <Input
              type="date"
              value={dateNeeded}
              onChange={(e) => setDateNeeded(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Repeats
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as RecurrenceLabel)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
              <option value="custom">Specific date & time</option>
            </select>
          </label>
          {recurrence === "custom" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Date
                <Input
                  type="date"
                  value={recurrenceDate}
                  onChange={(e) => setRecurrenceDate(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Time
                <Input
                  type="time"
                  value={recurrenceTime}
                  onChange={(e) => setRecurrenceTime(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            disabled={!canSave}
            className={!canSave ? "opacity-50" : ""}
            onClick={() =>
              onSave({
                id: initial?.id || uuid(),
                title: title.trim(),
                notes: notes.trim() || undefined,
                createdAt: initial?.createdAt || todayISO(),
                inputDate: new Date(inputDate).toISOString(),
                deadline: deadline ? new Date(deadline).toISOString() : undefined,
                dateNeeded: dateNeeded ? new Date(dateNeeded).toISOString() : undefined,
                recurrence,
                recurrenceAt:
                  recurrence === "custom" && recurrenceDate
                    ? new Date(`${recurrenceDate}T${recurrenceTime || "00:00"}`).toISOString()
                    : undefined,
                accomplished: initial?.accomplished || false,
                accomplishedAt: initial?.accomplishedAt,
              })
            }
          >
            Save task
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
      {text}
    </div>
  );
}

/* ----------------------------- Notes ------------------------------ */

function RemindersSection() {
  const { items, hydrated, add, update, remove } = useSupabaseStore<ReminderNote>(
    "hr_reminders",
    []
  );
  const { add: addCalendarEvent } = useSupabaseStore<CalendarEvent>(
    "hr_calendar_events",
    []
  );
  const { notify } = useNotifications();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState(todayISO().slice(0, 10));
  const [eventTime, setEventTime] = useState("");
  const [eventSourceNoteId, setEventSourceNoteId] = useState<string | null>(null);

  const notes = [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  function draftFor(note: ReminderNote): string {
    return drafts[note.id] !== undefined ? drafts[note.id] : note.content;
  }

  function isDirty(note: ReminderNote): boolean {
    return drafts[note.id] !== undefined && drafts[note.id] !== note.content;
  }

  function addNote(initialContent = "") {
    const id = uuid();
    add({ id, content: initialContent, updatedAt: todayISO() });
    if (initialContent) notify("Note added", "created");
  }

  function saveNote(note: ReminderNote) {
    const content = draftFor(note);
    update(note.id, { content, updatedAt: todayISO() });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[note.id];
      return next;
    });
    notify("Note saved", "updated");
  }

  function deleteNote(note: ReminderNote) {
    remove(note.id);
    notify("Note deleted", "deleted");
  }

  function openEventForm(note: ReminderNote) {
    const content = draftFor(note);
    const firstLine = content.split("\n").find((l) => l.trim().length > 0) || "";
    setEventTitle(firstLine.trim().slice(0, 120));
    setEventDate(todayISO().slice(0, 10));
    setEventTime("");
    setEventSourceNoteId(note.id);
    setShowEventForm(true);
  }

  function saveEvent() {
    if (!eventTitle.trim() || !eventDate) return;
    addCalendarEvent({
      id: uuid(),
      title: eventTitle.trim(),
      date: eventDate,
      time: eventTime || undefined,
      sourceNote: eventTitle.trim(),
      createdAt: new Date().toISOString(),
    });
    notify(`Calendar event added: "${eventTitle.trim()}"`, "created");
    setShowEventForm(false);
    setEventSourceNoteId(null);
  }

  if (!hydrated) return null;

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl text-ink">Notes</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Add as many standing notes as you need — each one saves independently.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => addNote(HR_TASK_REFERENCE_TEMPLATE)}>
            + HR task reference note
          </Button>
          <Button onClick={() => addNote()}>+ Add note</Button>
        </div>
      </div>

      {showEventForm && (
        <Card className="mb-4">
          <p className="mb-2 text-xs text-ink-muted">Create a calendar event from this note.</p>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Event title"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              autoFocus
            />
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Date
                <Input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Time (optional)
                <Input
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!eventTitle.trim() || !eventDate}
                className={!eventTitle.trim() || !eventDate ? "opacity-50" : ""}
                onClick={saveEvent}
              >
                Save to Calendar
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowEventForm(false);
                  setEventSourceNoteId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {notes.length === 0 ? (
        <EmptyState text='No notes yet. Click "+ Add note" to write your first one.' />
      ) : (
        <div className="flex flex-col gap-4">
          {notes.map((note) => {
            const dirty = isDirty(note);
            return (
              <Card key={note.id}>
                <Textarea
                  value={draftFor(note)}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [note.id]: e.target.value }))
                  }
                  placeholder="Check Outlook email…&#10;Follow up with payroll…&#10;Renew business permit…"
                  rows={6}
                  className="resize-y"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-ink-muted">
                    {dirty ? "Unsaved changes" : `Saved ${formatDate(note.updatedAt, "MMM d, h:mm a")}`}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => openEventForm(note)}>
                      Add to Calendar
                    </Button>
                    <Button variant="danger" onClick={() => deleteNote(note)}>
                      Delete
                    </Button>
                    <Button
                      onClick={() => saveNote(note)}
                      disabled={!dirty}
                      className={!dirty ? "opacity-50" : ""}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
