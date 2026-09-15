/**
 * Fills the Performance Evaluation Report for Regularization from an employee record.
 *
 * The form is read rather than measured: the labels printed on it — "Employee Name:",
 * "Date Employed:", "To:" — are found in the template's own text, and each value is
 * written in the cell beside (or beneath) its label. Nothing depends on stored
 * coordinates, so a template re-exported at a different page size, or with its rows
 * nudged about, still fills correctly.
 *
 * Two template vintages are supported. A blank form has empty cells and is filled purely
 * from the labels. An older one carried yellow placeholder text ("Hired Date", "Employee
 * Position"); where that is found it is deleted from the page — highlight and all — and
 * the value written in its place.
 */
export type PerfEvalField = "fullName" | "department" | "position" | "dateEmployed" | "sixthMonth";

/** Placeholder text carried by the older, pre-highlighted template. */
export const PERF_EVAL_PLACEHOLDERS: { text: string; field: PerfEvalField }[] = [
  { text: "Employee First Name Middle Initial. Last Name", field: "fullName" },
  { text: "6th Month Regularization Date", field: "sixthMonth" },
  { text: "Employee Position", field: "position" },
  { text: "Employee Full name", field: "fullName" },
  { text: "Hired Date", field: "dateEmployed" },
  { text: "Department", field: "department" },
];

/**
 * Where each value goes on a blank form, expressed as the printed label it follows.
 *
 * `beside` puts the value in the next cell along, found from the table's own rules.
 * `below` puts it on the line under the label, which is how the signature block reads.
 */
export const PERF_EVAL_ANCHORS: {
  label: string;
  field: PerfEvalField;
  place: "beside" | "below";
}[] = [
  { label: "Employee Name:", field: "fullName", place: "beside" },
  { label: "Department:", field: "department", place: "beside" },
  { label: "Current Position:", field: "position", place: "beside" },
  { label: "Date Employed:", field: "dateEmployed", place: "beside" },
  { label: "From:", field: "dateEmployed", place: "beside" },
  { label: "To:", field: "sixthMonth", place: "beside" },
  { label: "In consultation with:", field: "fullName", place: "below" },
  { label: "RATEE:", field: "fullName", place: "below" },
];

export type PerfEvalValues = Record<PerfEvalField, string>;

/**
 * The header block — Employee Name, Department, Current Position, Date Employed and both
 * halves of Period Covered — is typed at Arial 7.04 so each value sits on one line inside
 * its table cell.
 */
export const PERF_EVAL_HEADER_SIZE = 7.04;

/** Gap between a cell's rule and the value written inside it. */
const CELL_PADDING = 4;
/** How far under a label a "below" value is dropped. */
const BELOW_DROP = 12;

/** "Hazel E. Bayani - Performance Evaluation.pdf" */
export function performanceEvaluationFileName(fullName: string): string {
  const safe = (fullName || "Employee").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${safe} - Performance Evaluation.pdf`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type Run = { str: string; x: number; y: number; width: number; size: number };
type Found = { page: number; x: number; y: number; width: number; size: number };

/**
 * Makes a value safe for a PDF standard font. Those cover WinAnsi only, and pdf-lib throws
 * on anything outside it — a line break or a peso sign pasted into a field would abort the
 * whole download. Every value on this form sits on one line, so breaks become spaces.
 */
function toPdfText(raw: string): string {
  return (raw || "")
    .replace(/\s+/g, " ")
    .replace(/₱/g, "P")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\xFF]/g, "")
    .trim();
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** The text of every page, grouped into visual lines. */
async function readLines(bytes: Uint8Array): Promise<Run[][][]> {
  const pdfjs = await import("pdfjs-dist");
  // Same worker resolution the PDF preview uses, so the bundler ships it once.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;

  const pages: Run[][][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const runs: Run[] = content.items
      .filter((i): i is typeof i & { str: string; transform: number[]; width: number; height: number } =>
        "str" in i
      )
      .map((i) => ({
        str: i.str,
        x: i.transform[4],
        y: i.transform[5],
        width: i.width,
        size: Math.hypot(i.transform[0], i.transform[1]) || i.height || 10,
      }))
      .filter((r) => r.str.length > 0);

    // Superscripts — the "th" of "6th" — sit on a raised baseline, so lines are clustered
    // by an approximate baseline rather than an exact one.
    const sorted = [...runs].sort((a, b) => b.y - a.y);
    const groups: Run[][] = [];
    for (const r of sorted) {
      const group = groups[groups.length - 1];
      const tolerance = Math.max(r.size, group?.[0]?.size || 0) * 0.6;
      if (group && Math.abs(group[0].y - r.y) <= tolerance) group.push(r);
      else groups.push([r]);
    }
    groups.forEach((g) => g.sort((a, b) => a.x - b.x));
    pages.push(groups);
  }
  return pages;
}

/**
 * Finds a phrase in the page text. pdf.js splits a line across many runs and inserts
 * synthetic whitespace between them, so the raw text is accumulated and only normalised
 * to compare — normalising as we go would trim the very space that separates "6th" from
 * "Month". Returns every occurrence, in document order.
 */
function findPhrase(pages: Run[][][], phrase: string): Found[] {
  const target = normalize(phrase);
  const out: Found[] = [];

  pages.forEach((lines, pageIndex) => {
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        let raw = "";
        for (let j = i; j < line.length && j < i + 60; j++) {
          raw += line[j].str;
          const seen = normalize(raw);
          if (seen === target) {
            // Trim to the runs that carry ink, so the position is the first real glyph.
            let first = i;
            let last = j;
            while (first < last && !line[first].str.trim()) first++;
            while (last > first && !line[last].str.trim()) last--;
            const head = line[first];
            const tail = line[last];
            out.push({
              page: pageIndex + 1,
              x: head.x,
              y: head.y,
              width: tail.x + tail.width - head.x,
              size: head.size,
            });
            i = j;
            break;
          }
          if (seen.length > target.length) break;
        }
      }
    }
  });
  return out;
}

export type PerfEvalResult = { bytes: Uint8Array; filled: PerfEvalField[]; missing: PerfEvalField[] };

/**
 * Returns the completed PDF plus which fields were written, so the caller can warn rather
 * than hand over a form with a cell left blank.
 */
export async function buildPerformanceEvaluation(
  templateDataUrl: string,
  values: PerfEvalValues
): Promise<PerfEvalResult> {
  const source = dataUrlToBytes(templateDataUrl);
  // pdf.js takes ownership of the buffer it is handed, so it gets its own copy — otherwise
  // pdf-lib is left with a detached, empty array and cannot parse the template.
  const pages = await readLines(new Uint8Array(source));

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const { erasePhrases, removeYellowHighlights, findRules } = await import("./pdfContentEdit");
  const pdf = await PDFDocument.load(source);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pdfPages = pdf.getPages();

  // Any highlight on the template goes, whether or not it sits under a placeholder.
  await removeYellowHighlights(pdf);

  const filled = new Set<PerfEvalField>();
  const draw = (pageIndex: number, text: string, x: number, y: number, size: number) => {
    const page = pdfPages[pageIndex];
    if (!page || !text) return;
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
  };

  // ---- 1. Older template: placeholder text, deleted then replaced --------------------
  const placeholderHits = PERF_EVAL_PLACEHOLDERS.flatMap((ph) =>
    findPhrase(pages, ph.text).map((hit) => ({ ...hit, ...ph }))
  );
  if (placeholderHits.length > 0) {
    await erasePhrases(pdf, PERF_EVAL_PLACEHOLDERS.map((ph) => ph.text));
    // The full name appears in the header and again in the signature block; only the
    // topmost is a header field, and only header fields take the fixed 7.04 size.
    const topFullName = placeholderHits
      .filter((h) => h.field === "fullName")
      .sort((a, b) => a.page - b.page || b.y - a.y)[0];
    for (const hit of placeholderHits) {
      const value = toPdfText(values[hit.field] || "");
      if (!value) continue;
      const isHeader = hit.field !== "fullName" || hit === topFullName;
      draw(hit.page - 1, value, hit.x, hit.y, isHeader ? PERF_EVAL_HEADER_SIZE : hit.size);
      filled.add(hit.field);
    }
  }

  // ---- 2. Blank template: anchor on the printed labels -------------------------------
  const rulesByPage = new Map<number, Awaited<ReturnType<typeof findRules>>>();
  const usedLabels = new Map<string, number>();

  for (const anchor of PERF_EVAL_ANCHORS) {
    const value = toPdfText(values[anchor.field] || "");
    if (!value) continue;
    // A field already written from a placeholder must not be written twice.
    if (placeholderHits.some((h) => h.field === anchor.field)) continue;

    const hits = findPhrase(pages, anchor.label);
    if (hits.length === 0) continue;
    // Labels are consumed in document order, so repeats resolve to successive rows.
    const seen = usedLabels.get(anchor.label) ?? 0;
    const hit = hits[Math.min(seen, hits.length - 1)];
    usedLabels.set(anchor.label, seen + 1);

    if (!rulesByPage.has(hit.page)) {
      rulesByPage.set(hit.page, await findRules(pdf, hit.page - 1));
    }
    const { vertical, horizontal } = rulesByPage.get(hit.page)!;

    if (anchor.place === "below") {
      // Centre the name in its cell rather than hanging it off the label's left edge, and
      // keep it clear of the rule beneath — the RATEE cell is short enough that a fixed
      // drop puts the text straight through the border.
      const spans = (r: { y0: number; y1: number }) => r.y0 <= hit.y + hit.size && r.y1 >= hit.y;
      const left = vertical.filter((r) => r.x1 <= hit.x + 1 && spans(r)).sort((a, b) => b.x1 - a.x1)[0];
      const right = vertical.filter((r) => r.x0 > hit.x && spans(r)).sort((a, b) => a.x0 - b.x0)[0];

      const size = PERF_EVAL_HEADER_SIZE;
      const width = font.widthOfTextAtSize(value, size);
      const x =
        left && right ? (left.x1 + right.x0) / 2 - width / 2 : hit.x;

      // The floor of the cell: the highest horizontal rule below the label that runs under
      // it. The baseline sits a descender's height above it.
      const floor = horizontal
        .filter((r) => r.y1 < hit.y && r.x0 <= hit.x && r.x1 >= hit.x)
        .sort((a, b) => b.y1 - a.y1)[0];
      const wanted = hit.y - BELOW_DROP;
      const y = floor ? Math.max(wanted, floor.y1 + size * 0.45) : wanted;

      draw(hit.page - 1, value, x, y, size);
      filled.add(anchor.field);
      continue;
    }

    const rules = vertical;
    const labelEnd = hit.x + hit.width;
    // The first rule right of the label that spans this row starts the cell the value
    // belongs in. A label's own cell is usually wider than its text, so "just after the
    // label" would leave the value in the wrong box.
    const next = rules
      .filter((r) => r.x0 > labelEnd + 1 && r.y0 <= hit.y + hit.size && r.y1 >= hit.y)
      .sort((a, b) => a.x0 - b.x0)[0];
    const x = next ? next.x1 + CELL_PADDING : labelEnd + CELL_PADDING * 2;
    draw(hit.page - 1, value, x, hit.y, PERF_EVAL_HEADER_SIZE);
    filled.add(anchor.field);
  }

  const wanted: PerfEvalField[] = ["fullName", "department", "position", "dateEmployed", "sixthMonth"];
  return {
    bytes: await pdf.save(),
    filled: wanted.filter((f) => filled.has(f)),
    missing: wanted.filter((f) => !filled.has(f)),
  };
}

export function downloadPdfBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
