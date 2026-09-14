import type { ER2Column, ER2Layout, ER2SingleField } from "@/types";

export const ER2_FIELD_LABELS: Record<ER2SingleField, string> = {
  totalListed: "Total No. Listed Above",
  pageNo: "Page No.",
  sheets: "Of __ Sheets",
};

export const ER2_COLUMN_LABELS: Record<ER2Column, string> = {
  philhealthNo: "PhilHealth SSS/GSIS Number",
  name: "Name of Employee",
  position: "Position",
  salary: "Salary",
  dateOfEmployment: "Date of Employment",
};

/**
 * Where the last fillable column ends — the "(DO NOT FILL) EFF. DATE OF COVERAGE"
 * column begins here, so Date of Employment must not run past it.
 */
export const ER2_LAST_COLUMN_RIGHT = 0.692;

export const ER2_COLUMN_ORDER: ER2Column[] = [
  "philhealthNo",
  "name",
  "position",
  "salary",
  "dateOfEmployment",
];

/**
 * Where each value goes on a blank ER2 sheet, as a fraction of page width/height with
 * (0,0) at the top-left corner.
 *
 * Starting positions for the standard PhilHealth ER2 layout. Scans and re-exports of
 * the form differ slightly, so the editor draws these boxes over the uploaded template
 * and lets them be dragged; the adjusted values are saved with the form and used when
 * stamping the download.
 */
export const DEFAULT_ER2_LAYOUT: ER2Layout = {
  fields: {
    // These three are drawn centred on their anchor, so each x is the MIDDLE of the space
    // the number occupies, not its left edge: the total is centred in the "TOTAL NO.
    // LISTED ABOVE" cell, and the page and sheet numbers are centred on the two blanks of
    // "PAGE __ OF __ SHEETS" so neither one crowds the words either side of it.
    totalListed: { x: 0.235, y: 0.92 },
    pageNo: { x: 0.531, y: 0.942 },
    sheets: { x: 0.57, y: 0.942 },
  },
  table: {
    firstRowY: 0.322,
    // Rows are given room to breathe: a value that wraps onto a second line still clears
    // the entry below it. Taller rows mean fewer per sheet, and the list continues on
    // another copy of the template when it runs out.
    rowHeight: 0.052,
    maxRows: 11,
    // Each value starts just inside its column rule, the same way the employer
    // details sit a little after their labels on the printed template.
    columns: {
      philhealthNo: 0.028,
      name: 0.158,
      position: 0.391,
      salary: 0.534,
      dateOfEmployment: 0.619,
    },
  },
  // Arial 10 as requested. Helvetica is the PDF standard font Arial maps to — same
  // metrics, so spacing matches what Word/Excel would print.
  fontSize: 10,
};

/** Deep copy so an edited calibration never mutates the shared default. */
export function cloneLayout(layout: ER2Layout): ER2Layout {
  return {
    fontSize: layout.fontSize,
    fields: { ...layout.fields },
    table: { ...layout.table, columns: { ...layout.table.columns } },
  };
}

/** Falls back to the default, filling any gaps in a form saved before a field existed. */
export function layoutOrDefault(layout?: ER2Layout): ER2Layout {
  if (!layout) return cloneLayout(DEFAULT_ER2_LAYOUT);
  return {
    fontSize: layout.fontSize || DEFAULT_ER2_LAYOUT.fontSize,
    fields: { ...DEFAULT_ER2_LAYOUT.fields, ...layout.fields },
    table: {
      ...DEFAULT_ER2_LAYOUT.table,
      ...layout.table,
      columns: { ...DEFAULT_ER2_LAYOUT.table.columns, ...layout.table?.columns },
    },
  };
}
