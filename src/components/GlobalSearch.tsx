"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Employee, ReminderNote, Task } from "@/types";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import { SearchIcon } from "@/components/icons";

type Result = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  kind: "Employee" | "Task" | "Note";
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

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<ReminderNote[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    readValue<Employee>("hr_employees").then(setEmployees);
    readValue<Task>("hr_tasks").then(setTasks);
    readValue<ReminderNote>("hr_reminders").then(setNotes);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();

  const results: Result[] = [];
  if (q.length > 0) {
    for (const e of employees) {
      const haystack = `${e.name} ${e.position || ""} ${e.department || ""}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `emp-${e.id}`,
          title: e.name,
          subtitle: [e.position, e.department].filter(Boolean).join(" · ") || "Employee",
          href: `/employees/${e.id}`,
          kind: "Employee",
        });
      }
    }
    for (const t of tasks) {
      const haystack = `${t.title} ${t.notes || ""}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `task-${t.id}`,
          title: t.title,
          subtitle: t.accomplished ? "Accomplished task" : "Task",
          href: "/tasks",
          kind: "Task",
        });
      }
    }
    for (const n of notes) {
      const plain = (n.content || "").replace(/<[^>]+>/g, " ");
      if (plain.toLowerCase().includes(q)) {
        const idx = plain.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 20);
        const snippet = plain.slice(start, start + 60).trim();
        results.push({
          id: `note-${n.id}`,
          title: "Notes",
          subtitle: snippet ? `…${snippet}…` : "Note match",
          href: "/tasks",
          kind: "Note",
        });
      }
    }
  }

  const limited = results.slice(0, 8);

  function goTo(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <div ref={containerRef} className="relative hidden min-w-0 max-w-sm flex-1 md:block">
      <SearchIcon
        size={16}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && limited[0]) goTo(limited[0].href);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search employees, tasks, notes…"
        className="w-full rounded-full border border-border bg-background py-2 pl-10 pr-4 text-sm text-ink outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/15"
      />

      {open && q.length > 0 && (
        <div className="animate-scale-in absolute left-0 top-full z-30 mt-2 w-full origin-top overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          {limited.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-muted">No matches for &ldquo;{query}&rdquo;.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1.5">
              {limited.map((r, i) => (
                <li key={r.id} className="animate-fade-up" style={{ animationDelay: `${i * 25}ms` }}>
                  <button
                    onClick={() => goTo(r.href)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-background"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{r.title}</span>
                      <span className="block truncate text-xs text-ink-muted">{r.subtitle}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                      {r.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
