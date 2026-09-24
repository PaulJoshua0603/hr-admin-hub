/**
 * Fills the 3rd Month Probationary Evaluation from the Word form HR already uses.
 *
 * The form is uploaded once and reused for everyone, and the only thing the system writes
 * into it is the employee's name on the "NAME:" line. Nothing else is touched — not the
 * questions, not the letterhead, not a single style — because the document that comes out
 * has to be the same one the managers are used to signing.
 */
import type { Employee } from "@/types";

export type ThirdMonthEvaluationResult = {
  blob: Blob;
  /** False when the template has no "NAME:" line, so the caller can say so rather than
   *  hand over a form with nobody's name on it and let it be filled in by hand. */
  named: boolean;
};

/** "3rd Month Evaluation - Hazel E. Bayani.docx" */
export function thirdMonthEvaluationFileName(fullName: string): string {
  const safe = (fullName || "Employee").replace(/[\\/:*?"<>|]/g, "").trim();
  return `3rd Month Evaluation - ${safe}.docx`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The name as a Word run: Calibri (Body) at 10 point, in capitals.
 *
 * The theme attributes rather than a plain font name are what make Word report the font as
 * "Calibri (Body)" — the same thing the rest of the form is set in — instead of a Calibri
 * that has been pinned by hand and would no longer follow the document's theme.
 */
function nameRun(text: string): string {
  return (
    `<w:r><w:rPr>` +
    `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" ` +
    `w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/>` +
    `<w:sz w:val="20"/><w:szCs w:val="20"/>` +
    `</w:rPr><w:t xml:space="preserve"> ${escapeXml(text.toUpperCase())}</w:t></w:r>`
  );
}

/** The words a paragraph shows, with the markup between them stripped out. */
function paragraphText(paragraph: string): string {
  // <w:t> or <w:t xml:space=…> only — the looser <w:t[^>]*> also takes <w:tab/> and the
  // <w:tabs> in paragraph properties, and reads markup as if it were words.
  return [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function buildThirdMonthEvaluationDocx(
  templateDataUrl: string,
  employee: Employee
): Promise<ThirdMonthEvaluationResult> {
  const source = dataUrlToBlob(templateDataUrl);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(source);
  const docPath = "word/document.xml";
  const file = zip.file(docPath);
  if (!file) return { blob: source, named: false };

  const xml = await file.async("text");
  let named = false;

  // The name goes at the end of the paragraph that opens with "NAME:", wherever Word has
  // split that label across runs — which it usually has, and which is why the label is
  // found by reading the paragraph rather than by matching the markup.
  const next = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (named) return paragraph;
    const text = paragraphText(paragraph).trim();
    if (!/^name\s*:/i.test(text)) return paragraph;
    // Already filled in — leave it rather than append a second name beside the first.
    if (text.replace(/^name\s*:/i, "").trim()) return paragraph;
    named = true;
    return paragraph.replace(/<\/w:p>$/, `${nameRun(employee.name || "")}</w:p>`);
  });

  if (!named) return { blob: source, named: false };

  zip.file(docPath, next);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return { blob, named: true };
}
