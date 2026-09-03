"use client";

import { useTheme } from "@/lib/themeContext";
import { MoonIcon, SunIcon } from "@/components/icons";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`press-scale relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-ink-muted transition-colors hover:text-ink ${className}`}
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        <SunIcon
          size={16}
          className={`absolute transition-all duration-300 ${
            isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
          }`}
        />
        <MoonIcon
          size={16}
          className={`absolute transition-all duration-300 ${
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
          }`}
        />
      </span>
    </button>
  );
}
