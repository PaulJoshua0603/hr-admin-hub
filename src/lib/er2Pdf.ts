import type { ER2Column, ER2Form, ER2Layout } from "@/types";
import { ER2_COLUMN_ORDER, ER2_LAST_COLUMN_RIGHT, layoutOrDefault } from "@/lib/er2Layout";

/** The table never shrinks below this; anything still too long is wrapped or cut. */
const MIN_FONT_SIZE = 6;
/** Breathing room kept between a value and the next column rule. */
const COLUMN_GUTTER = 0.006;
/** Lines a single cell may wrap onto, the way a Word table cell would. */
const MAX_CELL_LINES = 2;
/** Baseline-to-baseline spacing within a wrapped cell, as a multiple of the font size. */
const LINE_LEADING = 1.06;
/** Share of a row a stacked cell may fill before it would crowd the row above. */
const ROW_FILL = 0.92;

/**
 * Short month names for the Date of Employment column, which is the narrowest on the
 * form. "SEPTEMBER 01, 2026" only fits spelled out at a very small size, so when it
 * would otherwise wrap the date is abbreviated — "SEPT. 01, 2026" — to keep it on one
 * line. The short months are left alone; abbreviating them gains nothing.
 */
const MONTH_ABBREVIATIONS: Record<string, string> = {
  JANUARY: "JAN.",
  FEBRUARY: "FEB.",
  MARCH: "MAR.",
  APRIL: "APR.",
  AUGUST: "AUG.",
  SEPTEMBER: "SEPT.",
  OCTOBER: "OCT.",
  NOVEMBER: "NOV.",
  DECEMBER: "DEC.",
};

/** "SEPTEMBER 01, 2026" -> "SEPT. 01, 2026". Anything else is returned unchanged. */
export function shortenDate(text: string): string {
  return text.replace(/^([A-Za-z]+)\b/, (month) => MONTH_ABBREVIATIONS[month.toUpperCase()] ?? month);
}

/**
 * Lines that actually name someone. A row left blank must not be counted, or TOTAL NO.
 * LISTED ABOVE would overstate how many employees are being reported.
 */
export function listedCount(form: Pick<ER2Form, "entries">): number {
  return form.entries.filter((e) => e.name.trim()).length;
}

/** Rows one ER2 sheet holds before the list continues on another sheet. */
export function pageCount(entryCount: number, layout: ER2Layout): number {
  return Math.max(1, Math.ceil(entryCount / Math.max(1, layout.table.maxRows)));
}

/**
 * The PDF standard fonts only cover WinAnsi, and pdf-lib throws on anything outside it —
 * a peso sign in a salary would otherwise abort the whole download. Known symbols are
 * swapped for their closest encodable form and anything still unsupported is dropped,
 * so one stray character can never cost the user their form.
 */
export function toWinAnsi(text: string): string {
  return text
    .replace(/₱/g, "P") // ₱ peso sign — printed as P on the form
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\xFF]/g, "");
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

    const draw = (raw: string, xf: number, yf: number, useBold = false, drawSize = size) => {
      const text = toWinAnsi(raw || "");
      if (!text) return;
      const { x, y } = toPdfPoint(xf, yf);
      page.drawText(text, {
        x,
        y,
        size: drawSize,
        font: useBold ? bold : font,
        color: rgb(0, 0, 0),
        rotate: degrees(angle),
      });
    };

    /**
     * Draws a value centred on its anchor. The form's blanks are short and the words
     * around them are fixed, so a number that starts at the anchor drifts right and
     * touches "OF" or "SHEETS"; centring keeps it sitting in the middle of its space
     * whether it is one digit or three.
     */
    const drawCentered = (raw: string, xf: number, yf: number, useBold = false) => {
      const text = toWinAnsi(raw || "");
      if (!text) return;
      const face = useBold ? bold : font;
      const halfWidth = face.widthOfTextAtSize(text, size) / 2 / displayWidth;
      draw(text, xf - halfWidth, yf, useBold);
    };

    /** Space a column has before the next rule, less a little breathing room. */
    const columnWidth = (col: ER2Column): number => {
      const index = ER2_COLUMN_ORDER.indexOf(col);
      const next = ER2_COLUMN_ORDER[index + 1];
      const right = next ? layout.table.columns[next] : ER2_LAST_COLUMN_RIGHT;
      return Math.max(0, right - layout.table.columns[col] - COLUMN_GUTTER) * displayWidth;
    };

    /** Height of one table row, measured down the displayed page. */
    const rowHeightPt = layout.table.rowHeight * displayHeight;

    /**
     * Breaks a value into the lines it needs inside its column, the way a Word table cell
     * wraps: on whole words, and splitting a word only when it is wider than the column on
     * its own. Returns null when it would need more lines than `limit` allows.
     */
    const wrapCell = (
      text: string,
      room: number,
      candidate: number,
      limit: number = MAX_CELL_LINES
    ): string[] | null => {
      if (!text) return [];
      const widthOf = (t: string) => font.widthOfTextAtSize(t, candidate);
      if (widthOf(text) <= room) return [text];

      const lines: string[] = [];
      let line = "";
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const merged = line ? `${line} ${word}` : word;
        if (widthOf(merged) <= room) {
          line = merged;
          continue;
        }
        if (line) lines.push(line);
        line = word;
        while (widthOf(line) > room && line.length > 1) {
          let cut = line.length;
          while (cut > 1 && widthOf(line.slice(0, cut)) > room) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      if (line) lines.push(line);
      return lines.length > limit ? null : lines;
    };

    /**
     * How a value is written at a given size. Dates are kept on one line — spelled out
     * if they fit, abbreviated if not — because a wrapped date reads as a mistake rather
     * than as a long entry. Every other column may wrap.
     */
    const renderCell = (col: ER2Column, raw: string, candidate: number): string => {
      const text = toWinAnsi(raw || "");
      if (col !== "dateOfEmployment" || !text) return text;
      const room = columnWidth(col);
      if (font.widthOfTextAtSize(text, candidate) <= room) return text;
      return shortenDate(text);
    };

    /**
     * One size for the whole table: the largest at which every value fits inside its own
     * column and every stacked cell still fits its row. Setting the table's font once —
     * and wrapping what is too long rather than shrinking that one cell — is what makes
     * the sheet read as typed rather than patched together.
     */
    const fitsAt = (candidate: number) =>
      ER2_COLUMN_ORDER.every((col) => {
        const room = columnWidth(col);
        return form.entries.every((entry) => {
          const text = renderCell(col, entry[col] || "", candidate);
          const lines = wrapCell(text, room, candidate);
          if (lines === null) return false;
          // A date that still needs two lines at this size means the size is too big.
          if (col === "dateOfEmployment" && lines.length > 1) return false;
          const stack = candidate * (1 + LINE_LEADING * (lines.length - 1));
          return stack <= rowHeightPt * ROW_FILL;
        });
      });

    let bodySize = size;
    while (bodySize > MIN_FONT_SIZE && !fitsAt(bodySize)) bodySize -= 0.25;

    /**
     * The lines of one cell at the chosen size. At the floor a value can still be too long
     * to wrap into its row, so the overflow is dropped with an ellipsis — nothing is ever
     * allowed to run past a column rule.
     */
    const cellLines = (col: ER2Column, raw: string, room: number): string[] => {
      const text = renderCell(col, raw, bodySize);
      if (!text) return [];
      const wrapped = wrapCell(text, room, bodySize, Number.POSITIVE_INFINITY) ?? [];
      if (wrapped.length <= MAX_CELL_LINES) return wrapped;

      const head = wrapped.slice(0, MAX_CELL_LINES);
      let last = head[head.length - 1];
      while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, bodySize) > room) {
        last = last.slice(0, -1);
      }
      head[head.length - 1] = `${last.trimEnd()}...`;
      return head;
    };

    // Only the fields PhilHealth expects us to fill. The employer block, the list-type
    // checkbox and the signature line are already printed on the template.
    const f = layout.fields;
    const entries = form.entries.slice(sheet * rowsPerSheet, (sheet + 1) * rowsPerSheet);
    entries.forEach((entry, i) => {
      const baseline = layout.table.firstRowY + i * layout.table.rowHeight;
      ER2_COLUMN_ORDER.forEach((col) => {
        const lines = cellLines(col, entry[col] || "", columnWidth(col));
        // A wrapped cell stacks upward from the row's line, so its last line keeps sitting
        // on the rule exactly where a single-line value would.
        lines.forEach((line, index) => {
          const lift = ((lines.length - 1 - index) * LINE_LEADING * bodySize) / displayHeight;
          draw(line, layout.table.columns[col], baseline - lift, false, bodySize);
        });
      });
    });

    // The printed total counts everyone on the report, not just this sheet.
    drawCentered(String(listedCount(form)), f.totalListed.x, f.totalListed.y, true);
    drawCentered(form.pageNo || "1", f.pageNo.x, f.pageNo.y);
    drawCentered(form.sheets || "1", f.sheets.x, f.sheets.y);
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
