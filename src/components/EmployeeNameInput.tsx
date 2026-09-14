"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui";
import { useEmployeeDirectory, type DirectoryEntry } from "@/lib/useEmployeeDirectory";

/** Where the suggestion list should sit, in viewport coordinates. */
type Anchor = { top: number; left: number; width: number };

/**
 * Employee name field with type-ahead suggestions drawn from the Employees section.
 * Picking a suggestion hands the caller the matching position/department so those
 * fields can be filled in automatically.
 */
export function EmployeeNameInput({
  value,
  onChange,
  onSelect,
  placeholder = "Employee Name",
  className = "",
  autoFocus = false,
}: {
  value: string;
  onChange: (name: string) => void;
  onSelect: (entry: DirectoryEntry) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const employees = useEmployeeDirectory();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const term = value.trim().toLowerCase();
  // Words are matched in any order, so the form's surname-first spelling finds someone
  // whose record reads the other way round: "BAYANI, HAZ" still reaches "Hazel E. Bayani".
  const words = term.split(/[\s,]+/).filter(Boolean);
  const matches = (
    words.length
      ? employees.filter((e) => {
          const haystack = `${e.name} ${e.position} ${e.department}`.toLowerCase();
          return words.every((w) => haystack.includes(w));
        })
      : employees
  ).slice(0, 8);

  const showList = open && matches.length > 0;

  /**
   * The list is drawn in a portal: this field is often inside a table that scrolls
   * sideways, and an absolutely positioned dropdown inside that scroll box gets clipped
   * the moment it opens — which looks exactly like having no suggestions at all.
   */
  const measure = useCallback(() => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (box) setAnchor({ top: box.bottom + 4, left: box.left, width: box.width });
  }, []);

  useEffect(() => {
    if (!showList) return;
    measure();
    // Follow the field if anything it sits inside scrolls or the window resizes.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [showList, measure]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  function choose(entry: DirectoryEntry) {
    onChange(entry.name);
    onSelect(entry);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(matches[Math.min(highlight, matches.length - 1)]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const list = showList && anchor && (
    <ul
      style={{ top: anchor.top, left: anchor.left, width: Math.max(anchor.width, 240) }}
      className="fixed z-50 max-h-60 overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
    >
      {matches.map((entry, i) => (
        <li key={entry.id}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              if (blurTimer.current) clearTimeout(blurTimer.current);
              choose(entry);
            }}
            onMouseEnter={() => setHighlight(i)}
            className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
              i === highlight ? "bg-background text-ink" : "text-ink"
            }`}
          >
            <span className="block truncate">{entry.name}</span>
            <span className="block truncate text-xs text-ink-muted">
              {[entry.position, entry.department].filter(Boolean).join(" · ") ||
                "No position/department on file"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <Input
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          setOpen(true);
          measure();
        }}
        onFocus={() => {
          setOpen(true);
          measure();
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
      />
      {list && typeof document !== "undefined" ? createPortal(list, document.body) : null}
    </div>
  );
}
