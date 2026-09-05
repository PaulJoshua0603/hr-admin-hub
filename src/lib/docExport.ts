import {
  Employee,
  getLackingRequirements,
  PRE_EMPLOYMENT_CHECKLIST_LABELS,
  MEDICAL_EXAM_CHECKLIST_LABELS,
  emptyPreEmploymentChecklist,
  emptyMedicalExamChecklist,
  type PreEmploymentChecklistKey,
  type MedicalExamChecklistKey,
} from "@/types";
import { formatDate } from "./dates";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportRequirementsListDocx(employee: Employee) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    Table,
    TableRow,
    TableCell,
    WidthType,
    HeightRule,
    VerticalAlign,
  } = await import("docx");

  const pre = employee.preEmploymentChecklist || emptyPreEmploymentChecklist();
  const med = employee.medicalExamChecklist || emptyMedicalExamChecklist();

  const BODY_FONT = "Aptos";
  const BODY_SIZE = 22; // 11pt — sized to fill the page comfortably
  const ACCENT = "0E5E56";

  const checklistParagraph = (label: string, checked: boolean) =>
    new Paragraph({
      children: [
        new TextRun({ text: checked ? "☑ " : "☐ ", size: BODY_SIZE, font: BODY_FONT }),
        new TextRun({ text: label, size: BODY_SIZE, font: BODY_FONT }),
      ],
      spacing: { after: 190, line: 300 },
    });

  const fieldLine = (label: string, value: string, underline = false) =>
    new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, bold: true, size: BODY_SIZE, font: BODY_FONT }),
        new TextRun({ text: value || "________________________", size: BODY_SIZE, font: BODY_FONT }),
      ],
      spacing: { after: underline ? 220 : 160 },
      border: underline
        ? {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 4,
              space: 6,
              color: "999999",
            },
          }
        : undefined,
    });

  const sectionHeading = (text: string, checkPrefix = false) =>
    new Paragraph({
      children: [
        ...(checkPrefix
          ? [new TextRun({ text: "✓ ", bold: true, size: 24, font: BODY_FONT, color: ACCENT })]
          : []),
        new TextRun({ text, bold: true, size: 24, font: BODY_FONT, color: "000000" }),
      ],
      spacing: { before: 320, after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, space: 6, color: "CCCCCC" },
      },
    });

  // Pre-Employment Requirements — combined documents + medical exam checklist,
  // sourced directly from the app's checklist definitions and data.
  const documentsRequired: { label: string; checked: boolean }[] = (
    Object.keys(PRE_EMPLOYMENT_CHECKLIST_LABELS) as PreEmploymentChecklistKey[]
  ).map((key) => ({
    label: PRE_EMPLOYMENT_CHECKLIST_LABELS[key],
    checked: !!pre[key],
  }));

  const medicalRequirements: { label: string; checked: boolean }[] = (
    Object.keys(MEDICAL_EXAM_CHECKLIST_LABELS) as MedicalExamChecklistKey[]
  ).map((key) => ({
    label: MEDICAL_EXAM_CHECKLIST_LABELS[key],
    checked: !!med[key],
  }));

  const allDocsChecked = documentsRequired.every((d) => d.checked);
  const allMedChecked = medicalRequirements.every((d) => d.checked);
  const isComplete = allDocsChecked && allMedChecked;

  const remarksText = getLackingRequirements(employee).join("; ");

  // --- Left column: Employee info + Documents Required ---
  const leftColumn: InstanceType<typeof Paragraph>[] = [
    fieldLine("Employee Name", employee.name, true),
    fieldLine("Position", employee.position || "", true),
    fieldLine("Date Hired", employee.dateHired ? formatDate(employee.dateHired) : "", true),
    sectionHeading("PRE-EMPLOYMENT REQUIREMENTS", true),
    ...documentsRequired.map((d) => checklistParagraph(d.label, d.checked)),
  ];

  // --- Right column: Medical exam + Completion status ---
  const rightColumn: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: "PRE-EMPLOYMENT MEDICAL EXAM (Original Copies)",
          bold: true,
          size: 24,
          font: BODY_FONT,
        }),
      ],
      spacing: { after: 200 },
    }),
    sectionHeading("MEDICAL REQUIREMENTS", true),
    ...medicalRequirements.map((d) => checklistParagraph(d.label, d.checked)),
    sectionHeading("COMPLETION STATUS"),
    checklistParagraph("Complete Requirements", isComplete),
    checklistParagraph("Incomplete Requirements", !isComplete),
    fieldLine("Remarks", remarksText),
    fieldLine("Realcognita email issued", employee.realcognitaEmail || ""),
    fieldLine("Biometrics number", employee.biometricsNo || ""),
    fieldLine("ID number", employee.companyIdNumber || ""),
    new Paragraph({
      children: [new TextRun({ text: "Checked By: _______________________", size: BODY_SIZE, font: BODY_FONT })],
      spacing: { before: 360, after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Date Checked: _______________________", size: BODY_SIZE, font: BODY_FONT })],
      spacing: { before: 100 },
    }),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE },
        },
        heading1: {
          run: { font: BODY_FONT, size: 32, bold: true, color: "000000" },
          paragraph: { spacing: { after: 320 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 in twips
            margin: { top: 560, right: 560, bottom: 560, left: 560 },
          },
        },
        children: [
          new Paragraph({
            text: "EMPLOYEE 201 FILE CHECKLIST",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 320 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 10, space: 10, color: ACCENT },
            },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
              left: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
              right: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
              insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            rows: [
              new TableRow({
                cantSplit: true,
                height: { value: 12600, rule: HeightRule.ATLEAST },
                children: [
                  new TableCell({
                    width: { size: 52, type: WidthType.PERCENTAGE },
                    margins: { top: 200, right: 300, bottom: 200, left: 300 },
                    verticalAlign: VerticalAlign.TOP,
                    children: leftColumn,
                  }),
                  new TableCell({
                    width: { size: 48, type: WidthType.PERCENTAGE },
                    margins: { top: 200, right: 300, bottom: 200, left: 300 },
                    verticalAlign: VerticalAlign.TOP,
                    borders: {
                      left: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD" },
                    },
                    children: rightColumn,
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveBlob(blob, `${employee.name} 201 Checklist.docx`);
}

export async function exportFolderNameDocx(employee: Employee) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import("docx");

  const nameCaps = employee.name.toUpperCase();

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 3600 },
            children: [
              new TextRun({
                text: nameCaps,
                bold: true,
                size: 96,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveBlob(blob, `${nameCaps} - Folder Name.docx`);
}
