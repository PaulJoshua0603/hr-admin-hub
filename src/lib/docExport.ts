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
import { supabase, supabaseReady } from "./supabaseClient";

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

  const fieldLine = (label: string, value: string, underline = false, before = 0) =>
    new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, bold: true, size: BODY_SIZE, font: BODY_FONT }),
        new TextRun({ text: value || "________________________", size: BODY_SIZE, font: BODY_FONT }),
      ],
      spacing: { before, after: underline ? 220 : 160 },
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
    fieldLine("Date Hired", employee.dateHired ? formatDate(employee.dateHired, "MMMM d, yyyy") : "", true),
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
    fieldLine("Remarks", ""),
    fieldLine("Realcognita email issued", employee.realcognitaEmail || "", false, 520),
    fieldLine("Biometrics number", employee.biometricsNo || "", false, 400),
    fieldLine("ID number", employee.companyIdNumber || "", false, 400),
    new Paragraph({
      children: [new TextRun({ text: "Checked By: _______________________", size: BODY_SIZE, font: BODY_FONT })],
      spacing: { before: 700, after: 320 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Date Checked: _______________________", size: BODY_SIZE, font: BODY_FONT })],
      spacing: { before: 300 },
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
                height: { value: 13400, rule: HeightRule.ATLEAST },
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace every exact <w:t>EXACT</w:t> node's text with `replacement`. */
function replaceExactRunTextAll(xml: string, exact: string, replacement: string): string {
  const re = new RegExp(`(<w:t[^>]*>)${escapeRegExp(exact)}(</w:t>)`, "g");
  return xml.replace(re, (_m, open, close) => `${open}${escapeXml(replacement)}${close}`);
}

/** Replace each exact <w:t>EXACT</w:t> node's text in document order with the next value from `replacements`. */
function replaceExactRunTextSequential(xml: string, exact: string, replacements: string[]): string {
  const re = new RegExp(`(<w:t[^>]*>)${escapeRegExp(exact)}(</w:t>)`, "g");
  let i = 0;
  return xml.replace(re, (_m, open, close) => {
    const val = i < replacements.length ? replacements[i] : exact;
    i++;
    return `${open}${escapeXml(val)}${close}`;
  });
}

/** Replace everything from the first occurrence of `startAnchor` through the
 * next occurrence of `endAnchor` (inclusive of both) with `replacement`. */
function replaceSpan(xml: string, startAnchor: string, endAnchor: string, replacement: string): string {
  const startIdx = xml.indexOf(startAnchor);
  if (startIdx === -1) return xml;
  const endIdx = xml.indexOf(endAnchor, startIdx);
  if (endIdx === -1) return xml;
  const endOfSpan = endIdx + endAnchor.length;
  return xml.slice(0, startIdx) + replacement + xml.slice(endOfSpan);
}

/** Parse a "6:30am – 3:00pm" style shift string into ["6:30 a.m.", "3:00 p.m."]. */
function parseWorkingHours(shift?: string): [string, string] {
  if (!shift) return ["", ""];
  const parts = shift.split(/[–\-]/).map((s) => s.trim());
  const toFormal = (t: string) => {
    const m = t.match(/(\d{1,2}:\d{2})\s*([ap])\.?m\.?/i);
    if (!m) return t;
    return `${m[1]} ${m[2].toLowerCase()}.m.`;
  };
  return [toFormal(parts[0] || ""), toFormal(parts[1] || "")];
}

export async function exportContractOfEmploymentDocx(employee: Employee) {
  let blob: Blob;
  if (supabaseReady) {
    const { data } = await supabase.storage
      .from("files")
      .download("templates/contract-of-employment.docx");
    blob = data || (await fetch("/templates/contract-of-employment.docx").then((r) => r.blob()));
  } else {
    blob = await fetch("/templates/contract-of-employment.docx").then((r) => r.blob());
  }

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(blob);
  const docPath = "word/document.xml";
  const file = zip.file(docPath);
  if (!file) {
    saveBlob(blob, `${employee.name} Contract of Employment.docx`);
    return;
  }

  let xml = await file.async("text");

  const issueDate = employee.dateHired
    ? formatDate(employee.dateHired, "MMMM d, yyyy")
    : formatDate(todayISOString(), "MMMM d, yyyy");
  const hireDate = employee.dateHired ? formatDate(employee.dateHired, "MMMM d, yyyy") : "";

  // "Employee " immediately preceding "Fullname"/"Position" — drop the
  // literal "Employee " prefix so the placeholder reads as the real value.
  xml = replaceExactRunTextAll(xml, "Employee ", "");
  xml = replaceExactRunTextAll(xml, "Fullname", employee.name || "");
  xml = replaceExactRunTextAll(xml, "Position", employee.position || "");
  // Merged single-run placeholders.
  xml = replaceExactRunTextAll(xml, "Employee Position", employee.position || "");
  xml = replaceExactRunTextAll(xml, "Employee Name", employee.name || "");
  xml = replaceExactRunTextAll(xml, "Employee Address", employee.homeAddress || "");
  xml = replaceExactRunTextAll(xml, "Employee City", employee.homeCity || "");
  // Two "Month Day, Year" placeholders in document order: contract issue
  // date first, then the employment commencement (hire) date.
  xml = replaceExactRunTextSequential(xml, "Month Day, Year", [issueDate, hireDate]);

  // Compensation table amounts — "Basic Salary" row then "Total Monthly
  // Gross Compensation Income" row, each holding an identical "00,000.00"
  // placeholder run in that document order.
  const basicSalaryText = employee.basicSalary || "0.00";
  const totalGrossText = employee.totalMonthlyGrossCompensation || "0.00";
  xml = replaceExactRunTextSequential(xml, "00,000.00", [basicSalaryText, totalGrossText]);

  // 13th Month Pay clause references the total gross compensation, but its
  // amount run is fragmented into "₱" + "00" + ",000.00 " runs — collapse
  // that whole span into one clean run with the actual figure.
  xml = replaceSpan(
    xml,
    "<w:t>₱</w:t></w:r>",
    ",000.00 </w:t></w:r>",
    `<w:t>₱</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Garamond" w:eastAsia="Garamond" w:hAnsi="Garamond" w:cs="Garamond"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      totalGrossText
    )} </w:t></w:r>`
  );


  // Hours of Work — the "0:000 a.m. to 0:00 p.m" placeholder is fragmented
  // into a dozen single-character runs; collapse it into one clean run.
  const [workStart, workEnd] = parseWorkingHours(employee.workingHours);
  xml = replaceSpan(
    xml,
    `<w:t xml:space="preserve">Monday to Friday, </w:t></w:r>`,
    `<w:t>p.m</w:t></w:r><w:proofErr w:type="spellEnd"/>`,
    `<w:t xml:space="preserve">Monday to Friday, </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Garamond" w:eastAsia="Garamond" w:hAnsi="Garamond" w:cs="Garamond"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      workStart
    )} to ${escapeXml(workEnd)}</w:t></w:r>`
  );

  zip.file(docPath, xml);
  const outBlob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  saveBlob(outBlob, `${employee.name} Contract of Employment.docx`);
}

function todayISOString(): string {
  return new Date().toISOString();
}

export async function uploadContractTemplate(file: File) {
  if (!supabaseReady) return { error: "Connect Supabase to host a custom template." };
  const { error } = await supabase.storage
    .from("files")
    .upload("templates/contract-of-employment.docx", file, { upsert: true });
  return { error: error?.message || null };
}

export async function exportEndorsementLetterDocx(employee: Employee) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, TextWrappingType } = await import("docx");

  const FONT = "Arial";
  const SIZE = 20; // 10pt, matches the source template
  const dateText = employee.dateHired ? formatDate(employee.dateHired, "MMMM d, yyyy") : "";

  const bold = (text: string, extra: Partial<{ size: number }> = {}) =>
    new TextRun({ text, bold: true, font: FONT, size: extra.size || SIZE });
  const plain = (text: string) => new TextRun({ text, font: FONT, size: SIZE });

  const letterheadBuffer = await fetch("/letterhead-realcognita.png").then((r) => r.arrayBuffer());
  const letterheadImage = new ImageRun({
    type: "png",
    data: letterheadBuffer,
    transformation: { width: 816, height: 1056 },
    floating: {
      horizontalPosition: { relative: "page", offset: 0 },
      verticalPosition: { relative: "page", offset: 0 },
      behindDocument: true,
      wrap: { type: TextWrappingType.NONE },
      allowOverlap: true,
    },
  });

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "endorsement-list",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 540, hanging: 300 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 3300, right: 1080, bottom: 1440, left: 1080 } },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 320 },
            children: [letterheadImage, bold("ENDORSEMENT LETTER", { size: 24 })],
          }),
          new Paragraph({
            children: [bold(`Date: ${dateText}`)],
            spacing: { after: 260 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [bold("OPENING OF PAYROLL ACCOUNTS FOR EMPLOYEES OF")],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [bold("Realcognita Inc. ")],
            spacing: { after: 120 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              bold("___________________________________________________________________"),
            ],
            spacing: { after: 320 },
          }),
          new Paragraph({
            children: [plain("Dear Branch Manager Mr. Paul D. Joseph")],
            spacing: { after: 240 },
          }),
          new Paragraph({
            children: [
              plain("Please be advised that "),
              bold("Realcognita Inc."),
              plain(" has an existing payroll arrangement with BDO "),
              bold("University Parkway"),
              plain(" branch."),
            ],
            spacing: { after: 240 },
          }),
          new Paragraph({
            children: [
              plain("In view thereof, kindly assist the bearer of this letter as an employee of "),
              bold("Realcognita Inc."),
              plain(" who shall open a payroll account with your branch."),
            ],
            spacing: { after: 280 },
          }),
          new Paragraph({
            children: [plain("EMPLOYEE\u2019S NAME:\t"), plain(employee.name || "")],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [plain("EMPLOYEE NUMBER:\t"), plain(employee.companyIdNumber || "")],
            spacing: { after: 280 },
          }),
          new Paragraph({
            children: [
              bold("Realcognita Inc."),
              plain(" employee should present the following along with this endorsement letter:"),
            ],
            spacing: { after: 140 },
          }),
          new Paragraph({
            numbering: { reference: "endorsement-list", level: 0 },
            children: [plain("Valid ID (follow existing policy)")],
            spacing: { after: 260 },
          }),
          new Paragraph({
            children: [
              plain(
                "Kindly ensure that the above-mentioned account opening requirement is submitted.  For any inquiries/clarifications, you may call Branch Head/Marketing Officer of "
              ),
              bold("University Parkway"),
              plain(" branch at tel no. "),
              bold("(02) 403-8158."),
            ],
            spacing: { after: 280 },
          }),
          new Paragraph({
            children: [plain("Thank you very much.")],
            spacing: { after: 700 },
          }),
          new Paragraph({
            children: [plain("_________________________________________")],
            spacing: { after: 60 },
          }),
          new Paragraph({ children: [bold("Joanne D. Ortuoste")], spacing: { after: 40 } }),
          new Paragraph({ children: [bold("VP \u2013 Finance & Administration")], spacing: { after: 40 } }),
          new Paragraph({ children: [bold("Realcognita Inc.")] }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveBlob(blob, `${employee.name} Endorsement Letter.docx`);
}
