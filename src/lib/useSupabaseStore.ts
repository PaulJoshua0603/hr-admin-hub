"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

/**
 * Several components can read the same store key at once (the COE tables in Reports,
 * the Centralized COE Tracker under Employees, the Excel export section). They share
 * one in-memory copy per key so a write in one place is visible in the others right
 * away instead of only after a reload.
 */
const caches = new Map<string, unknown[]>();
const subscribers = new Map<string, Set<() => void>>();
/** Keys whose first load has finished, tracked alongside the data so components can
 *  read hydration from the same snapshot instead of correcting it with an effect. */
const loadedKeys = new Set<string>();

function cacheFor<T>(key: string, seed: T[] = []): T[] {
  let cached = caches.get(key);
  if (!cached) {
    cached = seed;
    caches.set(key, cached);
  }
  return cached as T[];
}

function publish(key: string, next: unknown[]) {
  caches.set(key, next);
  subscribers.get(key)?.forEach((fn) => fn());
}

function markLoaded(key: string) {
  if (loadedKeys.has(key)) return;
  loadedKeys.add(key);
  subscribers.get(key)?.forEach((fn) => fn());
}

export function useSupabaseStore<T extends { id: string }>(
  key: string,
  initial: T[] = []
) {
  // Captured once so the snapshot getter stays stable across renders.
  const [seed] = useState(initial);

  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = subscribers.get(key);
      if (!set) {
        set = new Set();
        subscribers.set(key, set);
      }
      set.add(onChange);
      return () => {
        set?.delete(onChange);
      };
    },
    [key]
  );

  const getSnapshot = useCallback(() => cacheFor<T>(key, seed), [key, seed]);

  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isLoaded = useCallback(() => loadedKeys.has(key), [key]);
  const hydrated = useSyncExternalStore(subscribe, isLoaded, () => false);

  const load = useCallback(async () => {
    if (!supabaseReady) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) publish(key, JSON.parse(raw));
      } catch {
        // ignore
      }
      markLoaded(key);
      return;
    }
    const { data, error } = await supabase
      .from("app_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (!error && data?.value) {
      publish(key, data.value as T[]);
    }
    markLoaded(key);
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  const persist = useCallback(
    async (next: T[]) => {
      publish(key, next);
      if (!supabaseReady) {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // ignore
        }
        return;
      }
      await supabase
        .from("app_store")
        .upsert({ key, value: next, updated_at: new Date().toISOString() });
    },
    [key]
  );

  // Read the shared cache rather than the rendered snapshot, so back-to-back mutations
  // in one tick build on each other and on writes made by another component.
  const add = useCallback((item: T) => persist([item, ...cacheFor<T>(key)]), [key, persist]);

  const update = useCallback(
    (id: string, patch: Partial<T>) =>
      persist(cacheFor<T>(key).map((it) => (it.id === id ? { ...it, ...patch } : it))),
    [key, persist]
  );

  const remove = useCallback(
    (id: string) => persist(cacheFor<T>(key).filter((it) => it.id !== id)),
    [key, persist]
  );

  return { items, hydrated, setItems: persist, add, update, remove, reload: load };
}
