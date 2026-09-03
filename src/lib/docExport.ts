import { Employee, getLackingRequirements } from "@/types";
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

  const pre = employee.preEmploymentChecklist;
  const med = employee.medicalExamChecklist;
  const onboarding = employee.onboardingNextSteps;

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

  // Documents Required — mirrors EMPLOYEE 201 FILE CHECKLIST line items, sourced
  // from the app's pre-employment checklist (and Job Offer / Contract from
  // Onboarding Next Steps, which aren't tracked in preEmploymentChecklist).
  const documentsRequired: { label: string; checked: boolean }[] = [
    { label: "Employee Application Form (Original)", checked: !!pre?.applicationForm },
    { label: "Birth Certificate (2 Photocopies)", checked: !!pre?.birthMarriageCerts },
    { label: "Marriage Certificate (Photocopy, if applicable)", checked: !!pre?.birthMarriageCerts },
    { label: "Updated Resume (1 Copy)", checked: !!pre?.resume },
    { label: "Job Offer", checked: !!onboarding?.prepareJobOffer },
    { label: "Employment Contract", checked: !!onboarding?.employmentContract },
    { label: "Request for Company ID Form (Original)", checked: !!pre?.companyIdForm },
    { label: "PhilHealth Form (Original)", checked: !!pre?.philhealthForm },
    { label: "SSS ID / E-1 Form (Photocopy)", checked: !!pre?.govIds },
    { label: "TIN ID (Photocopy)", checked: !!pre?.govIds },
    { label: "PhilHealth ID / PMRF Form (Photocopy)", checked: !!pre?.govIds },
    { label: "Pag-IBIG / HDMF ID (Photocopy)", checked: !!pre?.govIds },
    { label: "Diploma (Photocopy)", checked: !!pre?.diploma },
    { label: "Certificate(s) of Employment (Photocopy)", checked: !!pre?.coe },
    { label: "BIR Form 2316 - Year 2026 (Photocopy / Follow-up if unavailable)", checked: !!pre?.bir2316 },
    { label: "NBI Clearance (Original)", checked: !!pre?.nbi },
    { label: "2 pcs. 2x2 Colored Pictures (White Background)", checked: !!pre?.photos },
    { label: "2 pcs. 1x1 Colored Pictures (White Background)", checked: !!pre?.photos },
  ];

  const medicalRequirements: { label: string; checked: boolean }[] = [
    { label: "Physical Examination", checked: !!med?.physicalExamination },
    { label: "Complete Blood Count (CBC)", checked: !!med?.cbc },
    { label: "Urinalysis", checked: !!med?.urinalysis },
    { label: "Fecalysis", checked: !!med?.fecalysis },
    { label: "Chest X-Ray", checked: !!med?.chestXray },
  ];

  const allDocsChecked = documentsRequired.every((d) => d.checked);
  const allMedChecked = medicalRequirements.every((d) => d.checked);
  const isComplete = allDocsChecked && allMedChecked;

  const remarksText = getLackingRequirements(employee).join("; ");

  // --- Left column: Employee info + Documents Required ---
  const leftColumn: InstanceType<typeof Paragraph>[] = [
    fieldLine("Employee Name", employee.name, true),
    fieldLine("Position", employee.position || "", true),
    fieldLine("Date Hired", employee.dateHired ? formatDate(employee.dateHired) : "", true),
    sectionHeading("DOCUMENTS REQUIRED", true),
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
    new Paragraph({ text: "", spacing: { before: 700 } }),
    new Paragraph({
      children: [new TextRun({ text: "Checked By: _______________________", size: BODY_SIZE, font: BODY_FONT })],
      spacing: { before: 300, after: 240 },
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
                height: { value: 14200, rule: HeightRule.ATLEAST },
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
  saveBlob(blob, `${employee.name} - Employee 201 File Checklist.docx`);
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
