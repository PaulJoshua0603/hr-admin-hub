"use client";

import { useState, useSyncExternalStore } from "react";
import { format } from "date-fns";
import { Button, Card, FileButton, SectionHeading } from "@/components/ui";
import { useNotifications } from "@/lib/notificationContext";
import { exportAllData, restoreAllData, type BackupFile } from "@/lib/useSupabaseStore";

const LAST_BACKUP_KEY = "hr_last_backup_at";
const REMIND_AFTER_DAYS = 7;

function readLastBackup(): string | null {
  try {
    return window.localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

function saveFile(backup: BackupFile, label: string) {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `HR Admin Hub ${label} - ${format(new Date(), "yyyy-MM-dd HHmm")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * The backup plan: every record in the system downloaded to one file kept off Supabase,
 * and the same file written back — into this project, or into a new one after a move.
 */
export default function BackupPage() {
  const { notify } = useNotifications();
  // Read from this browser after the first render, so the server and client agree.
  const storedBackup = useSyncExternalStore(() => () => {}, readLastBackup, () => null);
  const [justSaved, setLastBackup] = useState<string | null>(null);
  const lastBackup = justSaved ?? storedBackup;
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  // Today as of opening the page — fine for a count of whole days.
  const [openedAt] = useState(() => Date.now());

  const daysSince = lastBackup ? Math.floor((openedAt - new Date(lastBackup).getTime()) / 86_400_000) : null;
  const overdue = daysSince === null || daysSince >= REMIND_AFTER_DAYS;

  async function backupNow() {
    setBusy("backup");
    try {
      const backup = await exportAllData();
      saveFile(backup, "Backup");
      const now = new Date().toISOString();
      try {
        window.localStorage.setItem(LAST_BACKUP_KEY, now);
      } catch {
        // ignore
      }
      setLastBackup(now);
      notify(`Backup downloaded (${Object.keys(backup.data).length} data sets)`, "created");
    } catch (err) {
      notify(`Backup failed: ${err instanceof Error ? err.message : "could not reach the server"}`, "warn");
    } finally {
      setBusy(null);
    }
  }

  async function restore(file: File) {
    let backup: BackupFile;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      notify("That file could not be read as a backup.", "warn");
      return;
    }
    const taken = backup?.exportedAt ? format(new Date(backup.exportedAt), "MMMM d, yyyy h:mm a") : "an unknown date";
    if (
      !window.confirm(
        `Restore the backup from ${taken}?\n\nEverything it contains replaces what is in the system now. A copy of the current data is downloaded first, just in case.`
      )
    ) {
      return;
    }
    setBusy("restore");
    try {
      // A safety copy of what is about to be replaced.
      saveFile(await exportAllData(), "Before Restore");
      const count = await restoreAllData(backup);
      notify(`Restored ${count} data sets — reloading`, "created");
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      notify(`Restore failed: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeading
        title="Backup"
        subtitle="Keep a copy of all HR Admin Hub data on your own computer or drive."
      />

      <Card className="mb-6">
        <h2 className="font-display text-lg text-ink">Download a backup</h2>
        <p className="mt-1 text-sm text-ink-muted">
          One file with every record: employees, COE requests, milestone notes, ER2 forms, reports,
          tasks and the uploaded templates. Keep it somewhere safe, such as Google Drive or OneDrive.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={backupNow} disabled={busy !== null}>
            {busy === "backup" ? "Preparing…" : "Download backup"}
          </Button>
          <span className={`text-sm ${overdue ? "font-medium text-warn" : "text-ink-muted"}`}>
            {lastBackup
              ? `Last backup on this computer: ${format(new Date(lastBackup), "MMMM d, yyyy h:mm a")}${
                  overdue ? ` — ${daysSince} days ago, time for a new one` : ""
                }`
              : "No backup downloaded on this computer yet."}
          </span>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Recommended: once a week. Generated COE and contract files in Files are not included — they
          can be generated again from the employee records.
        </p>
      </Card>

      <Card>
        <h2 className="font-display text-lg text-ink">Restore from a backup</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Puts a backup file back into the system — after data loss, or to move HR Admin Hub to a new
          database. Everything in the file replaces what is there now; a copy of the current data is
          downloaded first.
        </p>
        <div className="mt-4">
          <FileButton accept=".json,application/json" onFile={restore} disabled={busy !== null}>
            {busy === "restore" ? "Restoring…" : "Choose backup file"}
          </FileButton>
        </div>
      </Card>
    </div>
  );
}
