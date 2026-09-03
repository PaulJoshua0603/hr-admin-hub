"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Employee, Task } from "@/types";
import { isOverdue, isDueToday, formatDate } from "@/lib/dates";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import { useNotifications } from "@/lib/notificationContext";
import { computeEmployeeAlerts } from "@/lib/employeeAlerts";

type Alert = {
  id: string;
  label: string;
  detail: string;
  tone: "warn" | "accent";
  href: string;
};

async function readValue<T>(key: string): Promise<T[]> {
  if (!supabaseReady) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  }
  const { data } = await supabase
    .from("app_store")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as T[]) || [];
}

async function readAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];

  const tasks = await readValue<Task>("hr_tasks");
  for (const t of tasks) {
    if (t.accomplished || !t.deadline) continue;
    if (isOverdue(t.deadline)) {
      alerts.push({
        id: `task-${t.id}`,
        label: t.title,
        detail: `Overdue since ${formatDate(t.deadline)}`,
        tone: "warn",
        href: "/tasks",
      });
    } else if (isDueToday(t.deadline)) {
      alerts.push({
        id: `task-${t.id}`,
        label: t.title,
        detail: "Due today",
        tone: "accent",
        href: "/tasks",
      });
    }
  }

  const employees = await readValue<Employee>("hr_employees");
  alerts.push(...computeEmployeeAlerts(employees));

  return alerts;
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

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const router = useRouter();
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();

  useEffect(() => {
    readAlerts().then(setAlerts);
    const onFocus = () => readAlerts().then(setAlerts);
    window.addEventListener("focus", onFocus);
    const interval = setInterval(() => readAlerts().then(setAlerts), 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, []);

  const badgeCount = alerts.length + unreadCount;

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markAllRead();
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-ink-muted hover:text-ink"
        aria-label="Notifications"
      >
        <BellIcon />
        {badgeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-warn text-[10px] font-medium text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 max-h-[26rem] w-80 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-lg">
            {alerts.length > 0 && (
              <>
                <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Employees & Deadlines
                </p>
                <ul className="mb-2 flex flex-col gap-1">
                  {alerts.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => {
                          setOpen(false);
                          router.push(a.href);
                        }}
                        className="flex w-full flex-col rounded-md px-2 py-2 text-left hover:bg-background"
                      >
                        <span className="text-sm text-ink">{a.label}</span>
                        <span
                          className={`text-xs ${a.tone === "warn" ? "text-warn" : "text-accent"}`}
                        >
                          {a.detail}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="flex items-center justify-between px-2 py-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Activity
              </p>
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-ink-muted hover:text-warn"
                >
                  Clear
                </button>
              )}
            </div>

            {alerts.length === 0 && notifications.length === 0 ? (
              <p className="px-2 py-4 text-sm text-ink-muted">
                Nothing yet. You&apos;re caught up.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {notifications.slice(0, 30).map((n) => (
                  <li key={n.id} className="flex flex-col rounded-md px-2 py-1.5">
                    <span className="text-sm text-ink">{n.message}</span>
                    <span className="text-xs text-ink-muted">{timeAgo(n.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
