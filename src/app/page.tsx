"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { formatDate, isOverdue } from "@/lib/dates";
import { Card, Pill } from "@/components/ui";
import { useNotifications } from "@/lib/notificationContext";
import { useAuth } from "@/lib/authContext";
import { TasksIcon, EmployeesIcon, ReportsIcon, ChevronIcon } from "@/components/icons";
import { getMissingCriticalItems, getLackingRequirements, type Employee, type ReminderNote, type Task } from "@/types";
import { computeEmployeeAlerts } from "@/lib/employeeAlerts";

function getFirstName(fullName?: string | null, email?: string | null): string {
  const name = fullName?.trim();
  if (name) return name.split(" ")[0];
  if (email) return email.split("@")[0];
  return "there";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { items: tasks, hydrated: t1 } = useSupabaseStore<Task>("hr_tasks", []);
  const { items: reminders, hydrated: t2 } = useSupabaseStore<ReminderNote>(
    "hr_reminders",
    []
  );
  const { items: employees, hydrated: t3 } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );

  if (!t1 || !t2 || !t3) return null;

  const activeTasks = tasks.filter((t) => !t.accomplished);
  const overdueTasks = activeTasks.filter((t) => t.deadline && isOverdue(t.deadline));
  const upcomingTasks = activeTasks
    .filter((t) => t.deadline)
    .sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1))
    .slice(0, 5);
  const reminderLines = (reminders[0]?.content || "")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const employeesNeedingAttention = employees.filter(
    (e) => !Object.values(e.requirements).every((s) => s === "complete")
  );
  const employeesComplete = employees.length - employeesNeedingAttention.length;
  const employeesMissingCritical = employees
    .map((e) => ({ employee: e, missing: getMissingCriticalItems(e) }))
    .filter((x) => x.missing.length > 0);
  const completionPct =
    employees.length > 0 ? Math.round((employeesComplete / employees.length) * 100) : 0;

  const employeeAlerts = computeEmployeeAlerts(employees);
  const milestoneAlerts = employeeAlerts.filter(
    (a) => a.id.includes("-milestone-") || a.id.includes("-coe-") || a.id.includes("-profile-")
  );

  const firstName = getFirstName(
    user?.user_metadata?.full_name as string | undefined,
    user?.email
  );

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-2xl text-ink sm:text-3xl">
            Hi, {firstName}.
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Plan, prioritize, and stay on top of onboarding with ease.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tasks"
            className="press-scale flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-md shadow-accent/25 hover:opacity-95"
          >
            + New Task
          </Link>
          <Link
            href="/employees"
            className="press-scale rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-background"
          >
            View Employees
          </Link>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total employees"
          value={employees.length}
          href="/employees"
          icon={EmployeesIcon}
          delay={0}
          highlight
        />
        <StatCard
          label="Active tasks"
          value={activeTasks.length}
          href="/tasks"
          icon={TasksIcon}
          delay={80}
        />
        <StatCard
          label="Overdue"
          value={overdueTasks.length}
          href="/tasks"
          tone={overdueTasks.length > 0 ? "warn" : undefined}
          icon={TasksIcon}
          delay={160}
        />
        <StatCard
          label="Notes"
          value={reminderLines.length}
          href="/tasks"
          icon={ReportsIcon}
          delay={240}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card hover className="stagger-item lg:col-span-2" style={{ animationDelay: "320ms" }}>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-lg text-ink">Upcoming deadlines</h2>
            <Link href="/tasks" className="flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80">
              View all <ChevronIcon size={12} />
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            {upcomingTasks.length === 0 && (
              <p className="text-sm text-ink-muted">Nothing dated coming up.</p>
            )}
            {upcomingTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-background"
              >
                <span className="text-ink">{t.title}</span>
                <Pill tone={isOverdue(t.deadline!) ? "warn" : "accent"}>
                  {formatDate(t.deadline!)}
                </Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card hover className="stagger-item flex flex-col items-center justify-center text-center" style={{ animationDelay: "400ms" }}>
          <h2 className="font-display text-lg text-ink">Requirements</h2>
          <p className="mb-3 text-xs text-ink-muted">Employees fully cleared</p>
          <DonutProgress percent={completionPct} />
          <p className="mt-3 text-xs text-ink-muted">
            {employeesComplete} of {employees.length || 0} complete
          </p>
        </Card>
      </div>

      {employeesMissingCritical.length > 0 && (
        <Card hover className="stagger-item mb-6 border-warn/30 bg-warn-soft" style={{ animationDelay: "440ms" }}>
          <h2 className="font-display text-lg text-warn">
            Missing Government IDs, NBI, or Medical Exam
          </h2>
          <div className="mt-3 flex flex-col gap-1">
            {employeesMissingCritical.slice(0, 8).map(({ employee: e, missing }) => (
              <Link
                key={e.id}
                href={`/employees/${e.id}`}
                className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface"
              >
                <span className="text-ink">{e.name}</span>
                <span className="text-xs text-warn">{missing.join(", ")}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {milestoneAlerts.length > 0 && (
        <Card hover className="stagger-item mb-6" style={{ animationDelay: "460ms" }}>
          <h2 className="font-display text-lg text-ink">Milestones & Offboarding</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Milestones, COE prep, and incomplete profiles (missing ID/Biometrics No.).
          </p>
          <div className="mt-3 flex flex-col gap-1">
            {milestoneAlerts.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-background"
              >
                <span className="text-ink">{a.label}</span>
                <Pill tone={a.tone}>{a.detail}</Pill>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card hover className="stagger-item" style={{ animationDelay: "480ms" }}>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-lg text-ink">Employees needing attention</h2>
            <Link href="/employees" className="flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80">
              View all <ChevronIcon size={12} />
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            {employeesNeedingAttention.length === 0 && (
              <p className="text-sm text-ink-muted">Everyone&apos;s requirements are complete.</p>
            )}
            {employeesNeedingAttention.slice(0, 5).map((e) => (
              <Link
                key={e.id}
                href={`/employees/${e.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-background hover:text-accent"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-ink">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                    {e.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{e.name}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      Lacking: {getLackingRequirements(e).join(", ")}
                    </span>
                  </span>
                </span>
                <Pill tone={isOverdue(e.requirementsDeadline) ? "warn" : "accent"}>
                  Due {formatDate(e.requirementsDeadline)}
                </Pill>
              </Link>
            ))}
          </div>
        </Card>

        <NotificationsFeed />
      </div>
    </div>
  );
}

function DonutProgress({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="relative flex h-28 w-28 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(var(--accent) ${clamped * 3.6}deg, var(--accent-soft) 0deg)`,
      }}
    >
      <div className="flex h-[4.4rem] w-[4.4rem] items-center justify-center rounded-full bg-surface">
        <span className="font-display text-xl text-ink">{clamped}%</span>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return formatDate(iso);
}

function NotificationsFeed() {
  const { notifications, clearAll } = useNotifications();

  return (
    <Card hover className="stagger-item" style={{ animationDelay: "560ms" }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg text-ink">Recent notifications</h2>
        {notifications.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-ink-muted transition-colors hover:text-warn"
          >
            Clear all
          </button>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing yet — actions like saving a task, adding an employee, or
          uploading a file will show up here as they happen.
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto">
          {notifications.slice(0, 15).map((n) => (
            <li key={n.id} className="flex items-start gap-3 py-2.5">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  n.type === "deleted"
                    ? "bg-warn"
                    : n.type === "created"
                    ? "bg-success"
                    : "bg-accent"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{n.message}</p>
                <p className="text-xs text-ink-muted">{timeAgo(n.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StatCard({
  label,
  value,
  href,
  tone,
  icon: Icon,
  delay = 0,
  highlight = false,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "warn";
  icon: (props: { size?: number; className?: string }) => React.ReactElement;
  delay?: number;
  highlight?: boolean;
}) {
  return (
    <Link href={href}>
      <Card
        hover
        className={`stagger-item ${highlight ? "!border-transparent bg-gradient-to-br from-accent to-[#0A2E2A] text-white" : ""}`}
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="flex items-start justify-between">
          <p className={`text-xs ${highlight ? "text-white/70" : "text-ink-muted"}`}>{label}</p>
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              highlight
                ? "bg-white/15 text-white"
                : tone === "warn"
                ? "bg-warn-soft text-warn"
                : "bg-accent-soft text-accent"
            }`}
          >
            <Icon size={14} />
          </span>
        </div>
        <p
          className={`mt-1 font-display text-3xl ${
            highlight ? "text-white" : tone === "warn" ? "text-warn" : "text-ink"
          }`}
        >
          {value}
        </p>
      </Card>
    </Link>
  );
}
