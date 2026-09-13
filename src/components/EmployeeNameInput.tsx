"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui";
import { useEmployeeDirectory, type DirectoryEntry } from "@/lib/useEmployeeDirectory";

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
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const term = value.trim().toLowerCase();
  const matches = (
    term
      ? employees.filter(
          (e) =>
            e.name.toLowerCase().includes(term) ||
            e.position.toLowerCase().includes(term) ||
            e.department.toLowerCase().includes(term)
        )
      : employees
  ).slice(0, 8);

  const showList = open && matches.length > 0;

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

  return (
    <div className={`relative ${className}`}>
      <Input
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
      />
      {showList && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 min-w-[220px] overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
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
                  {[entry.position, entry.department].filter(Boolean).join(" · ") || "No position/department on file"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
