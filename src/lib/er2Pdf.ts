import type { ER2Form, ER2Layout } from "@/types";
import { ER2_COLUMN_ORDER, layoutOrDefault } from "@/lib/er2Layout";

/** Rows one ER2 sheet holds before the list continues on another sheet. */
export function pageCount(entryCount: number, layout: ER2Layout): number {
  return Math.max(1, Math.ceil(entryCount / Math.max(1, layout.table.maxRows)));
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Stamps the form's values onto the uploaded blank template and returns the completed
 * PDF. The template's own pages are kept untouched underneath, so the download is the
 * original sheet with the data drawn into its cells. When there are more employees than
 * one sheet holds, the template page is copied for each extra sheet.
 */
export async function buildCompletedER2(form: ER2Form, templateDataUrl: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, degrees, rgb } = await import("pdf-lib");

  const template = await PDFDocument.load(dataUrlToBytes(templateDataUrl));
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  const layout = layoutOrDefault(form.layout);
  const rowsPerSheet = Math.max(1, layout.table.maxRows);
  const sheets = pageCount(form.entries.length, layout);

  for (let sheet = 0; sheet < sheets; sheet++) {
    // Every sheet reuses the template's first page, so each one is a real ER2 form.
    const [page] = await out.copyPages(template, [0]);
    out.addPage(page);

    const { width, height } = page.getSize();
    const size = layout.fontSize;

    // The ER2 is often a portrait page carrying /Rotate 90, so what the viewer shows
    // (and what the preview calibrates against) is not the page's own coordinate space.
    // Positions are stored as fractions of the *displayed* page, so map them back through
    // the rotation and turn the text to match, or every value lands sideways in the
    // wrong cell.
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const sideways = angle === 90 || angle === 270;
    const displayWidth = sideways ? height : width;
    const displayHeight = sideways ? width : height;

    /** Fraction of the displayed page (top-left origin) -> PDF point (bottom-left origin). */
    const toPdfPoint = (xf: number, yf: number) => {
      const px = xf * displayWidth;
      const py = yf * displayHeight;
      switch (angle) {
        case 90:
          return { x: py, y: px };
        case 180:
          return { x: width - px, y: py };
        case 270:
          return { x: width - py, y: height - px };
        default:
          return { x: px, y: height - py };
      }
    };

    const draw = (text: string, xf: number, yf: number, useBold = false) => {
      if (!text) return;
      const { x, y } = toPdfPoint(xf, yf);
      page.drawText(text, {
        x,
        y,
        size,
        font: useBold ? bold : font,
        color: rgb(0, 0, 0),
        rotate: degrees(angle),
      });
    };

    const f = layout.fields;
    draw(form.employer.firmName, f.firmName.x, f.firmName.y);
    draw(form.employer.employerNo, f.employerNo.x, f.employerNo.y);
    draw(form.employer.address, f.address.x, f.address.y);
    draw(form.employer.email, f.email.x, f.email.y);

    const box = form.employer.listType === "initial" ? f.initialBox : f.subsequentBox;
    draw("X", box.x, box.y, true);

    const entries = form.entries.slice(sheet * rowsPerSheet, (sheet + 1) * rowsPerSheet);
    entries.forEach((entry, i) => {
      const y = layout.table.firstRowY + i * layout.table.rowHeight;
      ER2_COLUMN_ORDER.forEach((col) => {
        draw(entry[col] || "", layout.table.columns[col], y);
      });
    });

    // The printed total counts everyone on the report, not just this sheet.
    draw(String(form.entries.length), f.totalListed.x, f.totalListed.y, true);
    draw(form.pageNo || String(sheet + 1), f.pageNo.x, f.pageNo.y);
    draw(form.sheets || String(sheets), f.sheets.x, f.sheets.y);
    draw(form.signature, f.signature.x, f.signature.y);
  }

  return out.save();
}

export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
