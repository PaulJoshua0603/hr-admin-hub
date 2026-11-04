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

/**
 * The device's own copy of every key, in IndexedDB (room for many megabytes, unlike
 * localStorage). Each entry carries the server's `updated_at` for that copy, so a load
 * first asks Supabase only for that timestamp — a few bytes — and downloads the value
 * itself only when it has changed. That is what keeps everyday use inside the free plan:
 * opening a page no longer pulls the whole employee list every time.
 *
 * `pending` marks a change made here that has not reached Supabase yet. It survives a
 * reload or a closed tab, and is sent as soon as Supabase answers again; until then it
 * is what this device shows, never an older copy from the server.
 */
type CacheEntry = { key: string; updatedAt: string | null; value: unknown[]; pending: boolean };
const IDB_NAME = "hr_admin_hub";
const IDB_STORE = "app_store";
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(IDB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE, { keyPath: "key" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function cacheGet(key: string): Promise<CacheEntry | null> {
  const db = await openCache();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
      request.onsuccess = () => resolve((request.result as CacheEntry | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePut(entry: CacheEntry): Promise<void> {
  const db = await openCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  // The old localStorage mirror is superseded; clearing it frees the browser's small quota.
  try {
    window.localStorage.removeItem(MIRROR_PREFIX + entry.key);
  } catch {
    // ignore
  }
}

/** Empties the device copy — used after a restore, so every page re-reads from Supabase. */
export async function clearDeviceCache(): Promise<void> {
  const db = await openCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

const sameStamp = (a?: string | null, b?: string | null) =>
  !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

/**
 * Runs a Supabase request, trying again twice on a failure that may pass (a dropped
 * connection, a timeout, a busy server) before giving up. Refusals that will not change
 * on a retry — permissions, or 402 once a quota is spent — are not repeated.
 */
async function withRetry<R extends { error: unknown; status?: number }>(run: () => PromiseLike<R>): Promise<R> {
  const delays = [800, 2500];
  for (let attempt = 0; ; attempt++) {
    let result: R;
    try {
      result = await run();
    } catch (err) {
      if (attempt >= delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
      continue;
    }
    const status = result.status ?? 0;
    const transient = !!result.error && (status === 0 || status === 408 || status === 429 || status >= 500);
    if (!transient || attempt >= delays.length) return result;
    await new Promise((r) => setTimeout(r, delays[attempt]));
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

/** The server's `updated_at` for each key as of the copy this tab holds. */
const serverStamps = new Map<string, string>();

/**
 * One key: the device copy when Supabase says it is still current, otherwise a fresh
 * download (which then becomes the device copy). If Supabase cannot be reached, the
 * device copy is used — and a change still waiting to be sent always wins over the
 * server's older version, and is sent again.
 */
async function fetchStoreValue<T>(key: string): Promise<T[] | null> {
  if (!supabaseReady) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : null;
    } catch {
      return null;
    }
  }
  const local = await cacheGet(key);
  if (local?.pending) {
    if (local.updatedAt) serverStamps.set(key, local.updatedAt);
    markPending(key);
    setTimeout(() => void flushKey(key), 0);
    return local.value as T[];
  }
  try {
    const head = await withRetry(() =>
      supabase.from("app_store").select("updated_at").eq("key", key).maybeSingle()
    );
    if (head.error) throw head.error;
    setOffline(key, false);
    // No row yet is a legitimate empty state, not a failure — nothing to publish.
    if (!head.data) return null;
    const stamp = (head.data as { updated_at: string }).updated_at;
    if (local && sameStamp(local.updatedAt, stamp)) {
      serverStamps.set(key, stamp);
      lastSaved.set(key, JSON.stringify(local.value));
      return local.value as T[];
    }
    const full = await withRetry(() =>
      supabase.from("app_store").select("value, updated_at").eq("key", key).maybeSingle()
    );
    if (full.error) throw full.error;
    const row = full.data as { value: unknown; updated_at: string } | null;
    const value = await fromStored<T>(row?.value);
    if (value && row) {
      lastSaved.set(key, JSON.stringify(value));
      serverStamps.set(key, row.updated_at);
      void cachePut({ key, updatedAt: row.updated_at, value, pending: false });
    }
    return value;
  } catch {
    // Supabase did not answer, even after retrying — a dropped connection, or traffic
    // refused once a quota is spent. Whatever this device last had is better than nothing.
    setOffline(key, true);
    return (local?.value as T[] | undefined) ?? readMirror<T>(key);
  }
}

/**
 * Keys with a change that has not reached Supabase. They are retried every 30 seconds,
 * when the browser comes back online and when the tab is shown again, until they land.
 */
const pendingKeys = new Set<string>();
let retryTimer: ReturnType<typeof setInterval> | null = null;

function markPending(key: string) {
  pendingKeys.add(key);
  if (!retryTimer && typeof window !== "undefined") {
    retryTimer = setInterval(retryPending, 30_000);
  }
}

function retryPending() {
  pendingKeys.forEach((key) => {
    if (!saveTimers.has(key) && !saveChains.has(key)) void flushKey(key);
  });
  if (pendingKeys.size === 0 && retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
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
  if (lastSaved.get(key) === json) {
    pendingKeys.delete(key);
    return;
  }
  try {
    const value = await toStored(json, list);
    const result = await withRetry(() =>
      supabase
        .from("app_store")
        .upsert({ key, value, updated_at: new Date().toISOString() })
        .select("updated_at")
        .single()
    );
    if (result.error) throw result.error;
    const stamp = (result.data as { updated_at: string } | null)?.updated_at ?? new Date().toISOString();
    lastSaved.set(key, json);
    serverStamps.set(key, stamp);
    setOffline(key, false);
    // The cache now holds exactly what the source holds, so nothing needs re-reading.
    loadedAt.set(key, Date.now());
    // Saved — unless another edit arrived while this one was on its way, which is then
    // what the device keeps (still pending) and what the next save sends.
    const current = caches.get(key) ?? [];
    const settled = current === list;
    if (settled) pendingKeys.delete(key);
    void cachePut({ key, updatedAt: stamp, value: current, pending: !settled });
  } catch {
    // Not saved, even after retrying. The change stays on this device, marked pending,
    // and is sent again automatically — on the next edit, every 30 seconds, or when the
    // connection comes back — so nothing typed in the meantime is lost.
    setOffline(key, true);
    markPending(key);
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

/**
 * Writes the device copy of an edited key, marked unsent, a moment after typing pauses —
 * the employee list is megabytes, too much to copy on every keystroke.
 */
const pendingCopyTimers = new Map<string, ReturnType<typeof setTimeout>>();
function queuePendingCopy(key: string) {
  const existing = pendingCopyTimers.get(key);
  if (existing) clearTimeout(existing);
  pendingCopyTimers.set(
    key,
    setTimeout(() => {
      pendingCopyTimers.delete(key);
      void cachePut({
        key,
        updatedAt: serverStamps.get(key) ?? null,
        value: caches.get(key) ?? [],
        pending: true,
      });
    }, 300)
  );
}

/** Everything in Supabase, unpacked, as one backup file's contents. */
export type BackupFile = {
  app: "HR Admin Hub";
  version: 1;
  exportedAt: string;
  data: Record<string, { updatedAt: string | null; value: unknown[] }>;
};

/** Sends anything unsaved, then reads every key from Supabase into a backup. */
export async function exportAllData(): Promise<BackupFile> {
  await flushPendingSaves();
  const result = await withRetry(() => supabase.from("app_store").select("key, value, updated_at"));
  if (result.error) throw result.error;
  const backup: BackupFile = { app: "HR Admin Hub", version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const row of (result.data ?? []) as { key: string; value: unknown; updated_at: string }[]) {
    const value = await fromStored<unknown>(row.value);
    if (value) backup.data[row.key] = { updatedAt: row.updated_at, value };
  }
  return backup;
}

/**
 * Writes a backup back into Supabase — into this project, or into a new one after moving
 * — replacing each key it contains. The device copy is cleared so pages re-read it all.
 */
export async function restoreAllData(backup: BackupFile): Promise<number> {
  if (backup?.app !== "HR Admin Hub" || !backup.data || typeof backup.data !== "object") {
    throw new Error("This is not an HR Admin Hub backup file.");
  }
  let count = 0;
  for (const [key, entry] of Object.entries(backup.data)) {
    if (!Array.isArray(entry?.value)) continue;
    const stored = await toStored(JSON.stringify(entry.value), entry.value);
    const result = await withRetry(() =>
      supabase.from("app_store").upsert({ key, value: stored, updated_at: new Date().toISOString() })
    );
    if (result.error) throw new Error(`Could not restore ${key}: ${result.error.message}`);
    count++;
  }
  pendingKeys.clear();
  await clearDeviceCache();
  return count;
}

if (typeof window !== "undefined") {
  // Leaving the tab sends whatever is still waiting; closing it inside the save delay
  // asks first, so a last edit is never dropped without a word.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingSaves();
    else retryPending();
  });
  // Back online: send anything that could not be saved while the connection was down.
  window.addEventListener("online", retryPending);
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
      // Kept on the device within moments, marked unsent, so a reload or a lost connection
      // before the save lands never loses it.
      queuePendingCopy(key);
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
