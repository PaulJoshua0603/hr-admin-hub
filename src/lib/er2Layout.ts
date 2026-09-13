import type { ER2Column, ER2Layout, ER2SingleField } from "@/types";

export const ER2_FIELD_LABELS: Record<ER2SingleField, string> = {
  firmName: "Name of Employer/Firm",
  employerNo: "Employer No.",
  address: "Address",
  email: "E-mail Address",
  initialBox: "Initial List checkbox",
  subsequentBox: "Subsequent List checkbox",
  totalListed: "Total No. Listed Above",
  pageNo: "Page No.",
  sheets: "Of __ Sheets",
  signature: "Signature over printed name",
};

export const ER2_COLUMN_LABELS: Record<ER2Column, string> = {
  philhealthNo: "PhilHealth SSS/GSIS Number",
  name: "Name of Employee",
  position: "Position",
  salary: "Salary",
  dateOfEmployment: "Date of Employment",
  previousEmployer: "Previous Employer",
};

export const ER2_COLUMN_ORDER: ER2Column[] = [
  "philhealthNo",
  "name",
  "position",
  "salary",
  "dateOfEmployment",
  "previousEmployer",
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
    firmName: { x: 0.17, y: 0.183 },
    employerNo: { x: 0.78, y: 0.196 },
    address: { x: 0.1, y: 0.216 },
    email: { x: 0.68, y: 0.216 },
    initialBox: { x: 0.437, y: 0.116 },
    subsequentBox: { x: 0.437, y: 0.134 },
    totalListed: { x: 0.3, y: 0.937 },
    pageNo: { x: 0.523, y: 0.959 },
    sheets: { x: 0.575, y: 0.959 },
    signature: { x: 0.8, y: 0.944 },
  },
  table: {
    firstRowY: 0.322,
    rowHeight: 0.0305,
    maxRows: 20,
    columns: {
      philhealthNo: 0.03,
      name: 0.148,
      position: 0.379,
      salary: 0.517,
      dateOfEmployment: 0.588,
      previousEmployer: 0.773,
    },
  },
  fontSize: 8,
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
