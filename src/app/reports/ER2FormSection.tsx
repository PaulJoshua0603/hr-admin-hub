"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, CollapsibleSection, Input } from "@/components/ui";
import { PdfPagePreview } from "@/components/PdfPagePreview";
import { formatDate, todayISO } from "@/lib/dates";
import {
  ER2_COLUMN_LABELS,
  ER2_COLUMN_ORDER,
  ER2_FIELD_LABELS,
  DEFAULT_ER2_LAYOUT,
  cloneLayout,
  layoutOrDefault,
} from "@/lib/er2Layout";
import {
  buildCompletedER2,
  dataUrlToBytes,
  downloadPdf,
  listedCount,
  pageCount,
} from "@/lib/er2Pdf";
import { er2EntryFromEmployee, findEmployeeByName } from "@/lib/er2Fields";
import { EmployeeNameInput } from "@/components/EmployeeNameInput";
import { useNotifications } from "@/lib/notificationContext";
import type { ER2Entry, ER2Form, ER2SingleField, ER2Template, Employee } from "@/types";

const TEMPLATE_KEY = "hr_er2_template";
const FORMS_KEY = "hr_er2_forms";
const TEMPLATE_ID = "template";
const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;

const SINGLE_FIELDS: ER2SingleField[] = ["totalListed", "pageNo", "sheets"];

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
  const { items: employees } = useSupabaseStore<Employee>("hr_employees", []);
  const { notify } = useNotifications();

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [openFormId, setOpenFormId] = useState<string | null>(null);

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

  function createForm() {
    const previous = forms[0];
    const today = todayISO();
    const form: ER2Form = {
      id: uuid(),
      title: `ER2 Form — ${formatDate(today, "MMMM d, yyyy")}`,
      // Kept on the record but not shown: the Reports export uses these to decide which
      // saved forms fall inside the coverage being exported.
      coverageStart: today.slice(0, 10),
      coverageEnd: today.slice(0, 10),
      entries: [],
      pageNo: "1",
      sheets: "1",
      layout: previous?.layout ? cloneLayout(previous.layout) : undefined,
      updatedAt: todayISO(),
    };
    addForm(form);
    setOpenFormId(form.id);
    notify("ER2 form created — add employees with the name picker", "created");
  }

  if (!hydrated) return null;

  const openForm = forms.find((f) => f.id === openFormId);

  return (
    <CollapsibleSection title="ER2 Form (PhilHealth Template)" count={forms.length}>
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
      <div className="mt-3 flex flex-wrap items-center gap-3">
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
          employees={employees}
          onChange={(patch) => updateForm(openForm.id, { ...patch, updatedAt: todayISO() })}
          notify={notify}
        />
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------ Form editor ------------------------------ */

/** The value that prints in each single-position field. */
function valueForField(form: ER2Form, key: ER2SingleField, sheets: number): string {
  switch (key) {
    case "totalListed":
      return String(form.entries.length);
    case "pageNo":
      return form.pageNo || "1";
    case "sheets":
      return form.sheets || String(sheets);
  }
}

/** The parts of a form a user can edit, for comparing a draft against what's saved. */
function editableSnapshot(form: ER2Form): string {
  return JSON.stringify({
    title: form.title,
    entries: form.entries,
    pageNo: form.pageNo,
    sheets: form.sheets,
    layout: form.layout,
  });
}

function ER2FormEditor({
  form,
  template,
  employees,
  onChange,
  notify,
}: {
  form: ER2Form;
  template: ER2Template;
  employees: Employee[];
  onChange: (patch: Partial<ER2Form>) => void;
  notify: (message: string, kind?: "created" | "updated" | "deleted" | "warn") => void;
}) {
  const [tab, setTab] = useState<"details" | "align">("details");
  const [downloading, setDownloading] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  // Snapshot taken when a row enters edit mode, so Cancel can put it back.
  const [entryBeforeEdit, setEntryBeforeEdit] = useState<ER2Entry | null>(null);
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
      entries: draft.entries,
      pageNo: draft.pageNo,
      sheets: draft.sheets,
      layout: draft.layout,
      title: draft.title,
    });
    notify(`ER2 form "${draft.title}" saved`, "updated");
  }

  function setEntry(id: string, patch: Partial<ER2Entry>) {
    setDraft((d) => ({
      ...d,
      entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }

  function addBlankEntry() {
    const id = uuid();
    setDraft((d) => ({
      ...d,
      entries: [
        ...d.entries,
        {
          id,
          philhealthNo: "",
          name: "",
          position: "",
          salary: "",
          dateOfEmployment: "",
        },
      ],
    }));
    setEntryBeforeEdit(null);
    setEditingEntryId(id);
  }

  /** Copies an employee record onto a line, every field already formatted. */
  function applyEmployee(id: string, emp: Employee) {
    const filled = er2EntryFromEmployee(emp, id);
    setEntry(id, {
      employeeId: filled.employeeId,
      philhealthNo: filled.philhealthNo,
      name: filled.name,
      position: filled.position,
      salary: filled.salary,
      dateOfEmployment: filled.dateOfEmployment,
    });
  }

  /**
   * Typing a full name fills the rest of the line. The typed text is kept exactly as
   * entered — only the other four fields come from the record — so a middle name being
   * added by hand is never overwritten mid-keystroke.
   */
  function fillFromName(id: string, typed: string) {
    const name = typed.toUpperCase();
    const match = findEmployeeByName(employees, typed);
    if (!match) {
      setEntry(id, { name });
      return;
    }
    const filled = er2EntryFromEmployee(match, id);
    setEntry(id, {
      employeeId: filled.employeeId,
      name,
      philhealthNo: filled.philhealthNo,
      position: filled.position,
      salary: filled.salary,
      dateOfEmployment: filled.dateOfEmployment,
    });
  }

  function startEntryEdit(entry: ER2Entry) {
    setEntryBeforeEdit({ ...entry });
    setEditingEntryId(entry.id);
  }

  function cancelEntryEdit() {
    const restored = entryBeforeEdit;
    const cancelledId = editingEntryId;
    setDraft((d) => ({
      ...d,
      entries: restored
        ? d.entries.map((e) => (e.id === restored.id ? restored : e))
        : // No snapshot means the row was added in this sitting, so cancelling drops it
          // instead of leaving an empty line behind on the form.
          d.entries.filter((e) => e.id !== cancelledId),
    }));
    setEntryBeforeEdit(null);
    setEditingEntryId(null);
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
          {listedCount(draft)} listed · {sheets} sheet{sheets === 1 ? "" : "s"}
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
          <p className="text-xs text-ink-muted">
            The employer block, the list-type checkbox and the signature line are already printed on
            your uploaded template, so this form only fills what PhilHealth leaves blank.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px] text-ink-muted">
              Form name
              <Input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Page No.
              <Input value={draft.pageNo} onChange={(e) => setDraft((d) => ({ ...d, pageNo: e.target.value }))} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Of __ sheets
              <Input value={draft.sheets} onChange={(e) => setDraft((d) => ({ ...d, sheets: e.target.value }))} />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">
              Total No. Listed: {listedCount(draft)}
            </p>
            <Button variant="ghost" onClick={addBlankEntry}>
              + Add employee line
            </Button>
          </div>

          <p className="mb-2 text-xs text-ink-muted">
            Type a full name or pick one from the list — the PhilHealth number, position, salary and
            date of employment fill in from the employee record either way. Use Edit to change any
            cell, including adding a middle name that isn&apos;t on file yet (BAYANI, HAZEL → BAYANI,
            HAZEL ENTERIA); what you leave in the cell is what gets printed.
          </p>

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
                {draft.entries.map((entry, i) => {
                  const editing = editingEntryId === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      className={`border-t border-border ${
                        i >= layout.table.maxRows ? "bg-background/50" : ""
                      }`}
                    >
                      {ER2_COLUMN_ORDER.map((col) => {
                        if (!editing) {
                          return (
                            <td key={col} className="px-3 py-2 text-ink-muted">
                              {entry[col] || "—"}
                            </td>
                          );
                        }
                        if (col === "name") {
                          return (
                            <td key={col} className="px-2 py-1.5">
                              <EmployeeNameInput
                                value={entry.name}
                                placeholder="Type or pick a name"
                                onChange={(name) => fillFromName(entry.id, name)}
                                onSelect={(picked) => {
                                  const emp = employees.find((e) => e.id === picked.id);
                                  if (emp) applyEmployee(entry.id, emp);
                                  else setEntry(entry.id, { name: picked.name.toUpperCase() });
                                }}
                                className="min-w-[220px]"
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={col} className="px-2 py-1.5">
                            <Input
                              value={entry[col]}
                              onChange={(e) =>
                                setEntry(entry.id, { [col]: e.target.value.toUpperCase() })
                              }
                              className="min-w-[120px]"
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2">
                        {editing ? (
                          <div className="flex gap-3">
                            <button
                              onClick={() => setEditingEntryId(null)}
                              className="text-xs text-accent hover:underline"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEntryEdit}
                              className="text-xs text-ink-muted hover:text-ink"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <button
                              onClick={() => startEntryEdit(entry)}
                              className="text-xs text-accent hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeEntry(entry.id)}
                              className="text-xs text-ink-muted hover:text-warn"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
            and used for the download. The total and page-number markers are centred on where the
            number prints; column markers set where that column&apos;s text starts, and the row marker
            sets the first line of the table.
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
                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move whitespace-nowrap rounded-sm border px-1 text-[10px] leading-tight ${
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
