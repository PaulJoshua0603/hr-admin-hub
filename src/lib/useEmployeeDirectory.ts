"use client";

import { useEffect, useState } from "react";
import { getStoreSnapshot, loadStore, subscribeStore } from "@/lib/useSupabaseStore";
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

/** Re-reads the employee list from Supabase (subject to the store's freshness window). */
export function refreshEmployeeDirectory() {
  return loadStore<Employee>(STORE_KEY, true).then(toEntries);
}

/**
 * Read-only view of the employee list for the name pickers. It shares the one in-memory
 * copy the rest of the app uses — it used to download its own — and follows edits to it.
 */
export function useEmployeeDirectory() {
  const [entries, setEntries] = useState<DirectoryEntry[]>(() =>
    toEntries(getStoreSnapshot<Employee>(STORE_KEY))
  );

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (alive) setEntries(toEntries(getStoreSnapshot<Employee>(STORE_KEY)));
    };
    const unsubscribe = subscribeStore(STORE_KEY, sync);
    void loadStore<Employee>(STORE_KEY).then(sync);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return entries;
}
