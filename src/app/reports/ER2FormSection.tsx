"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, Input } from "@/components/ui";
import { PdfPagePreview } from "@/components/PdfPagePreview";
import { formatDate, todayISO } from "@/lib/dates";
import { inRange, rangeFor } from "@/lib/dateRanges";
import {
  ER2_COLUMN_LABELS,
  ER2_COLUMN_ORDER,
  ER2_FIELD_LABELS,
  DEFAULT_ER2_LAYOUT,
  cloneLayout,
  layoutOrDefault,
} from "@/lib/er2Layout";
import { buildCompletedER2, dataUrlToBytes, downloadPdf, pageCount } from "@/lib/er2Pdf";
import { useNotifications } from "@/lib/notificationContext";
import type {
  ER2Entry,
  ER2Form,
  ER2ReportRow,
  ER2SingleField,
  ER2Template,
  Employee,
} from "@/types";

const TEMPLATE_KEY = "hr_er2_template";
const FORMS_KEY = "hr_er2_forms";
const TEMPLATE_ID = "template";
const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;

const SINGLE_FIELDS: ER2SingleField[] = [
  "firmName",
  "employerNo",
  "address",
  "email",
  "initialBox",
  "subsequentBox",
  "totalListed",
  "pageNo",
  "sheets",
  "signature",
];

function emptyEmployer(): ER2Form["employer"] {
  return { firmName: "", employerNo: "", address: "", email: "", listType: "subsequent" };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export function ER2FormSection() {
  const { items: templates, hydrated, setItems: setTemplates } = useSupabaseStore<ER2Template>(
    TEMPLATE_KEY,
    []
  );
  const { items: forms, add: addForm, update: updateForm, remove: removeForm } =
    useSupabaseStore<ER2Form>(FORMS_KEY, []);
  const { items: er2Rows } = useSupabaseStore<ER2ReportRow>("hr_report_er2", []);
  const { items: employees } = useSupabaseStore<Employee>("hr_employees", []);
  const { notify } = useNotifications();

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [openFormId, setOpenFormId] = useState<string | null>(null);

  const monthRange = rangeFor("month", new Date());
  const [coverageStart, setCoverageStart] = useState(monthRange.start);
  const [coverageEnd, setCoverageEnd] = useState(monthRange.end);

  const template = templates.find((t) => t.id === TEMPLATE_ID) || templates[0];

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      notify("The ER2 template needs to be a PDF file.", "warn");
      return;
    }
    if (file.size > MAX_TEMPLATE_BYTES) {
      notify("That PDF is larger than 8MB — please upload a smaller copy.", "warn");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      // Read the page's rotation up front: the ER2 is usually a portrait page flagged to
      // display landscape, and knowing that is what keeps stamped values the right way up.
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(dataUrlToBytes(dataUrl));
      const page = doc.getPage(0);
      let fieldCount = 0;
      try {
        fieldCount = doc.getForm().getFields().length;
      } catch {
        // Template has no AcroForm — expected for a scanned or flattened ER2.
      }
      setTemplates([
        {
          id: TEMPLATE_ID,
          fileName: file.name,
          dataUrl,
          uploadedAt: todayISO(),
          pageRotation: ((page.getRotation().angle % 360) + 360) % 360,
          fieldCount,
        },
      ]);
      notify(`ER2 template "${file.name}" uploaded`, "created");
    } catch {
      notify("Could not read that PDF.", "warn");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** Builds the employee lines from the ER2 report rows inside the chosen coverage. */
  function entriesForCoverage(): ER2Entry[] {
    return er2Rows
      .filter((r) => inRange(r.dateCreated, coverageStart, coverageEnd))
      .map((r) => {
        const emp = employees.find(
          (e) => e.name.trim().toLowerCase() === r.employeeName.trim().toLowerCase()
        );
        return {
          id: uuid(),
          employeeId: emp?.id,
          philhealthNo: emp?.philhealthNo || "",
          name: r.employeeName,
          position: r.position || emp?.position || "",
          salary: emp?.basicSalary || "",
          dateOfEmployment: emp?.dateHired ? formatDate(emp.dateHired, "MMMM d, yyyy") : "",
          previousEmployer: "",
        };
      });
  }

  function createForm() {
    const entries = entriesForCoverage();
    const previous = forms[0];
    const form: ER2Form = {
      id: uuid(),
      title: `ER2 — ${formatDate(new Date(coverageStart).toISOString(), "MMMM d")}–${formatDate(
        new Date(coverageEnd).toISOString(),
        "MMMM d, yyyy"
      )}`,
      coverageStart,
      coverageEnd,
      // Employer details carry over from the last form so they're typed once.
      employer: previous ? { ...previous.employer } : emptyEmployer(),
      entries,
      pageNo: "",
      sheets: "",
      signature: previous?.signature || "",
      layout: previous?.layout ? cloneLayout(previous.layout) : undefined,
      updatedAt: todayISO(),
    };
    addForm(form);
    setOpenFormId(form.id);
    notify(
      entries.length > 0
        ? `ER2 form created with ${entries.length} employee${entries.length === 1 ? "" : "s"}`
        : "ER2 form created — no ER2 rows in that coverage, add lines manually",
      "created"
    );
  }

  if (!hydrated) return null;

  const openForm = forms.find((f) => f.id === openFormId);

  return (
    <Card>
      <h2 className="font-display text-lg text-ink">ER2 Form (PhilHealth template)</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Upload the blank ER2 PDF once, then fill it in here. Downloads are your uploaded sheet with the
        details drawn onto it, so the layout stays exactly as PhilHealth issued it.
      </p>

      {/* ---------------------------- Template ---------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files?.[0])}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : template ? "Replace template" : "Upload ER2 template (PDF)"}
        </Button>
        {template ? (
          <>
            <span className="text-sm text-ink">{template.fileName}</span>
            <span className="text-xs text-ink-muted">
              uploaded {formatDate(template.uploadedAt, "MMMM d, yyyy")}
              {template.pageRotation
                ? ` · page rotated ${template.pageRotation}° (handled automatically)`
                : ""}
              {template.fieldCount ? ` · ${template.fieldCount} fillable fields` : ""}
            </span>
            <button
              onClick={() => {
                setTemplates([]);
                notify("ER2 template removed", "deleted");
              }}
              className="ml-auto text-xs text-ink-muted hover:text-warn"
            >
              Remove
            </button>
          </>
        ) : (
          <span className="text-xs text-ink-muted">No template uploaded yet.</span>
        )}
      </div>

      {/* ---------------------------- New form ---------------------------- */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Coverage start
          <Input type="date" value={coverageStart} onChange={(e) => setCoverageStart(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Coverage end
          <Input type="date" value={coverageEnd} onChange={(e) => setCoverageEnd(e.target.value)} />
        </label>
        <Button onClick={createForm} disabled={!template}>
          + New ER2 form
        </Button>
        {!template && (
          <span className="text-xs text-ink-muted">Upload the template first.</span>
        )}
      </div>

      {forms.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {forms.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <button
                onClick={() => setOpenFormId(openFormId === f.id ? null : f.id)}
                className="text-left text-sm font-medium text-ink hover:text-accent"
              >
                {f.title}
              </button>
              <span className="text-xs text-ink-muted">
                {f.entries.length} employee{f.entries.length === 1 ? "" : "s"} ·{" "}
                {pageCount(f.entries.length, layoutOrDefault(f.layout))} sheet
                {pageCount(f.entries.length, layoutOrDefault(f.layout)) === 1 ? "" : "s"} · saved{" "}
                {formatDate(f.updatedAt, "MMMM d, yyyy")}
              </span>
              <div className="ml-auto flex gap-3">
                <button
                  onClick={() => setOpenFormId(openFormId === f.id ? null : f.id)}
                  className="text-xs text-accent hover:underline"
                >
                  {openFormId === f.id ? "Close" : "Edit"}
                </button>
                <button
                  onClick={() => {
                    removeForm(f.id);
                    if (openFormId === f.id) setOpenFormId(null);
                    notify(`ER2 form "${f.title}" deleted`, "deleted");
                  }}
                  className="text-xs text-ink-muted hover:text-warn"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openForm && template && (
        <ER2FormEditor
          key={openForm.id}
          form={openForm}
          template={template}
          onChange={(patch) => updateForm(openForm.id, { ...patch, updatedAt: todayISO() })}
          notify={notify}
        />
      )}
    </Card>
  );
}

/* ------------------------------ Form editor ------------------------------ */

/** The value that prints in each single-position field. */
function valueForField(form: ER2Form, key: ER2SingleField, sheets: number): string {
  switch (key) {
    case "firmName":
      return form.employer.firmName;
    case "employerNo":
      return form.employer.employerNo;
    case "address":
      return form.employer.address;
    case "email":
      return form.employer.email;
    case "initialBox":
      return form.employer.listType === "initial" ? "X" : "";
    case "subsequentBox":
      return form.employer.listType === "subsequent" ? "X" : "";
    case "totalListed":
      return String(form.entries.length);
    case "pageNo":
      return form.pageNo || "1";
    case "sheets":
      return form.sheets || String(sheets);
    case "signature":
      return form.signature;
  }
}

/** The parts of a form a user can edit, for comparing a draft against what's saved. */
function editableSnapshot(form: ER2Form): string {
  return JSON.stringify({
    title: form.title,
    employer: form.employer,
    entries: form.entries,
    pageNo: form.pageNo,
    sheets: form.sheets,
    signature: form.signature,
    layout: form.layout,
  });
}

function ER2FormEditor({
  form,
  template,
  onChange,
  notify,
}: {
  form: ER2Form;
  template: ER2Template;
  onChange: (patch: Partial<ER2Form>) => void;
  notify: (message: string, kind?: "created" | "updated" | "deleted" | "warn") => void;
}) {
  const [tab, setTab] = useState<"details" | "align">("details");
  const [downloading, setDownloading] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Edits are held locally and written once on Save. Typing straight through to the
  // store would mean a round trip per keystroke, and a drag would fire dozens.
  const [draft, setDraft] = useState<ER2Form>(form);
  // Compares the editable fields only — saving stamps a new updatedAt, which would
  // otherwise leave the form looking permanently unsaved.
  const dirty = editableSnapshot(draft) !== editableSnapshot(form);

  const layout = layoutOrDefault(draft.layout);
  const sheets = pageCount(draft.entries.length, layout);

  function save() {
    onChange({
      employer: draft.employer,
      entries: draft.entries,
      pageNo: draft.pageNo,
      sheets: draft.sheets,
      signature: draft.signature,
      layout: draft.layout,
      title: draft.title,
    });
    notify(`ER2 form "${draft.title}" saved`, "updated");
  }

  function setEmployer(patch: Partial<ER2Form["employer"]>) {
    setDraft((d) => ({ ...d, employer: { ...d.employer, ...patch } }));
  }

  function setEntry(id: string, patch: Partial<ER2Entry>) {
    setDraft((d) => ({
      ...d,
      entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }

  function addBlankEntry() {
    setDraft((d) => ({
      ...d,
      entries: [
        ...d.entries,
        {
          id: uuid(),
          philhealthNo: "",
          name: "",
          position: "",
          salary: "",
          dateOfEmployment: "",
          previousEmployer: "",
        },
      ],
    }));
  }

  function removeEntry(id: string) {
    setDraft((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
  }

  /** Drag a marker on the preview to move where that value prints. */
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.min(0.99, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.99, Math.max(0, (e.clientY - rect.top) / rect.height));
    const next = cloneLayout(layout);
    if (dragging.startsWith("col:")) {
      next.table.columns[dragging.slice(4) as keyof typeof next.table.columns] = x;
    } else if (dragging === "table:firstRow") {
      next.table.firstRowY = y;
    } else {
      next.fields[dragging as ER2SingleField] = { x, y };
    }
    setDraft((d) => ({ ...d, layout: next }));
  }

  function resetLayout() {
    setDraft((d) => ({ ...d, layout: cloneLayout(DEFAULT_ER2_LAYOUT) }));
    notify("Alignment reset to the default ER2 positions", "updated");
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      if (dirty) save();
      const bytes = await buildCompletedER2(draft, template.dataUrl);
      downloadPdf(bytes, draft.title);
      notify("Completed ER2 form downloaded", "created");
    } catch (e) {
      notify(
        e instanceof Error ? `Could not build the PDF: ${e.message}` : "Could not build the PDF.",
        "warn"
      );
    } finally {
      setDownloading(false);
    }
  }

  const previewValues = SINGLE_FIELDS.map((key) => ({
    key,
    label: ER2_FIELD_LABELS[key],
    value: valueForField(draft, key, sheets),
    x: layout.fields[key].x,
    y: layout.fields[key].y,
  }));

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant={tab === "details" ? "primary" : "ghost"} onClick={() => setTab("details")}>
          Form details
        </Button>
        <Button variant={tab === "align" ? "primary" : "ghost"} onClick={() => setTab("align")}>
          Preview &amp; alignment
        </Button>
        <span className="text-xs text-ink-muted">
          {draft.entries.length} listed · {sheets} sheet{sheets === 1 ? "" : "s"}
          {dirty ? " · unsaved changes" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant={dirty ? "primary" : "ghost"} onClick={save} disabled={!dirty}>
            {dirty ? "Save form" : "Saved"}
          </Button>
          <Button onClick={handleDownload} disabled={downloading}>
            {downloading ? "Preparing…" : "Download completed ER2"}
          </Button>
        </div>
      </div>

      {tab === "details" ? (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Name of Employer/Firm
              <Input
                value={draft.employer.firmName}
                onChange={(e) => setEmployer({ firmName: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Employer No.
              <Input
                value={draft.employer.employerNo}
                onChange={(e) => setEmployer({ employerNo: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Address
              <Input
                value={draft.employer.address}
                onChange={(e) => setEmployer({ address: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              E-mail Address
              <Input value={draft.employer.email} onChange={(e) => setEmployer({ email: e.target.value })} />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 text-[11px] text-ink-muted">
              List type
              <div className="flex gap-2">
                {(["initial", "subsequent"] as const).map((t) => (
                  <Button
                    key={t}
                    variant={draft.employer.listType === t ? "primary" : "ghost"}
                    onClick={() => setEmployer({ listType: t })}
                  >
                    {t === "initial" ? "Initial List" : "Subsequent List"}
                  </Button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Page No. (blank = auto)
              <Input value={draft.pageNo} onChange={(e) => setDraft((d) => ({ ...d, pageNo: e.target.value }))} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Of __ sheets (blank = auto)
              <Input value={draft.sheets} onChange={(e) => setDraft((d) => ({ ...d, sheets: e.target.value }))} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Signature over printed name
              <Input value={draft.signature} onChange={(e) => setDraft((d) => ({ ...d, signature: e.target.value }))} />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Total No. Listed: {draft.entries.length}</p>
            <Button variant="ghost" onClick={addBlankEntry}>
              + Add employee line
            </Button>
          </div>

          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                  {ER2_COLUMN_ORDER.map((col) => (
                    <th key={col} className="px-2 py-2">
                      {ER2_COLUMN_LABELS[col]}
                    </th>
                  ))}
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {draft.entries.map((entry, i) => (
                  <tr
                    key={entry.id}
                    className={`border-t border-border ${
                      i >= layout.table.maxRows ? "bg-background/50" : ""
                    }`}
                  >
                    {ER2_COLUMN_ORDER.map((col) => (
                      <td key={col} className="px-2 py-1.5">
                        <Input
                          value={entry[col]}
                          onChange={(e) => setEntry(entry.id, { [col]: e.target.value })}
                          className="min-w-[120px]"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => removeEntry(entry.id)}
                        className="text-xs text-ink-muted hover:text-warn"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draft.entries.length > layout.table.maxRows && (
            <p className="mt-2 text-xs text-ink-muted">
              Lines past {layout.table.maxRows} continue on sheet 2 of the download.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-ink-muted">
            Drag any marker onto the right cell of your template — the position is saved with this form
            and used for the download. Column markers set where that column&apos;s text starts; the row
            marker sets the first line of the table.
          </p>
          <div className="mb-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Row height (% of page)
              <Input
                type="number"
                step="0.05"
                value={(layout.table.rowHeight * 100).toFixed(2)}
                onChange={(e) => {
                  const next = cloneLayout(layout);
                  next.table.rowHeight = Math.max(0.005, Number(e.target.value) / 100);
                  setDraft((d) => ({ ...d, layout: next }));
                }}
                className="w-28"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Rows per sheet
              <Input
                type="number"
                value={layout.table.maxRows}
                onChange={(e) => {
                  const next = cloneLayout(layout);
                  next.table.maxRows = Math.max(1, Math.floor(Number(e.target.value) || 1));
                  setDraft((d) => ({ ...d, layout: next }));
                }}
                className="w-24"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Font size (pt)
              <Input
                type="number"
                value={layout.fontSize}
                onChange={(e) => {
                  const next = cloneLayout(layout);
                  next.fontSize = Math.max(4, Number(e.target.value) || 8);
                  setDraft((d) => ({ ...d, layout: next }));
                }}
                className="w-24"
              />
            </label>
            <Button variant="ghost" onClick={resetLayout}>
              Reset alignment
            </Button>
          </div>

          <div
            ref={previewRef}
            className="relative touch-none select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragging(null)}
            onPointerLeave={() => setDragging(null)}
          >
            <PdfPagePreview dataUrl={template.dataUrl} />

            {previewValues.map((v) => (
              <button
                key={v.key}
                title={`${v.label} — drag into place`}
                onPointerDown={() => setDragging(v.key)}
                style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%` }}
                className={`absolute -translate-y-1/2 cursor-move whitespace-nowrap rounded-sm border px-1 text-[10px] leading-tight ${
                  dragging === v.key
                    ? "border-accent bg-accent text-white"
                    : "border-accent/60 bg-surface/90 text-ink"
                }`}
              >
                {v.value || v.label}
              </button>
            ))}

            {ER2_COLUMN_ORDER.map((col) => (
              <button
                key={col}
                title={`${ER2_COLUMN_LABELS[col]} — drag to set this column`}
                onPointerDown={() => setDragging(`col:${col}`)}
                style={{
                  left: `${layout.table.columns[col] * 100}%`,
                  top: `${layout.table.firstRowY * 100}%`,
                }}
                className={`absolute -translate-y-1/2 cursor-move whitespace-nowrap rounded-sm border px-1 text-[10px] leading-tight ${
                  dragging === `col:${col}`
                    ? "border-accent bg-accent text-white"
                    : "border-ink-muted/60 bg-surface/90 text-ink-muted"
                }`}
              >
                {draft.entries[0]?.[col] || ER2_COLUMN_LABELS[col]}
              </button>
            ))}

            <button
              title="First table row — drag to set where the list starts"
              onPointerDown={() => setDragging("table:firstRow")}
              style={{ left: "0%", top: `${layout.table.firstRowY * 100}%` }}
              className={`absolute -translate-x-full -translate-y-1/2 cursor-ns-resize rounded-sm border px-1 text-[10px] ${
                dragging === "table:firstRow"
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface text-ink-muted"
              }`}
            >
              row 1
            </button>
          </div>
        </>
      )}
    </div>
  );
}
