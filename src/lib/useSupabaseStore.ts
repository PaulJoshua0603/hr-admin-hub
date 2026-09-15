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
/** When each key last came back from the source, for the freshness window below. */
const loadedAt = new Map<string, number>();
/** Fetches already on the wire, so simultaneous mounts share one request. */
const inflight = new Map<string, Promise<void>>();

/**
 * How long a key stays fresh enough that an explicit refresh is skipped.
 *
 * Every write in this app goes through this store and updates the shared cache directly,
 * so the only thing a refresh can discover is a change made in another tab. That is rare
 * enough not to be worth re-downloading the whole employee list for on every search-box
 * focus — which is what it used to do.
 */
export const STORE_FRESHNESS_MS = 60_000;

/**
 * Loads a key at most once, no matter how many components ask for it.
 *
 * Several components read the same key on one screen — the Employees page alone mounts
 * `hr_employees` four times — and each mount used to pull the whole 1.7 MB record again.
 * Now the first caller fetches, everyone else waits on that same promise, and later mounts
 * are served from the cache.
 */
export async function ensureLoaded(
  key: string,
  fetcher: () => Promise<unknown[] | null>,
  force = false,
  now: number = Date.now()
): Promise<void> {
  const pending = inflight.get(key);
  if (pending) return pending;

  if (loadedKeys.has(key)) {
    if (!force) return;
    if (now - (loadedAt.get(key) ?? 0) < STORE_FRESHNESS_MS) return;
  }

  const request = (async () => {
    try {
      const value = await fetcher();
      if (value) publish(key, value);
    } finally {
      loadedAt.set(key, Date.now());
      inflight.delete(key);
      markLoaded(key);
    }
  })();
  inflight.set(key, request);
  return request;
}

/** Test seam: forget everything loaded so far. */
export function __resetStores() {
  caches.clear();
  loadedKeys.clear();
  loadedAt.clear();
  inflight.clear();
}

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

  const load = useCallback(
    (force = false) =>
      ensureLoaded(
        key,
        async () => {
          if (!supabaseReady) {
            try {
              const raw = window.localStorage.getItem(key);
              return raw ? (JSON.parse(raw) as T[]) : null;
            } catch {
              return null;
            }
          }
          const { data, error } = await supabase
            .from("app_store")
            .select("value")
            .eq("key", key)
            .maybeSingle();
          return !error && data?.value ? (data.value as T[]) : null;
        },
        force
      ),
    [key]
  );

  useEffect(() => {
    // Not forced: a key already in the shared cache is not fetched again.
    load();
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

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
      // The cache now holds exactly what the source holds, so nothing needs re-reading.
      loadedAt.set(key, Date.now());
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

  return { items, hydrated, setItems: persist, add, update, remove, reload };
}
