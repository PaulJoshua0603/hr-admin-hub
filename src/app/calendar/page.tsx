"use client";

import { useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, Input, Pill, SectionHeading } from "@/components/ui";
import type { CalendarEvent, Employee, Task } from "@/types";
import { EMPLOYMENT_MILESTONE_LABELS, EMPLOYMENT_MILESTONE_MONTHS, type EmploymentMilestoneKey } from "@/types";
import { addMonthsISO } from "@/lib/dates";

type DayEvent = { label: string; tone: "accent" | "warn" | "success"; time?: string };

export default function CalendarPage() {
  const { items: tasks, hydrated: tasksReady } = useSupabaseStore<Task>("hr_tasks", []);
  const { items: employees, hydrated: empReady } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );
  const {
    items: events,
    hydrated: eventsReady,
    add: addEvent,
    remove: removeEvent,
  } = useSupabaseStore<CalendarEvent>("hr_calendar_events", []);

  const [month, setMonth] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DayEvent[]>();

    // Tasks — synced automatically from deadlines
    for (const t of tasks) {
      if (!t.deadline || t.accomplished) continue;
      const key = format(parseISO(t.deadline), "yyyy-MM-dd");
      map.set(key, [...(map.get(key) || []), { label: t.title, tone: "accent" }]);
    }

    // Employee requirement deadlines
    for (const e of employees) {
      const key = format(parseISO(e.requirementsDeadline), "yyyy-MM-dd");
      const done = Object.values(e.requirements).every((s) => s === "complete");
      if (done) continue;
      map.set(key, [
        ...(map.get(key) || []),
        { label: `${e.name} requirements`, tone: "warn" },
      ]);
    }

    // Employee onboarding — synced automatically from Date Hired / Onboarding Date
    for (const e of employees) {
      if (!e.dateHired) continue;
      const key = format(parseISO(e.dateHired), "yyyy-MM-dd");
      map.set(key, [
        ...(map.get(key) || []),
        { label: `Hired/Onboarded: ${e.name}`, tone: "success" },
      ]);
    }

    // Employment milestones — 3rd month, 6th month, 1-year anniversary,
    // computed from each employee's Hired/Onboarding Date.
    for (const e of employees) {
      if (!e.dateHired || e.lastDay) continue;
      (Object.keys(EMPLOYMENT_MILESTONE_MONTHS) as EmploymentMilestoneKey[]).forEach((mKey) => {
        const milestoneDate = addMonthsISO(e.dateHired!, EMPLOYMENT_MILESTONE_MONTHS[mKey]);
        const key = format(parseISO(milestoneDate), "yyyy-MM-dd");
        map.set(key, [
          ...(map.get(key) || []),
          { label: `${e.name} — ${EMPLOYMENT_MILESTONE_LABELS[mKey]}`, tone: "accent" },
        ]);
      });
    }

    // Employee birthdays — recur every year on the same month/day, plotted
    // across every month shown regardless of the birth year on file.
    for (const e of employees) {
      if (!e.birthday) continue;
      const bday = parseISO(e.birthday);
      const key = format(
        new Date(month.getFullYear(), bday.getMonth(), bday.getDate()),
        "yyyy-MM-dd"
      );
      map.set(key, [
        ...(map.get(key) || []),
        { label: `🎂 ${e.name}'s Birthday`, tone: "warn" },
      ]);
    }

    // Manually created / note-based calendar events
    for (const ev of events) {
      map.set(ev.date, [
        ...(map.get(ev.date) || []),
        { label: ev.title, tone: "accent", time: ev.time },
      ]);
    }

    return map;
  }, [tasks, employees, events, month]);

  if (!tasksReady || !empReady || !eventsReady) return null;

  const start = startOfWeek(startOfMonth(month));
  const end = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start, end });

  function openNewEvent(dayKey?: string) {
    setSelectedDay(dayKey || format(new Date(), "yyyy-MM-dd"));
    setShowForm(true);
  }

  return (
    <div>
      <SectionHeading
        title="Calendar"
        subtitle="Task deadlines, employee onboarding, and events created from notes — all in one view."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setMonth((m) => addMonths(m, -1))}>
              ←
            </Button>
            <span className="text-sm font-medium text-ink w-32 text-center">
              {format(month, "MMMM yyyy")}
            </span>
            <Button variant="ghost" onClick={() => setMonth((m) => addMonths(m, 1))}>
              →
            </Button>
            <Button onClick={() => openNewEvent()}>+ New event</Button>
          </div>
        }
      />

      {showForm && (
        <NewEventForm
          initialDate={selectedDay || format(new Date(), "yyyy-MM-dd")}
          onCancel={() => setShowForm(false)}
          onSave={(ev) => {
            addEvent(ev);
            setShowForm(false);
          }}
        />
      )}

      <Card>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-muted mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDay.get(key) || [];
            const inMonth = isSameMonth(day, month);
            const today = isSameDay(day, new Date());
            return (
              <button
                key={key}
                onClick={() => openNewEvent(key)}
                className={`min-h-[86px] rounded-md border p-1.5 text-left align-top transition-colors hover:border-accent ${
                  inMonth ? "border-border bg-surface" : "border-transparent bg-background/40"
                } ${today ? "ring-1 ring-accent" : ""}`}
              >
                <p className={`text-xs ${inMonth ? "text-ink-muted" : "text-ink-muted/50"}`}>
                  {format(day, "d")}
                </p>
                <div className="mt-1 flex flex-col gap-1">
                  {dayEvents.slice(0, 2).map((ev, i) => (
                    <span key={i} className="block">
                      <Pill tone={ev.tone}>
                        {ev.time ? `${ev.time} · ` : ""}
                        {ev.label}
                      </Pill>
                    </span>
                  ))}
                  {dayEvents.length > 2 && (
                    <span className="text-[10px] text-ink-muted">
                      +{dayEvents.length - 2} more
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {events.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-medium text-ink-muted">
            Upcoming events created from notes/quick-add
          </h3>
          <div className="flex flex-col gap-2">
            {[...events]
              .sort((a, b) => (a.date < b.date ? -1 : 1))
              .map((ev) => (
                <Card key={ev.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">{ev.title}</p>
                    <p className="text-xs text-ink-muted">
                      {format(parseISO(ev.date), "MMM d, yyyy")}
                      {ev.time ? ` at ${ev.time}` : ""}
                      {ev.sourceNote ? " · from note" : ""}
                    </p>
                  </div>
                  <Button variant="danger" onClick={() => removeEvent(ev.id)}>
                    Delete
                  </Button>
                </Card>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewEventForm({
  initialDate,
  onSave,
  onCancel,
}: {
  initialDate: string;
  onSave: (ev: CalendarEvent) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState("");

  const canSave = title.trim().length > 0 && date.length > 0;

  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-3">
        <Input
          placeholder="Event title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Date
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Time (optional)
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={!canSave}
            className={!canSave ? "opacity-50" : ""}
            onClick={() =>
              onSave({
                id: uuid(),
                title: title.trim(),
                date,
                time: time || undefined,
                createdAt: new Date().toISOString(),
              })
            }
          >
            Save event
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
