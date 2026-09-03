"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

export function useSupabaseStore<T extends { id: string }>(
  key: string,
  initial: T[] = []
) {
  const [items, setItemsState] = useState<T[]>(initial);
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseReady) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) setItemsState(JSON.parse(raw));
      } catch {
        // ignore
      }
      setHydrated(true);
      return;
    }
    const { data, error } = await supabase
      .from("app_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (!error && data?.value) {
      setItemsState(data.value as T[]);
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  const persist = useCallback(
    async (next: T[]) => {
      setItemsState(next);
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

  const add = useCallback((item: T) => persist([item, ...items]), [items, persist]);

  const update = useCallback(
    (id: string, patch: Partial<T>) =>
      persist(items.map((it) => (it.id === id ? { ...it, ...patch } : it))),
    [items, persist]
  );

  const remove = useCallback(
    (id: string) => persist(items.filter((it) => it.id !== id)),
    [items, persist]
  );

  return { items, hydrated, setItems: persist, add, update, remove, reload: load };
}
