"use client";

import { useState } from "react";
import Link from "next/link";
import type { Employee } from "@/types";
import { Button } from "@/components/ui";
import { EmployeeAvatar, hdPathOf } from "@/components/ProfilePhoto";
import { supabase } from "@/lib/supabaseClient";
import { useNotifications } from "@/lib/notificationContext";

/** File names Windows accepts: no \ / : * ? " < > | */
const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Employee";

/**
 * Pictures: the employees hired within the selected dates, with their photo, name,
 * position and department, and every photo downloadable as a JPG named after the person.
 */
export function PicturesView({ employees, periodLabel }: { employees: Employee[]; periodLabel: string }) {
  const { notify } = useNotifications();
  const [exporting, setExporting] = useState(false);
  const withPhoto = employees.filter((e) => e.photoPath);

  async function exportJpgs() {
    if (withPhoto.length === 0) {
      notify("None of these employees has a profile picture yet.", "warn");
      return;
    }
    setExporting(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      let added = 0;
      for (const e of withPhoto) {
        // The HD copy when there is one, otherwise the small picture.
        let file = (await supabase.storage.from("files").download(hdPathOf(e.photoPath!))).data;
        if (!file) file = (await supabase.storage.from("files").download(e.photoPath!)).data;
        if (!file) continue;
        let name = safeFileName(e.name);
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${safeFileName(e.name)} (${n})`;
        used.add(name.toLowerCase());
        zip.file(`${name}.jpg`, file);
        added++;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Pictures - ${periodLabel}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Exported ${added} picture${added === 1 ? "" : "s"} as JPG`, "created");
    } catch (err) {
      notify(`Could not export the pictures: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          Employees hired/onboarded in the selected dates · {withPhoto.length} of {employees.length} with a picture.
        </p>
        <Button onClick={exportJpgs} disabled={exporting}>
          {exporting ? "Exporting…" : "Export Pictures as JPG"}
        </Button>
      </div>
      {employees.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
          No employees hired in this date range.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {employees.map((e) => (
            <Link
              key={e.id}
              href={`/employees/${e.id}`}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-center transition-colors hover:border-accent"
            >
              <EmployeeAvatar path={e.photoPath} name={e.name} size={96} />
              <span className="text-sm font-medium text-ink">{e.name}</span>
              <span className="text-xs text-ink-muted">{e.position || "—"}</span>
              <span className="text-xs text-ink-muted">{e.department || "—"}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
