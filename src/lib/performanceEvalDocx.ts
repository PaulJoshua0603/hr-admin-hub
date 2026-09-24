/**
 * Fills the 6th Month Performance Evaluation from HR's own Word form, and hands it back
 * as Word — so whoever receives it can keep editing it, which a filled PDF never allowed.
 *
 * Only the header details are written in: Employee Name, Department, Current Position,
 * Date Employed, the two halves of Period Covered, and the name under "In consultation
 * with:" and "RATEE:". Each is found by its label, so the form can be restyled in Word
 * without anything here needing to change. Nothing else in the document is touched.
 */
import { PERF_EVAL_ANCHORS, type PerfEvalValues } from "./performanceEval";

export type PerfEvalDocxResult = {
  blob: Blob;
  /** Labels the template did not have, so the caller can say what still needs writing. */
  missing: string[];
};

/** "Hazel E. Bayani - Performance Evaluation.docx" */
export function performanceEvaluationDocxFileName(fullName: string): string {
  const safe = (fullName || "Employee").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${safe} - Performance Evaluation.docx`;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A value as a Word run, in the Arial 7 bold the filled header has always been printed in.
 * Word sizes go in half-points, so the 7.04 point the PDF used lands on 7.
 */
function valueRun(text: string): string {
  return (
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>` +
    `<w:b/><w:bCs/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  );
}

/** Every paragraph, self-closing ones included, with where it sits in the document. */
function paragraphs(xml: string): { start: number; end: number; xml: string }[] {
  const out: { start: number; end: number; xml: string }[] = [];
  const re = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, xml: m[0] });
  }
  return out;
}

/** The words a stretch of markup shows, with the markup stripped out. */
function textOf(xml: string): string {
  // <w:t> or <w:t xml:space=…> only — the looser <w:t[^>]*> also takes <w:tc>, <w:tcPr>,
  // <w:tab/> and <w:tabs>, and reads markup as if it were words.
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The table cell holding a position, if there is one. */
function cellAround(xml: string, at: number): { start: number; end: number } | null {
  const open = Math.max(xml.lastIndexOf("<w:tc>", at), xml.lastIndexOf("<w:tc ", at));
  if (open < 0) return null;
  const closeBefore = xml.lastIndexOf("</w:tc>", at);
  if (closeBefore > open) return null;
  const close = xml.indexOf("</w:tc>", at);
  return close < 0 ? null : { start: open, end: close + "</w:tc>".length };
}

/** The cell after this one on the same row, if the row has one. */
function nextCell(xml: string, cellEnd: number): { start: number; end: number } | null {
  const rowEnd = xml.indexOf("</w:tr>", cellEnd);
  const open = xml.indexOf("<w:tc", cellEnd);
  if (open < 0 || (rowEnd >= 0 && open > rowEnd)) return null;
  const close = xml.indexOf("</w:tc>", open);
  return close < 0 ? null : { start: open, end: close + "</w:tc>".length };
}

/** Puts a run at the end of a paragraph, opening it up first if it is self-closing. */
function appendToParagraph(paragraph: string, run: string): string {
  if (/\/>$/.test(paragraph)) return paragraph.replace(/\/>$/, `>${run}</w:p>`);
  return paragraph.replace(/<\/w:p>$/, `${run}</w:p>`);
}

/** An existing paragraph, made centred — keeping whatever other formatting it has. */
function centred(paragraph: string): string {
  if (/\/>$/.test(paragraph)) {
    return paragraph.replace(/\/>$/, `><w:pPr><w:jc w:val="center"/></w:pPr></w:p>`);
  }
  if (/<w:jc\b[^>]*\/>/.test(paragraph)) {
    return paragraph.replace(/<w:jc\b[^>]*\/>/, `<w:jc w:val="center"/>`);
  }
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(paragraph);
  if (pPr) {
    // Word rejects paragraph properties out of schema order, and <w:jc> comes after
    // spacing and indents but before these — so it goes in front of the first of them.
    const inner = pPr[1];
    const later = /<w:(textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/.exec(inner);
    const at = later ? later.index : inner.length;
    const next = `${inner.slice(0, at)}<w:jc w:val="center"/>${inner.slice(at)}`;
    return paragraph.replace(pPr[0], `<w:pPr>${next}</w:pPr>`);
  }
  return paragraph.replace(/^(<w:p\b[^>]*>)/, `$1<w:pPr><w:jc w:val="center"/></w:pPr>`);
}

/** A new paragraph holding just the value, centred, as a name under a signature line is. */
function centredParagraph(run: string): string {
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run}</w:p>`;
}

export async function buildPerformanceEvaluationDocx(
  templateDataUrl: string,
  values: PerfEvalValues
): Promise<PerfEvalDocxResult> {
  const base64 = templateDataUrl.slice(templateDataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("That file is not a Word document.");
  let xml = await file.async("text");

  const missing: string[] = [];
  // Labels used so far, so a label that appears twice fills its rows in order rather than
  // writing the first row twice.
  const used = new Set<number>();

  for (const anchor of PERF_EVAL_ANCHORS) {
    const value = (values[anchor.field] || "").trim();
    if (!value) continue;
    const label = squash(anchor.label);

    // Re-read every time: each fill shifts the positions of everything after it.
    const paras = paragraphs(xml);
    const index = paras.findIndex((p, i) => {
      if (used.has(i)) return false;
      const text = squash(textOf(p.xml));
      // The label on its own, or followed by nothing but a line to write on.
      return text === label || (text.startsWith(label) && /^[_\s.]*$/.test(text.slice(label.length)));
    });
    if (index < 0) {
      missing.push(anchor.label.replace(/:$/, ""));
      continue;
    }
    used.add(index);
    const para = paras[index];
    const run = valueRun(value);

    if (anchor.place === "beside") {
      // A form table puts the answer in the cell to the right of its label. Use that cell
      // when it is empty; otherwise write the value straight after the label.
      const cell = cellAround(xml, para.start);
      const next = cell && squash(textOf(xml.slice(cell.start, cell.end))) === label
        ? nextCell(xml, cell.end)
        : null;
      if (next && !squash(textOf(xml.slice(next.start, next.end)))) {
        const target = paragraphs(xml.slice(next.start, next.end))[0];
        if (target) {
          const at = next.start + target.start;
          xml = xml.slice(0, at) + appendToParagraph(target.xml, run) + xml.slice(at + target.xml.length);
          continue;
        }
      }
      // Any line drawn for writing on is cleared, so the value does not sit after it.
      const cleared = para.xml.replace(/(<w:t(?:\s[^>]*)?>)([_\s]+)(<\/w:t>)/g, "$1$3");
      const withValue = appendToParagraph(cleared, valueRun(` ${value}`));
      xml = xml.slice(0, para.start) + withValue + xml.slice(para.end);
      continue;
    }

    // "Below": the name goes under its label. An empty paragraph already there — the space
    // the form leaves for it — is used; otherwise one is added.
    const after = paras[index + 1];
    const cell = cellAround(xml, para.start);
    const afterInSameCell =
      after && (!cell || (after.start > para.end && after.end <= cell.end));
    if (after && afterInSameCell && !squash(textOf(after.xml))) {
      xml = xml.slice(0, after.start) + appendToParagraph(centred(after.xml), run) + xml.slice(after.end);
    } else {
      xml = xml.slice(0, para.end) + centredParagraph(run) + xml.slice(para.end);
    }
  }

  zip.file("word/document.xml", xml);
  const blob = await zip.generateAsync({ type: "blob", mimeType: DOCX_MIME });
  return { blob, missing };
}
