"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "hr-admin-theme";

/**
 * The blocking script in the document head already puts the `dark` class on <html>
 * before first paint, so the class itself is the source of truth. Reading it through
 * useSyncExternalStore keeps the provider in step without an effect that would have to
 * re-render everything a second time just to correct the theme.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The server has no DOM to read; the head script corrects this before paint. */
function getServerSnapshot(): Theme {
  return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Private mode or blocked storage — the theme still applies for this session.
    }
    listeners.forEach((fn) => fn());
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
