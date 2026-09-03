"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Simple localStorage-backed array store.
 * Data lives entirely in the browser for this starter version -
 * swap this out for a real database (Supabase, etc.) later.
 */
export function useLocalStore<T>(key: string, initial: T[] = []) {
  const [items, setItems] = useState<T[]>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback(
    (next: T[]) => {
      setItems(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
    },
    [key]
  );

  const add = useCallback(
    (item: T) => persist([item, ...items]),
    [items, persist]
  );

  const update = useCallback(
    (id: string, patch: Partial<T & { id: string }>) =>
      persist(
        items.map((it) =>
          (it as T & { id: string }).id === id ? { ...it, ...patch } : it
        )
      ),
    [items, persist]
  );

  const remove = useCallback(
    (id: string) =>
      persist(items.filter((it) => (it as T & { id: string }).id !== id)),
    [items, persist]
  );

  return { items, hydrated, setItems: persist, add, update, remove };
}
