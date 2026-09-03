"use client";

import { useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import * as XLSX from "@e965/xlsx";
import { addDays, addWeeks, format, isWithinInterval, parseISO, startOfWeek } from "date-fns";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { addDaysISO, formatDate } from "@/lib/dates";
import { Button, Card, Input, SectionHeading } from "@/components/ui";
import { RichTextEditor } from "@/components/RichTextEditor";
import { exportNodeToPdf } from "@/lib/pdfExport";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import { useNotifications } from "@/lib/notificationContext";
import {
  REQUIREMENT_LABELS,
  type ActivityReport,
  type ActivityRow,
  type ChallengeRow,
  type Employee,
  type ReportImage,
  type RequirementKey,
  type Task,
} from "@/types";


const MONTH_DAYS = 30;

const HEADERS = [
  "Employee Name",
  "Position",
  "Department",
  "Date Hired",
  "Completion Status",
  "3rd Month Date",
  "5th Month Date",
  "Anniversary Date",
  "Birthday",
];

function safeDate(iso?: string): string {
  if (!iso) return "";
  try {
    return formatDate(iso);
  } catch {
    return "";
  }
}

function completionStatus(e: Employee): string {
  const entries = Object.entries(e.requirements || {}) as [RequirementKey, string][];
  const lacking = entries
    .filter(([, status]) => status !== "complete")
    .map(([key]) => REQUIREMENT_LABELS[key]);
  if (entries.length === 0) return "Not Complete";
  if (lacking.length === 0) return "Complete";
  return `Not Complete - Lacking: ${lacking.join(", ")}`;
}

function employeeRow(e: Employee): string[] {
  const hired = e.dateHired;
  return [
    e.name || "",
    e.position || "",
    e.department || "",
    safeDate(hired),
    completionStatus(e),
    hired ? safeDate(addDaysISO(hired, 3 * MONTH_DAYS)) : "",
    hired ? safeDate(addDaysISO(hired, 5 * MONTH_DAYS)) : "",
    hired ? safeDate(addDaysISO(hired, 6 * MONTH_DAYS)) : "",
    safeDate(e.birthday),
  ];
}

function buildSheet(titleLine: string, employees: Employee[]) {
  const aoa: string[][] = [
    [titleLine],
    [],
    HEADERS,
    ...employees.map(employeeRow),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = HEADERS.map(() => ({ wch: 22 }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: HEADERS.length - 1 } }];
  return ws;
}

function inRange(iso: string | undefined, start: Date, end: Date): boolean {
  if (!iso) return false;
  try {
    return isWithinInterval(parseISO(iso), { start, end });
  } catch {
    return false;
  }
}

function taskDate(t: Task): string {
  return t.deadline || t.dateNeeded || t.inputDate;
}

export default function ReportsPage() {
  const [tab, setTab] = useState<"activity" | "exports">("activity");
  const [activitySubTab, setActivitySubTab] = useState<"daily" | "weekly">("daily");

  return (
    <div>
      <SectionHeading
        title="Reports"
        subtitle="Log activities and generate a structured report, or export employee/task data."
      />

      <div className="mb-6 flex gap-1 rounded-lg bg-background p-1 w-fit">
        {[
          { id: "activity" as const, label: "Activity Report" },
          { id: "exports" as const, label: "Data Exports" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-surface text-accent shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "activity" ? (
        <>
          <div className="mb-4 flex gap-1 rounded-lg border border-border bg-surface p-1 w-fit">
            {[
              { id: "daily" as const, label: "Daily" },
              { id: "weekly" as const, label: "Weekly" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActivitySubTab(t.id)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  activitySubTab === t.id
                    ? "bg-accent-soft text-accent"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {activitySubTab === "daily" ? <DailyReportTab /> : <WeeklyReportTab />}
        </>
      ) : (
        <DataExportsTab />
      )}
    </div>
  );
}

function DataExportsTab() {
  const { items: employees, hydrated } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );
  const { items: tasks, hydrated: tasksHydrated } = useSupabaseStore<Task>(
    "hr_tasks",
    []
  );
  const [generating, setGenerating] = useState(false);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const { notify } = useNotifications();

  const weekRange = useMemo(() => {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const friday = addDays(monday, 4);
    return { monday, friday };
  }, []);

  const nextWeekRange = useMemo(() => {
    const monday = addWeeks(weekRange.monday, 1);
    const friday = addDays(monday, 4);
    return { monday, friday };
  }, [weekRange]);

  function generateWeeklyTasksReport() {
    setGeneratingTasks(true);
    try {
      const { monday, friday } = weekRange;
      const { monday: nMonday, friday: nFriday } = nextWeekRange;

      const accomplished = tasks.filter(
        (t) => t.accomplished && inRange(t.accomplishedAt, monday, friday)
      );
      const remaining = tasks.filter(
        (t) => !t.accomplished && taskDate(t) && parseISO(taskDate(t)) <= friday
      );
      const nextWeek = tasks.filter(
        (t) =>
          !t.accomplished &&
          (inRange(t.deadline, nMonday, nFriday) ||
            inRange(t.dateNeeded, nMonday, nFriday) ||
            (t.recurrence && t.recurrence !== "none"))
      );

      const weekTitle = `Reports for this week of ${format(monday, "MMM d")} - ${format(
        friday,
        "MMM d, yyyy"
      )}`;

      const aoa: string[][] = [[weekTitle], []];

      aoa.push(["Accomplished Items This Week"]);
      aoa.push(["Title", "Notes", "Date Accomplished"]);
      if (accomplished.length === 0) aoa.push(["—", "", ""]);
      accomplished.forEach((t) =>
        aoa.push([t.title, t.notes || "", safeDate(t.accomplishedAt)])
      );
      aoa.push([]);

      aoa.push(["Remaining / Lacking Items"]);
      aoa.push(["Title", "Notes", "Deadline / Date Needed"]);
      if (remaining.length === 0) aoa.push(["—", "", ""]);
      remaining.forEach((t) =>
        aoa.push([t.title, t.notes || "", safeDate(taskDate(t))])
      );
      aoa.push([]);

      aoa.push(["Action Plans / Tasks Scheduled for Next Week"]);
      aoa.push(["Title", "Notes", "Deadline / Date Needed", "Recurrence"]);
      if (nextWeek.length === 0) aoa.push(["—", "", "", ""]);
      nextWeek.forEach((t) =>
        aoa.push([
          t.title,
          t.notes || "",
          safeDate(taskDate(t)),
          t.recurrence && t.recurrence !== "none" ? t.recurrence : "",
        ])
      );

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 30 }, { wch: 36 }, { wch: 20 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Weekly Report");

      const fileMonday = format(monday, "MMM_d");
      const fileFriday = format(friday, "MMM_d_yyyy");
      XLSX.writeFile(
        wb,
        `Reports_for_this_week_of_${fileMonday}_to_${fileFriday}.xlsx`
      );
      notify("Weekly tasks report generated", "created");
    } finally {
      setGeneratingTasks(false);
    }
  }

  function generateWorkbook() {
    setGenerating(true);
    try {
      const now = new Date();
      const wb = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        wb,
        buildSheet(`Requirements Report - ${format(now, "MMMM d, yyyy")}`, employees),
        "This Day"
      );

      const weekLabel = `Requirements Reports this week of ${format(
        weekRange.monday,
        "MMM d"
      )} - ${format(weekRange.friday, "MMM d, yyyy")}`;
      XLSX.utils.book_append_sheet(wb, buildSheet(weekLabel, employees), "Per Week");

      XLSX.utils.book_append_sheet(
        wb,
        buildSheet(`Requirements Report - ${format(now, "MMMM yyyy")}`, employees),
        "Per Month"
      );

      XLSX.utils.book_append_sheet(
        wb,
        buildSheet(`Requirements Report - ${format(now, "yyyy")}`, employees),
        "Per Year"
      );

      XLSX.writeFile(wb, "Requirements_Reports_Summary.xlsx");
      notify("Requirements report generated", "created");
    } finally {
      setGenerating(false);
    }
  }

  if (!hydrated || !tasksHydrated) return null;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={generateWorkbook}
          disabled={generating || employees.length === 0}
        >
          {generating ? "Generating…" : "Generate Requirements Report"}
        </Button>
      </div>

      <Card>
        <p className="text-sm font-medium text-ink">Employee Requirements Report</p>
        <p className="mt-1 text-xs text-ink-muted">
          Requirements_Reports_Summary.xlsx — 4 sheets: This Day, Per Week
          (week of {format(weekRange.monday, "MMM d")} –{" "}
          {format(weekRange.friday, "MMM d, yyyy")}), Per Month, Per Year.
        </p>
        <p className="mt-3 text-xs text-ink-muted">
          Fields: Employee Name, Position, Department, Date Hired, Completion
          Status (Complete / Not Complete with lacking requirements), 3rd
          Month Date, 5th Month Date, Anniversary Date, Birthday.
        </p>
        {employees.length === 0 && (
          <p className="mt-3 text-xs text-warn">
            No employees yet — add employees first to generate a report.
          </p>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">
              Tasks & Reminders Weekly Report
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Reports_for_this_week_of_{format(weekRange.monday, "MMM_d")}_to_
              {format(weekRange.friday, "MMM_d_yyyy")}.xlsx — single sheet:
              accomplished this week, remaining/lacking items, and action
              plans for next week ({format(nextWeekRange.monday, "MMM d")} –{" "}
              {format(nextWeekRange.friday, "MMM d, yyyy")}).
            </p>
          </div>
          <Button onClick={generateWeeklyTasksReport} disabled={generatingTasks}>
            {generatingTasks ? "Generating…" : "Generate Weekly Report"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- Activity Report ----------------------------- */

const REPORTS_BUCKET = "files";
const REPORTS_FOLDER = "reports";
const BAR_COLORS = ["#0E5E56", "#3F7D52", "#C1502B", "#5C6862", "#4FD1C5", "#8B5CF6"];

function emptyActivityReport(): ActivityReport {
  const today = format(new Date(), "yyyy-MM-dd");
  return {
    id: uuid(),
    period: "daily",
    date: today,
    preparedBy: "Hazel Bayani",
    preparedByPosition: "",
    summary: "",
    activities: [],
    challenges: [],
    actionPlan: "",
    images: [],
    createdAt: new Date().toISOString(),
  };
}

function DailyReportTab() {
  const { items: reports, hydrated, add, update, remove } = useSupabaseStore<ActivityReport>(
    "hr_activity_reports",
    []
  );
  const { items: tasks, hydrated: tasksReady } = useSupabaseStore<Task>("hr_tasks", []);
  const [draft, setDraft] = useState<ActivityReport>(emptyActivityReport);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { notify } = useNotifications();

  const periodRange = useMemo(() => {
    const anchor = parseISO(draft.date);
    return { start: anchor, end: anchor };
  }, [draft.date]);

  const accomplishedInRange = useMemo(() => {
    return tasks.filter((t) => {
      if (!t.accomplished || !t.accomplishedAt) return false;
      try {
        return isWithinInterval(parseISO(t.accomplishedAt), {
          start: periodRange.start,
          end: periodRange.end,
        });
      } catch {
        return false;
      }
    });
  }, [tasks, periodRange]);

  const chartData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of draft.activities) {
      const key = row.category.trim() || "Uncategorized";
      totals.set(key, (totals.get(key) || 0) + (Number(row.hours) || 0));
    }
    return Array.from(totals.entries()).map(([label, hours], i) => ({
      label,
      hours,
      color: BAR_COLORS[i % BAR_COLORS.length],
    }));
  }, [draft.activities]);

  const maxHours = Math.max(1, ...chartData.map((d) => d.hours));

  function updateDraft(patch: Partial<ActivityReport>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function addActivityRow() {
    const row: ActivityRow = { id: uuid(), activity: "", category: "", hours: 0 };
    updateDraft({ activities: [...draft.activities, row] });
  }

  function updateActivityRow(id: string, patch: Partial<ActivityRow>) {
    updateDraft({
      activities: draft.activities.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  function removeActivityRow(id: string) {
    updateDraft({ activities: draft.activities.filter((r) => r.id !== id) });
  }

  function addChallengeRow() {
    const row: ChallengeRow = { id: uuid(), challenge: "", solution: "" };
    updateDraft({ challenges: [...draft.challenges, row] });
  }

  function updateChallengeRow(id: string, patch: Partial<ChallengeRow>) {
    updateDraft({
      challenges: draft.challenges.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  function removeChallengeRow(id: string) {
    updateDraft({ challenges: draft.challenges.filter((r) => r.id !== id) });
  }

  async function handleImageUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !supabaseReady) return;
    setUploading(true);
    const uploaded: ReportImage[] = [];
    for (const file of Array.from(fileList)) {
      const path = `${REPORTS_FOLDER}/${draft.id}-${uuid()}-${file.name}`;
      const { error } = await supabase.storage.from(REPORTS_BUCKET).upload(path, file, {
        upsert: true,
      });
      if (!error) uploaded.push({ id: uuid(), path, name: file.name });
    }
    updateDraft({ images: [...draft.images, ...uploaded] });
    setUploading(false);
    if (uploaded.length > 0) {
      notify(
        uploaded.length === 1
          ? `Image attached: "${uploaded[0].name}"`
          : `${uploaded.length} images attached`,
        "created"
      );
    }
  }

  async function removeImage(img: ReportImage) {
    await supabase.storage.from(REPORTS_BUCKET).remove([img.path]);
    updateDraft({ images: draft.images.filter((i) => i.id !== img.id) });
    notify(`Image removed: "${img.name}"`, "deleted");
  }

  function saveDraft() {
    if (editingId) {
      update(editingId, draft);
      notify("Activity report draft updated", "updated");
    } else {
      add(draft);
      notify("Activity report draft saved", "created");
    }
    setEditingId(draft.id);
    setJustSaved(true);
  }

  function loadReport(r: ActivityReport) {
    setDraft(r);
    setEditingId(r.id);
    setJustSaved(false);
  }

  function newReport() {
    setDraft(emptyActivityReport());
    setEditingId(null);
    setJustSaved(false);
  }

  async function handleExportPdf() {
    if (!previewRef.current) return;
    setExporting(true);
    try {
      const filename = `HR_Admin_Report_${format(parseISO(draft.date), "MMM_d_yyyy")}.pdf`;
      await exportNodeToPdf(previewRef.current, filename);
      notify(`Report exported to PDF: "${filename}"`, "created");
    } finally {
      setExporting(false);
    }
  }

  if (!hydrated || !tasksReady) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Editor */}
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Log activities</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={newReport}>New</Button>
              <Button onClick={saveDraft}>{editingId ? "Update" : "Save"} draft</Button>
            </div>
          </div>

          {justSaved && (
            <div className="mb-3 flex items-center justify-between rounded-md bg-success-soft px-3 py-2 text-sm text-success">
              <span>Report saved.</span>
              <button onClick={newReport} className="font-medium underline">
                Create New Report
              </button>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Date
            <Input
              type="date"
              value={draft.date}
              onChange={(e) => updateDraft({ date: e.target.value })}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Prepared by
              <Input
                value={draft.preparedBy}
                onChange={(e) => updateDraft({ preparedBy: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Position
              <Input
                value={draft.preparedByPosition || ""}
                onChange={(e) => updateDraft({ preparedByPosition: e.target.value })}
              />
            </label>
          </div>
        </Card>

        <Card>
          <p className="mb-2 text-sm font-medium text-ink">Summary of activities</p>
          <RichTextEditor
            value={draft.summary}
            onChange={(html) => updateDraft({ summary: html })}
            placeholder="Narrative summary of what you worked on…"
            minHeight="100px"
          />
        </Card>

        {draft.summary.trim().length > 0 && (
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">Activity table</p>
              <Button variant="ghost" onClick={addActivityRow}>+ Add row</Button>
            </div>
            <div className="flex flex-col gap-2">
              {draft.activities.length === 0 && (
                <p className="text-xs text-ink-muted">No activities logged yet.</p>
              )}
              {draft.activities.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_1fr_70px_28px] gap-2">
                  <Input
                    placeholder="Activity"
                    value={row.activity}
                    onChange={(e) => updateActivityRow(row.id, { activity: e.target.value })}
                  />
                  <Input
                    placeholder="Category"
                    value={row.category}
                    onChange={(e) => updateActivityRow(row.id, { category: e.target.value })}
                  />
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="Hrs"
                    value={row.hours || ""}
                    onChange={(e) =>
                      updateActivityRow(row.id, { hours: parseFloat(e.target.value) || 0 })
                    }
                  />
                  <button
                    onClick={() => removeActivityRow(row.id)}
                    className="text-xs text-ink-muted hover:text-warn"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Challenges & proposed solutions</p>
            <Button variant="ghost" onClick={addChallengeRow}>+ Add row</Button>
          </div>
          <div className="flex flex-col gap-2">
            {draft.challenges.length === 0 && (
              <p className="text-xs text-ink-muted">None logged yet.</p>
            )}
            {draft.challenges.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_28px] gap-2">
                <Input
                  placeholder="Challenge encountered"
                  value={row.challenge}
                  onChange={(e) => updateChallengeRow(row.id, { challenge: e.target.value })}
                />
                <Input
                  placeholder="Proposed solution"
                  value={row.solution}
                  onChange={(e) => updateChallengeRow(row.id, { solution: e.target.value })}
                />
                <button
                  onClick={() => removeChallengeRow(row.id)}
                  className="text-xs text-ink-muted hover:text-warn"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="mb-2 text-sm font-medium text-ink">
            Action plan — next period&apos;s tasks & planned implementations
          </p>
          <RichTextEditor
            value={draft.actionPlan}
            onChange={(html) => updateDraft({ actionPlan: html })}
            placeholder="What's planned for next week / upcoming implementations…"
            minHeight="100px"
          />
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Screenshots / images</p>
            <Button
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "+ Add images"}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleImageUpload(e.target.files)}
          />
          {draft.images.length === 0 ? (
            <p className="text-xs text-ink-muted">No images attached.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {draft.images.map((img) => (
                <div key={img.id} className="relative">
                  <ReportImageThumb path={img.path} />
                  <button
                    onClick={() => removeImage(img)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {reports.length > 0 && (
          <Card>
            <p className="mb-2 text-sm font-medium text-ink">Saved drafts</p>
            <div className="flex flex-col gap-1">
              {reports.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <span className="truncate text-ink">
                    {formatDate(r.date)}
                    {r.preparedByPosition ? ` — ${r.preparedByPosition}` : ""}
                  </span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => loadReport(r)}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        remove(r.id);
                        notify("Activity report draft deleted", "deleted");
                      }}
                      className="text-xs text-ink-muted hover:text-warn"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex justify-end">
          <Button onClick={handleExportPdf} disabled={exporting}>
            {exporting ? "Exporting…" : "Export to PDF"}
          </Button>
        </div>

        <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-lg border border-border bg-surface">
          <div ref={previewRef} className="bg-white p-8 text-[#1C2420]">
            <div className="mb-6 border-b-2 border-[#0E5E56] pb-4">
              <h1 className="font-display text-2xl">HR Admin Report</h1>
              <p className="mt-1 text-sm text-[#5C6862]">{formatDate(draft.date, "MMMM d, yyyy")}</p>
              <p className="text-sm text-[#5C6862]">Prepared by: {draft.preparedBy || "—"}</p>
              {draft.preparedByPosition && (
                <p className="text-sm text-[#5C6862]">{draft.preparedByPosition}</p>
              )}
            </div>

            {(draft.summary.trim().length > 0 || draft.activities.length > 0) && (
              <Section title="Summary of Activities">
                {draft.summary.trim().length > 0 && (
                  <div
                    className="prose-preview text-sm [&_h2]:font-display [&_h2]:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                    dangerouslySetInnerHTML={{ __html: draft.summary }}
                  />
                )}

                {draft.activities.length > 0 && (
                  <table className="mt-3 w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#E4F0EE] text-left">
                        <th className="border border-[#DDE3DD] px-2 py-1.5">Activity</th>
                        <th className="border border-[#DDE3DD] px-2 py-1.5">Category</th>
                        <th className="border border-[#DDE3DD] px-2 py-1.5">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.activities.map((row) => (
                        <tr key={row.id}>
                          <td className="border border-[#DDE3DD] px-2 py-1.5">{row.activity || "—"}</td>
                          <td className="border border-[#DDE3DD] px-2 py-1.5">{row.category || "—"}</td>
                          <td className="border border-[#DDE3DD] px-2 py-1.5">{row.hours || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
            )}

            {chartData.length > 0 && (
              <Section title="Hours by Category">
                <div className="flex flex-col gap-2">
                  {chartData.map((d) => (
                    <div key={d.label} className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 truncate text-[#5C6862]">{d.label}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-[#F2F4F1]">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${(d.hours / maxHours) * 100}%`,
                            backgroundColor: d.color,
                          }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[#5C6862]">{d.hours}h</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {accomplishedInRange.length > 0 && (
              <Section title="Checklist of Accomplished Tasks">
                <ul className="flex flex-col gap-1 text-sm">
                  {accomplishedInRange.map((t) => (
                    <li key={t.id} className="flex items-start gap-2">
                      <span className="mt-0.5">☑</span>
                      <span>{t.title}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {draft.images.length > 0 && (
              <Section title="Images / Screenshots">
                <div className="grid grid-cols-2 gap-3">
                  {draft.images.map((img) => (
                    <ReportImageThumb key={img.id} path={img.path} large />
                  ))}
                </div>
              </Section>
            )}

            {draft.actionPlan.trim().length > 0 && (
              <Section title="Action Plan">
                <div
                  className="prose-preview text-sm [&_h2]:font-display [&_h2]:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                  dangerouslySetInnerHTML={{ __html: draft.actionPlan }}
                />
              </Section>
            )}

            {draft.challenges.length > 0 && (
              <Section title="Challenges Encountered & Proposed Solutions">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#E4F0EE] text-left">
                      <th className="border border-[#DDE3DD] px-2 py-1.5">Challenge</th>
                      <th className="border border-[#DDE3DD] px-2 py-1.5">Proposed Solution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.challenges.map((row) => (
                      <tr key={row.id}>
                        <td className="border border-[#DDE3DD] px-2 py-1.5">{row.challenge || "—"}</td>
                        <td className="border border-[#DDE3DD] px-2 py-1.5">{row.solution || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}

            {draft.summary.trim().length === 0 &&
              draft.activities.length === 0 &&
              chartData.length === 0 &&
              accomplishedInRange.length === 0 &&
              draft.images.length === 0 &&
              draft.actionPlan.trim().length === 0 &&
              draft.challenges.length === 0 && (
                <p className="text-sm text-[#5C6862]">
                  Nothing logged yet — fill in the form on the left to build this report.
                </p>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Weekly Report ------------------------------ */

function WeeklyReportTab() {
  const { items: reports, hydrated } = useSupabaseStore<ActivityReport>(
    "hr_activity_reports",
    []
  );
  const { items: tasks, hydrated: tasksReady } = useSupabaseStore<Task>("hr_tasks", []);
  const [weekAnchor, setWeekAnchor] = useState(format(new Date(), "yyyy-MM-dd"));
  const [exporting, setExporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const monday = useMemo(
    () => startOfWeek(parseISO(weekAnchor), { weekStartsOn: 1 }),
    [weekAnchor]
  );
  const friday = useMemo(() => addDays(monday, 4), [monday]);

  const dailyReportsThisWeek = useMemo(() => {
    return reports
      .filter((r) => inRange(r.date, monday, friday))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [reports, monday, friday]);

  const completedTasksThisWeek = useMemo(() => {
    return tasks.filter(
      (t) => t.accomplished && t.accomplishedAt && inRange(t.accomplishedAt, monday, friday)
    );
  }, [tasks, monday, friday]);

  const combinedActivities = useMemo(
    () => dailyReportsThisWeek.flatMap((r) => r.activities),
    [dailyReportsThisWeek]
  );

  const combinedChallenges = useMemo(
    () => dailyReportsThisWeek.flatMap((r) => r.challenges),
    [dailyReportsThisWeek]
  );

  const chartData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of combinedActivities) {
      const key = row.category.trim() || "Uncategorized";
      totals.set(key, (totals.get(key) || 0) + (Number(row.hours) || 0));
    }
    return Array.from(totals.entries()).map(([label, hours], i) => ({
      label,
      hours,
      color: BAR_COLORS[i % BAR_COLORS.length],
    }));
  }, [combinedActivities]);

  const maxHours = Math.max(1, ...chartData.map((d) => d.hours));

  const latestReport = dailyReportsThisWeek[dailyReportsThisWeek.length - 1];

  async function handleExportPdf() {
    if (!previewRef.current) return;
    setExporting(true);
    try {
      const filename = `HR_Admin_Weekly_Report_${format(monday, "MMM_d")}_to_${format(
        friday,
        "MMM_d_yyyy"
      )}.pdf`;
      await exportNodeToPdf(previewRef.current, filename);
    } finally {
      setExporting(false);
    }
  }

  if (!hydrated || !tasksReady) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Card>
          <p className="mb-2 text-sm font-medium text-ink">Week</p>
          <Input
            type="date"
            value={weekAnchor}
            onChange={(e) => setWeekAnchor(e.target.value)}
          />
          <p className="mt-2 text-xs text-ink-muted">
            Showing {format(monday, "MMM d")} – {format(friday, "MMM d, yyyy")} (Monday–Friday),
            auto-summarized from {dailyReportsThisWeek.length} saved daily report
            {dailyReportsThisWeek.length === 1 ? "" : "s"}.
          </p>
        </Card>

        {dailyReportsThisWeek.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">
              No daily reports saved for this week yet. Save daily reports under the
              Daily tab and they&apos;ll roll up here automatically.
            </p>
          </Card>
        ) : (
          <Card>
            <p className="mb-2 text-sm font-medium text-ink">Days included</p>
            <ul className="flex flex-col gap-1 text-sm">
              {dailyReportsThisWeek.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span className="text-ink">{formatDate(r.date, "EEEE, MMM d")}</span>
                  <span className="text-xs text-ink-muted">
                    {r.activities.length} activit{r.activities.length === 1 ? "y" : "ies"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex justify-end">
          <Button onClick={handleExportPdf} disabled={exporting || dailyReportsThisWeek.length === 0}>
            {exporting ? "Exporting…" : "Export to PDF"}
          </Button>
        </div>

        <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-lg border border-border bg-surface">
          <div ref={previewRef} className="bg-white p-8 text-[#1C2420]">
            <div className="mb-6 border-b-2 border-[#0E5E56] pb-4">
              <h1 className="font-display text-2xl">HR Admin Report</h1>
              <p className="mt-1 text-sm text-[#5C6862]">
                Week of {format(monday, "MMMM d")} – {format(friday, "MMM d, yyyy")}
              </p>
              <p className="text-sm text-[#5C6862]">
                Prepared by: {latestReport?.preparedBy || "Hazel Bayani"}
              </p>
              {latestReport?.preparedByPosition && (
                <p className="text-sm text-[#5C6862]">{latestReport.preparedByPosition}</p>
              )}
            </div>

            {dailyReportsThisWeek.map((r) =>
              r.summary.trim().length > 0 ? (
                <Section key={r.id} title={formatDate(r.date, "EEEE, MMM d")}>
                  <div
                    className="prose-preview text-sm [&_h2]:font-display [&_h2]:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                    dangerouslySetInnerHTML={{ __html: r.summary }}
                  />
                </Section>
              ) : null
            )}

            {combinedActivities.length > 0 && (
              <Section title="Activity Table (Mon–Fri)">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#E4F0EE] text-left">
                      <th className="border border-[#DDE3DD] px-2 py-1.5">Activity</th>
                      <th className="border border-[#DDE3DD] px-2 py-1.5">Category</th>
                      <th className="border border-[#DDE3DD] px-2 py-1.5">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedActivities.map((row) => (
                      <tr key={row.id}>
                        <td className="border border-[#DDE3DD] px-2 py-1.5">{row.activity || "—"}</td>
                        <td className="border border-[#DDE3DD] px-2 py-1.5">{row.category || "—"}</td>
                        <td className="border border-[#DDE3DD] px-2 py-1.5">{row.hours || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}

            {chartData.length > 0 && (
              <Section title="Hours by Category">
                <div className="flex flex-col gap-2">
                  {chartData.map((d) => (
                    <div key={d.label} className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 truncate text-[#5C6862]">{d.label}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-[#F2F4F1]">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${(d.hours / maxHours) * 100}%`,
                            backgroundColor: d.color,
                          }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[#5C6862]">{d.hours}h</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {completedTasksThisWeek.length > 0 && (
              <Section title="Completed Reports & Tasks This Week">
                <ul className="flex flex-col gap-1 text-sm">
                  {completedTasksThisWeek.map((t) => (
                    <li key={t.id} className="flex items-start gap-2">
                      <span className="mt-0.5">☑</span>
                      <span>{t.title}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {combinedChallenges.length > 0 && (
              <Section title="Challenges Encountered & Proposed Solutions">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#E4F0EE] text-left">
                      <th className="border border-[#DDE3DD] px-2 py-1.5">Challenge</th>
                      <th className="border border-[#DDE3DD] px-2 py-1.5">Proposed Solution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedChallenges.map((row) => (
                      <tr key={row.id}>
                        <td className="border border-[#DDE3DD] px-2 py-1.5">{row.challenge || "—"}</td>
                        <td className="border border-[#DDE3DD] px-2 py-1.5">{row.solution || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}

            {dailyReportsThisWeek.length === 0 && (
              <p className="text-sm text-[#5C6862]">
                No daily reports saved for this week yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="font-display mb-2 text-base text-[#0E5E56]">{title}</h2>
      {children}
    </div>
  );
}

function ReportImageThumb({ path, large = false }: { path: string; large?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useMemo(() => {
    if (!supabaseReady) return;
    supabase.storage
      .from(REPORTS_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl || null));
  }, [path]);

  if (!url) {
    return (
      <div
        className={`flex items-center justify-center rounded-md bg-[#F2F4F1] text-xs text-[#5C6862] ${
          large ? "h-40" : "h-20"
        }`}
      >
        Loading…
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt="Report attachment"
      className={`w-full rounded-md object-cover ${large ? "h-40" : "h-20"}`}
      crossOrigin="anonymous"
    />
  );
}
