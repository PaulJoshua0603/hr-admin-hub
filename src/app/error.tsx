"use client";

import Link from "next/link";

/**
 * Catches an unexpected render error in any page so a single bad record shows a
 * recoverable message instead of a blank screen. "Try again" re-renders the segment
 * without a full reload, which keeps whatever was already loaded in memory.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-16">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-warn-soft text-lg text-warn">
        !
      </span>
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink">Something went wrong here</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This page hit an unexpected error. Your saved data is untouched — try again, and if it keeps
          happening, the details below help pin down the cause.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="press-scale inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/25 transition-all hover:brightness-110"
        >
          Try again
        </button>
        <Link
          href="/"
          className="press-scale inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3.5 text-sm font-medium text-ink transition-all hover:bg-background"
        >
          Back to dashboard
        </Link>
      </div>

      <details className="w-full rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Error details
        </summary>
        <p className="mt-3 break-words font-mono text-xs leading-relaxed text-ink-muted">
          {error.message || "No message provided."}
          {error.digest ? ` (digest: ${error.digest})` : ""}
        </p>
      </details>
    </div>
  );
}
