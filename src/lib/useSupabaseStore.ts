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
 * A local backup of the last value Supabase actually returned, so a request that fails —
 * a network drop, or Supabase itself refusing traffic once an egress quota is spent — does
 * not leave the app showing an empty list where the user's data used to be. It is written
 * every time a key is published, successful load or local write alike, and read only when
 * a live request has just failed.
 */
const MIRROR_PREFIX = "hr_offline_mirror:";

function readMirror<T>(key: string): T[] | null {
  try {
    const raw = window.localStorage.getItem(MIRROR_PREFIX + key);
    return raw ? (JSON.parse(raw) as T[]) : null;
  } catch {
    return null;
  }
}

function writeMirror(key: string, value: unknown[]) {
  try {
    window.localStorage.setItem(MIRROR_PREFIX + key, JSON.stringify(value));
  } catch {
    // Over the browser's storage quota, or storage is unavailable (a private window). The
    // mirror is a convenience, not a requirement, so this is skipped rather than surfaced.
  }
}

/**
 * Whether any key's most recent load or save actually reached Supabase. False the moment
 * a request fails, true again as soon as one succeeds — so the app-wide "showing saved
 * data" banner clears itself the instant the connection (or the quota) recovers.
 */
const offlineKeys = new Set<string>();
const offlineListeners = new Set<() => void>();

function setOffline(key: string, offline: boolean) {
  const was = offlineKeys.has(key);
  if (offline === was) return;
  if (offline) offlineKeys.add(key);
  else offlineKeys.delete(key);
  offlineListeners.forEach((fn) => fn());
}

/**
 * True while at least one store's last attempt to reach Supabase failed. One request
 * failing for this reason means the rest likely will too, so this is deliberately a single
 * app-wide flag rather than one per key — simpler to show, and just as informative.
 */
export function useIsOffline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      offlineListeners.add(onChange);
      return () => offlineListeners.delete(onChange);
    },
    () => offlineKeys.size > 0,
    () => false
  );
}

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
  offlineKeys.clear();
  lastSaved.clear();
}

/**
 * Reads a key's current shared value without subscribing a component to it.
 *
 * For a value fetched with `autoLoad: false`: after `await reload()`, the fetch has
 * already published into the shared cache (that happens before the promise resolves),
 * but the component's own `items` will not reflect it until React re-renders — which,
 * inside the same event handler, is too late to read synchronously. This reads the cache
 * directly instead of waiting on that render.
 */
export function getStoreSnapshot<T>(key: string): T[] {
  return (caches.get(key) as T[] | undefined) ?? [];
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
  writeMirror(key, next);
  subscribers.get(key)?.forEach((fn) => fn());
}

function markLoaded(key: string) {
  if (loadedKeys.has(key)) return;
  loadedKeys.add(key);
  subscribers.get(key)?.forEach((fn) => fn());
}

/**
 * A big list goes to Supabase gzipped. The employee list is close to 2 MB of JSON — the
 * same checklist wording and field names repeated for every employee — and every save
 * rewrote, and every load downloaded, all of it. Gzipped it is a fraction of that, which
 * is what keeps the project inside the free plan's disk and egress budgets.
 *
 * Reading accepts either form, so rows saved before this existed still load, and a value
 * that does not shrink (an uploaded Word template is already compressed) is stored as is.
 */
const PACK_THRESHOLD = 64 * 1024;
type Packed = { packed: "gzip-base64"; data: string };

function isPacked(value: unknown): value is Packed {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Packed).packed === "gzip-base64" &&
    typeof (value as Packed).data === "string"
  );
}

async function gzipBase64(text: string): Promise<string | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function gunzipBase64(data: string): Promise<string> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function toStored(json: string, list: unknown[]): Promise<unknown> {
  if (json.length < PACK_THRESHOLD) return list;
  const data = await gzipBase64(json);
  if (!data || data.length > json.length * 0.7) return list;
  return { packed: "gzip-base64", data } satisfies Packed;
}

async function fromStored<T>(value: unknown): Promise<T[] | null> {
  if (isPacked(value)) return JSON.parse(await gunzipBase64(value.data)) as T[];
  return Array.isArray(value) ? (value as T[]) : null;
}

/** The JSON last known to be in Supabase per key, so a save that changes nothing is skipped. */
const lastSaved = new Map<string, string>();

/** One key, straight from Supabase — or, if that fails, from the local mirror. */
async function fetchStoreValue<T>(key: string): Promise<T[] | null> {
  if (!supabaseReady) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : null;
    } catch {
      return null;
    }
  }
  try {
    const { data, error } = await supabase
      .from("app_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    setOffline(key, false);
    // No row yet is a legitimate empty state, not a failure — nothing to publish.
    const value = await fromStored<T>(data?.value);
    if (value) lastSaved.set(key, JSON.stringify(value));
    return value;
  } catch {
    // The request itself failed — a dropped connection, or Supabase refusing traffic
    // once a quota is spent. Whatever was last seen for this key, in this tab or a
    // previous one, is better than showing nothing at all.
    setOffline(key, true);
    return readMirror<T>(key);
  }
}

/**
 * Loads a key into the shared cache for code outside a component (the notification bell,
 * the employee name picker), so they reuse the copy the page already has instead of
 * downloading their own.
 */
export async function loadStore<T>(key: string, force = false): Promise<T[]> {
  await ensureLoaded(key, () => fetchStoreValue<T>(key), force);
  return getStoreSnapshot<T>(key);
}

/** Subscribes to a key's shared value outside the hook; returns the unsubscribe. */
export function subscribeStore(key: string, onChange: () => void): () => void {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(onChange);
  return () => {
    set?.delete(onChange);
  };
}

/**
 * How long after the last change a key is written back. Typing in a field used to save
 * the whole employee list once per keystroke; now a burst of edits is one save.
 */
export const SAVE_DELAY_MS = 1200;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveChains = new Map<string, Promise<void>>();
const saveWaiters = new Map<string, Array<() => void>>();

async function writeNow(key: string) {
  const list = caches.get(key) ?? [];
  const json = JSON.stringify(list);
  if (lastSaved.get(key) === json) return;
  try {
    const value = await toStored(json, list);
    const { error } = await supabase
      .from("app_store")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    lastSaved.set(key, json);
    setOffline(key, false);
    // The cache now holds exactly what the source holds, so nothing needs re-reading.
    loadedAt.set(key, Date.now());
  } catch {
    // The change is already visible locally and mirrored to localStorage, so nothing is
    // lost from under the user — but it has not reached Supabase, and the offline banner
    // is what tells them that. The next save of this key carries it along.
    setOffline(key, true);
  }
}

/** Writes a key now, after any save of it already on the wire, so saves land in order. */
function flushKey(key: string): Promise<void> {
  const timer = saveTimers.get(key);
  if (timer) clearTimeout(timer);
  saveTimers.delete(key);
  const waiters = saveWaiters.get(key) ?? [];
  saveWaiters.delete(key);
  const chain = (saveChains.get(key) ?? Promise.resolve()).then(() => writeNow(key));
  saveChains.set(key, chain);
  void chain.finally(() => {
    if (saveChains.get(key) === chain) saveChains.delete(key);
    waiters.forEach((done) => done());
  });
  return chain;
}

function scheduleSave(key: string): Promise<void> {
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  saveTimers.set(key, setTimeout(() => void flushKey(key), SAVE_DELAY_MS));
  return new Promise((resolve) => {
    saveWaiters.set(key, [...(saveWaiters.get(key) ?? []), resolve]);
  });
}

/** Sends every pending save straight away. */
export function flushPendingSaves(): Promise<void> {
  return Promise.all([...saveTimers.keys()].map(flushKey)).then(() => undefined);
}

if (typeof window !== "undefined") {
  // Leaving the tab sends whatever is still waiting; closing it inside the save delay
  // asks first, so a last edit is never dropped without a word.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingSaves();
  });
  window.addEventListener("beforeunload", (event) => {
    if (saveTimers.size === 0 && saveChains.size === 0) return;
    void flushPendingSaves();
    event.preventDefault();
  });
}

export function useSupabaseStore<T extends { id: string }>(
  key: string,
  initial: T[] = [],
  options?: {
    /**
     * Set to `false` for a key that is large and only sometimes needed — an uploaded PDF
     * template, say — so it is not pulled down on every visit to a page that merely
     * mentions it. The caller fetches it themselves, via `reload()`, once it actually
     * knows the value is wanted; until then `items` stays empty and `hydrated` stays
     * false, exactly as while a normal load is still in flight.
     */
    autoLoad?: boolean;
  }
) {
  const autoLoad = options?.autoLoad ?? true;
  // Captured once so the snapshot getter stays stable across renders.
  const [seed] = useState(initial);

  const subscribe = useCallback((onChange: () => void) => subscribeStore(key, onChange), [key]);

  const getSnapshot = useCallback(() => cacheFor<T>(key, seed), [key, seed]);

  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isLoaded = useCallback(() => loadedKeys.has(key), [key]);
  const hydrated = useSyncExternalStore(subscribe, isLoaded, () => false);

  const load = useCallback(
    (force = false) => ensureLoaded(key, () => fetchStoreValue<T>(key), force),
    [key]
  );

  useEffect(() => {
    if (!autoLoad) return;
    // Not forced: a key already in the shared cache is not fetched again. Depending on
    // autoLoad itself means a caller whose condition starts false and later turns true —
    // "load this template once the employee turns out to need it" — gets the fetch the
    // moment it does, with nothing more to call.
    load();
  }, [load, autoLoad]);

  const reload = useCallback(() => load(true), [load]);

  const persist = useCallback(
    (next: T[]): Promise<void> => {
      // Shown everywhere at once; the write to Supabase follows once the edits pause.
      publish(key, next);
      if (!supabaseReady) {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // ignore
        }
        return Promise.resolve();
      }
      return scheduleSave(key);
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
