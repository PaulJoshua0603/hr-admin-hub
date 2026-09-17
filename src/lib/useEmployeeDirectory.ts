"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import type { Employee } from "@/types";

export type DirectoryEntry = {
  id: string;
  name: string;
  position: string;
  department: string;
  email: string;
  /** Needed so a report can derive an employment milestone without a second fetch. */
  dateHired: string;
};

const STORE_KEY = "hr_employees";

/**
 * Read-only, process-wide cached view of the employee list. Several name inputs can
 * be mounted at once (one per report form, one per row being edited), so the fetch is
 * shared instead of each input pulling the whole employee table again.
 */
let cache: DirectoryEntry[] | null = null;
let inflight: Promise<DirectoryEntry[]> | null = null;
const listeners = new Set<(entries: DirectoryEntry[]) => void>();

function toEntries(employees: Employee[]): DirectoryEntry[] {
  return employees
    .filter((e) => e && e.name)
    .map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position || "",
      department: e.department || "",
      email: e.realcognitaEmail || "",
      dateHired: e.dateHired || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchDirectory(): Promise<DirectoryEntry[]> {
  if (!supabaseReady) {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      return raw ? toEntries(JSON.parse(raw) as Employee[]) : [];
    } catch {
      return [];
    }
  }
  const { data, error } = await supabase
    .from("app_store")
    .select("value")
    .eq("key", STORE_KEY)
    .maybeSingle();
  if (error || !data?.value) return [];
  return toEntries(data.value as Employee[]);
}

function load(force = false): Promise<DirectoryEntry[]> {
  if (!force && cache) return Promise.resolve(cache);
  if (!force && inflight) return inflight;
  inflight = fetchDirectory()
    .then((entries) => {
      cache = entries;
      listeners.forEach((l) => l(entries));
      return entries;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function refreshEmployeeDirectory() {
  return load(true);
}

export function useEmployeeDirectory() {
  const [entries, setEntries] = useState<DirectoryEntry[]>(cache || []);

  useEffect(() => {
    let alive = true;
    const listener = (next: DirectoryEntry[]) => {
      if (alive) setEntries(next);
    };
    listeners.add(listener);
    load().then(listener);
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, []);

  return entries;
}
