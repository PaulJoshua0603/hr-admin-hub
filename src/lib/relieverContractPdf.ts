/**
 * Fills the Temporary Employment Contract (Reliever) from a PDF template.
 *
 * The blank form marks each field with placeholder text in the body copy — "Hired Date",
 * "Employee Position", "00,000.00". Replacing those in place is not enough, because a PDF
 * does not reflow: a date that is wider than the words it replaces prints over whatever
 * follows it on the line, and one that is narrower leaves a hole. Shrinking the value to
 * fit, which is what this used to do, is what made a date come out at half the size of the
 * sentence around it.
 *
 * So the unit of work here is a whole paragraph rather than a placeholder. Each paragraph
 * of the template is read back as text, the placeholders inside it are substituted, the
 * original is deleted from the page, and the result is set again from the left margin and
 * wrapped — in the template's own font, lifted out of the file, at the template's own
 * size. Lines therefore break where they should, nothing overlaps, and a filled paragraph
 * is typographically indistinguishable from an untouched one.
 *
 * A paragraph only grows into space that is already blank: the wrap keeps to the gap below
 * it, and the type is stepped down slightly rather than allowed to run into what follows.
 */
import type { PDFFont } from "pdf-lib";
import type { Employee } from "@/types";
import { DEFAULT_WORK_LOCATION } from "@/types";
import { formatDate } from "./dates";

export type RelieverFillResult = {
  bytes: Uint8Array;
  /** Placeholders found and filled. */
  filled: string[];
  /** Placeholders the template did not contain. */
  missing: string[];
};

/** "Hazel E. Bayani-Reliever Contract.pdf" */
export function relieverContractFileName(fullName: string): string {
  const safe = (fullName || "Employee").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${safe}-Reliever Contract.pdf`;
}

/** Splits "7:30 AM to 4:30 PM" into its two halves. */
function splitWorkingHours(shift?: string): [string, string] {
  const raw = (shift || "").trim();
  if (!raw) return ["", ""];
  const parts = raw
    .split(/\s+to\s+|[–—-]/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return [parts[0] || "", parts[1] || ""];
}

/**
 * "21100" and "21,100" both print as "21,100.00"; anything that is not a number is left
 * exactly as the user typed it, so a note in the salary field still reaches the contract.
 */
function formatAmount(raw?: string): string {
  const text = (raw || "").trim();
  if (!text) return "0.00";
  const numeric = Number(text.replace(/[,\s₱]/g, "").replace(/^php/i, ""));
  if (!Number.isFinite(numeric) || !text.match(/\d/)) return text;
  return numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * What the template says, and what it should say for this employee.
 *
 * `find` is matched against the paragraph as a reader sees it, so it can carry the words
 * around a placeholder. That is what keeps "Address: Address" from being confused with the
 * company's own "Address:" line a few paragraphs above, and it lets the replacement tidy
 * the template's punctuation at the same time — "Work Location:15F" gains the space it is
 * missing.
 *
 * A `find` with more than one value fills its occurrences in document order: the two
 * "00,000.00" cells are the basic salary and the total gross respectively.
 */
export function relieverContractValues(employee: Employee): { find: string; values: string[] }[] {
  const longDate = (iso?: string) => (iso ? formatDate(iso, "MMMM d, yyyy") : "");
  const hireDate = longDate(employee.dateHired);
  const endDate = longDate(employee.relieverEndDate);
  const address = [employee.homeAddress, employee.homeCity]
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join(", ");
  const [hoursFrom, hoursTo] = splitWorkingHours(employee.workingHours);
  const workLocation = (employee.workLocation || DEFAULT_WORK_LOCATION).trim();
  // Six is more occurrences than any placeholder has; the last value stands for the rest.
  const repeat = (value: string) => [value, value, value, value, value, value];

  return [
    { find: "Employee Name: Fullname", values: [`Employee Name: ${employee.name || ""}`] },
    { find: "Address: Address", values: [`Address: ${address}`] },
    {
      find:
        "Work Location:15F Four/Neo 4th Avenue corner 30th and 31st Streets, " +
        "Bonifacio Global City, Taguig City.",
      values: [`Work Location: ${workLocation.replace(/\.+$/, "")}.`],
    },
    {
      find: "Reason for Coverage: (What Reason)",
      values: [`Reason for Coverage: ${employee.relieverReason || ""}`],
    },
    { find: "Hired Onboarding Date", values: repeat(hireDate) },
    { find: "Former Employee Position", values: repeat(employee.replacedPosition || "") },
    { find: "Former Employee Name", values: repeat(employee.replacedEmployeeName || "") },
    { find: "Employee Fullname", values: repeat(employee.name || "") },
    { find: "Employee Position", values: repeat(employee.position || "") },
    { find: "Hired Date", values: repeat(hireDate) },
    { find: "End Date", values: repeat(endDate) },
    { find: "Job Duties", values: [employee.replacedJobDuties || ""] },
    {
      find: "00,000.00",
      values: [
        formatAmount(employee.basicSalary),
        formatAmount(employee.totalMonthlyGrossCompensation),
      ],
    },
    { find: "0:00 am", values: [hoursFrom || "0:00 am"] },
    { find: "0:00 pm", values: [hoursTo || "0:00 pm"] },
  ];
}

type Run = { str: string; x: number; y: number; width: number; size: number; font: string };
/** Consecutive runs with no meaningful gap between them: one column of one line. */
type Segment = { runs: Run[]; x: number; right: number; y: number; size: number; font: string };
/**
 * What gets rewritten as a whole: a paragraph of full-width lines, or a single cell of a
 * line that has more than one column.
 */
type Block = {
  lines: Segment[];
  x: number;
  /** The rightmost point the text may reach. */
  limit: number;
  size: number;
  font: string;
  leading: number;
  /** Lines it may occupy: its own, plus whatever blank space sits underneath. */
  maxLines: number;
  /** Set to its right edge, as the amount column is, and where that edge is. */
  alignRight: boolean;
  anchorRight: number;
  /** Whether this block was the only column on its line. */
  full: boolean;
  text: string;
};

/** Word's default page margins, and where its text block therefore ends. */
const RIGHT_MARGIN = 72;
/** A gap this wide is a new column rather than a space. */
const COLUMN_GAP = 8;
/** Leading as a multiple of the type size, when a paragraph is a single line. */
const DEFAULT_LEADING = 1.32;
/** Small enough to take any realistic value, large enough to stay readable. */
const MIN_SIZE = 5;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Makes a value safe to set in the template's fonts.
 *
 * An embedded subset covers the characters the template itself used, so a curly quote or a
 * peso sign pasted into a form field can be missing from it — and pdf-lib throws rather
 * than skipping it, which would cost the user their contract. Everything is folded to its
 * closest plain-text form first.
 */
function toPdfText(raw: string): string {
  return (raw || "")
    .replace(/\r\n?/g, " ")
    .replace(/₱/g, "P")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\t\v\f]/g, " ")
    .replace(/[^\x20-\x7e]/g, "");
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Every page's text, grouped into lines and then into columns within each line. */
async function readPages(bytes: Uint8Array): Promise<Segment[][][]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;

  const pages: Segment[][][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const runs: Run[] = content.items
      .filter(
        (
          i
        ): i is typeof i & {
          str: string;
          transform: number[];
          width: number;
          height: number;
          fontName: string;
        } => "str" in i
      )
      .map((i) => ({
        str: i.str,
        x: i.transform[4],
        y: i.transform[5],
        width: i.width,
        size: Math.hypot(i.transform[0], i.transform[1]) || i.height || 12,
        font: i.fontName,
      }))
      .filter((r) => r.str.length > 0);

    // Superscripts ("31st") sit a point or two above their line, so lines are gathered with
    // a tolerance rather than by an exact baseline.
    const groups: Run[][] = [];
    for (const r of [...runs].sort((a, b) => b.y - a.y)) {
      const group = groups[groups.length - 1];
      const tolerance = Math.max(r.size, group?.[0]?.size || 0) * 0.6;
      if (group && Math.abs(group[0].y - r.y) <= tolerance) group.push(r);
      else groups.push([r]);
    }

    pages.push(
      groups.map((group) => {
        const ordered = [...group].sort((a, b) => a.x - b.x);
        const columns: Run[][] = [];
        // Measured between the ink: a text extractor reports the run of spaces that pads
        // one column out to the next as a single wide item, so going by the gap between
        // consecutive items would find no gap at all and read a table row as a sentence.
        let ink = 0;
        for (const run of ordered) {
          const last = columns[columns.length - 1];
          if (last && run.str.trim() && ink && run.x - ink > COLUMN_GAP) columns.push([run]);
          else if (last) last.push(run);
          else columns.push([run]);
          if (run.str.trim()) ink = run.x + run.width;
        }
        return columns.map((cells) => ({
          runs: cells,
          x: cells[0].x,
          right: Math.max(...cells.map((c) => c.x + c.width)),
          y: cells[0].y,
          // The line's body size, not a superscript's.
          size: Math.max(...cells.map((c) => c.size)),
          font: cells.reduce((a, b) => (b.str.trim().length > a.str.trim().length ? b : a)).font,
        }));
      })
    );
  }
  return pages;
}

/**
 * Gathers a page's lines into the blocks that can be rewritten independently.
 *
 * Consecutive full-width lines that start at the same margin and sit one line apart are one
 * paragraph, so a placeholder split across a line break — the template breaks "Employee
 * Position" in two — is seen whole. A line with more than one column is a table row or a
 * signature rule, where rewrapping would run the columns together, so each of its cells
 * stands alone.
 */
/**
 * Where a column ends, taken from the other cells in it rather than from this one.
 *
 * The cells of a column are set to a common edge, and the middle value of the ones near
 * this cell finds it without being pulled about by a heading or a stray wide entry.
 */
function columnRight(page: Segment[][], lineIndex: number, columnIndex: number): number | null {
  const mine = page[lineIndex]?.[columnIndex];
  if (!mine) return null;
  const edges = page
    .map((line) => line[columnIndex])
    .filter((cell): cell is Segment => !!cell && Math.abs(cell.right - mine.right) < 30)
    .map((cell) => cell.right)
    .sort((a, b) => a - b);
  if (edges.length < 3) return null;
  return edges[Math.floor(edges.length / 2)];
}

function blocksFor(page: Segment[][], pageWidth: number): Block[] {
  const blocks: Block[] = [];

  page.forEach((line, lineIndex) => {
    line.forEach((segment, columnIndex) => {
      const full = line.length === 1;
      const previous = blocks[blocks.length - 1];
      const last = previous?.lines[previous.lines.length - 1];
      const joins =
        full &&
        previous?.full &&
        last &&
        page[lineIndex - 1]?.length === 1 &&
        Math.abs(previous.x - segment.x) < 2 &&
        Math.abs(previous.size - segment.size) < 0.6 &&
        last.y - segment.y > segment.size * 0.9 &&
        last.y - segment.y < segment.size * 1.7;

      if (joins && previous) {
        previous.lines.push(segment);
        return;
      }

      const wall = line[columnIndex + 1]?.x ?? pageWidth - RIGHT_MARGIN;
      blocks.push({
        lines: [segment],
        x: segment.x,
        limit: full ? pageWidth - RIGHT_MARGIN : Math.min(wall, pageWidth - RIGHT_MARGIN) - 4,
        size: segment.size,
        font: segment.font,
        leading: segment.size * DEFAULT_LEADING,
        maxLines: 1,
        // The amount column is set to its right edge; only a first column reads from the left.
        alignRight: columnIndex > 0,
        // Where the column's other cells end, rather than where this one happens to: the
        // template sets its placeholder in a different face from the figures below it, so
        // its own right edge is a couple of points out from the column the reader sees.
        anchorRight: columnRight(page, lineIndex, columnIndex) ?? segment.right,
        full,
        text: "",
      });
    });
  });

  for (const block of blocks) {
    if (block.lines.length > 1) {
      const gaps = block.lines
        .slice(1)
        .map((line, i) => block.lines[i].y - line.y)
        .filter((g) => g > 0);
      if (gaps.length) block.leading = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }
    block.text = collapse(block.lines.map((line) => line.runs.map((r) => r.str).join("")).join(" "));

    // How far it may spill: the blank space between its last line and whatever is below it.
    const bottom = block.lines[block.lines.length - 1];
    const below = page.find((line) => line[0].y < bottom.y - 1);
    const floor = below?.[0]?.y ?? RIGHT_MARGIN;
    const spare = Math.max(0, Math.floor((bottom.y - floor - block.leading) / block.leading));
    block.maxLines = block.lines.length + spare;
  }
  return blocks;
}

/** Breaks text into lines that fit `width` at `size`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const merged = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(merged, size) <= width) line = merged;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

export async function buildRelieverContractPdf(
  templateDataUrl: string,
  employee: Employee
): Promise<RelieverFillResult> {
  const source = dataUrlToBytes(templateDataUrl);
  // pdf.js takes ownership of the buffer it is given, so it gets its own copy.
  const pageSegments = await readPages(new Uint8Array(source));
  const spec = relieverContractValues(employee);

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const { eraseLines, removeUnderlines, removeYellowHighlights } = await import("./pdfContentEdit");

  const pdf = await PDFDocument.load(source);
  const pdfPages = pdf.getPages();

  // Which face each paragraph is set in, worked out by measurement: the standard font whose
  // widths reproduce the ones the reader reported for that paragraph is the one the page
  // was set in. The template is Word's Times New Roman, which Times matches to the point,
  // so a rewritten paragraph sits beside an untouched one without showing the join — and a
  // bold or sans-serif template still gets the nearest thing rather than plain roman.
  //
  // The faces the template itself embeds are not used for this, tempting as it is: Word
  // subsets them to the characters the blank form happened to contain, which is why the
  // form's own "00,000.00" gives no glyph for a 7 or an 8.
  const faces = await Promise.all(
    [
      StandardFonts.TimesRoman,
      StandardFonts.TimesRomanBold,
      StandardFonts.TimesRomanItalic,
      StandardFonts.Helvetica,
      StandardFonts.HelveticaBold,
      StandardFonts.HelveticaOblique,
      StandardFonts.Courier,
    ].map((name) => pdf.embedFont(name))
  );
  const fallback = faces[0];

  const samples = new Map<string, Run[]>();
  for (const page of pageSegments) {
    for (const line of page) {
      for (const segment of line) {
        for (const run of segment.runs) {
          if (run.str.trim().length < 4) continue;
          const list = samples.get(run.font) ?? [];
          if (list.length < 6) list.push(run);
          samples.set(run.font, list);
        }
      }
    }
  }
  const chosen = new Map<string, PDFFont>();
  function fontFor(name: string): PDFFont {
    const cached = chosen.get(name);
    if (cached) return cached;
    const mine = samples.get(name) ?? [];
    let best: { font: PDFFont; error: number } | null = null;
    for (const face of faces) {
      let error = 0;
      try {
        for (const sample of mine) {
          // Per point of type, so a heading is not judged more harshly than body copy.
          error += Math.abs(face.widthOfTextAtSize(sample.str, sample.size) - sample.width) / sample.size;
        }
      } catch {
        continue;
      }
      const mean = mine.length ? error / mine.length : Infinity;
      if (!best || mean < best.error) best = { font: face, error: mean };
    }
    const font = best?.font ?? fallback;
    chosen.set(name, font);
    return font;
  }

  await removeYellowHighlights(pdf);

  const used = new Map<string, number>();
  const filled = new Set<string>();

  for (let pageIndex = 0; pageIndex < pageSegments.length; pageIndex++) {
    const page = pdfPages[pageIndex];
    if (!page) continue;
    const blocks = blocksFor(pageSegments[pageIndex], page.getWidth());

    const rewrites: { block: Block; text: string; finds: string[] }[] = [];
    for (const block of blocks) {
      // Longest first, so "Hired Onboarding Date" is claimed before "Hired Date" can take
      // its first two words and leave "Onboarding Date" stranded in the sentence.
      const order = [...spec].sort((a, b) => b.find.length - a.find.length);
      const claims: { start: number; end: number; text: string; find: string }[] = [];
      for (const entry of order) {
        let from = 0;
        for (;;) {
          const at = block.text.indexOf(entry.find, from);
          if (at < 0) break;
          from = at + entry.find.length;
          if (claims.some((c) => at < c.end && from > c.start)) continue;
          const seen = used.get(entry.find) ?? 0;
          used.set(entry.find, seen + 1);
          claims.push({
            start: at,
            end: from,
            find: entry.find,
            text: toPdfText(entry.values[Math.min(seen, entry.values.length - 1)] ?? ""),
          });
        }
      }
      if (!claims.length) continue;
      let text = block.text;
      const finds = claims.map((c) => c.find);
      for (const claim of claims.sort((a, b) => b.start - a.start)) {
        text = text.slice(0, claim.start) + claim.text + text.slice(claim.end);
      }
      // Nothing to say that the template does not already say — an employee with no shift
      // on file leaves the form's own "0:00 am to 0:00 pm" standing. Rewriting it would
      // only reset it in a slightly different face.
      if (collapse(text) === block.text) {
        finds.forEach((find) => filled.add(find));
        continue;
      }
      rewrites.push({ block, text: collapse(text), finds });
    }
    if (!rewrites.length) continue;

    // Every line of every paragraph being rewritten goes first, so nothing of the template
    // shows through the new text. A paragraph whose original cannot be found is left as it
    // was rather than half-replaced.
    const survived = await eraseLines(
      pdf,
      pageIndex,
      rewrites.map(({ block }) => block.lines.map((line) => line.runs.map((r) => r.str).join("")))
    );

    // The template underlines its placeholders, and a rule is not text: erasing the words
    // would otherwise leave a line ruled to the length of the words that are gone, ending
    // part-way through the ones that replace them.
    await removeUnderlines(
      pdf,
      pageIndex,
      rewrites
        .filter((_, i) => survived[i])
        .flatMap(({ block }) =>
          block.lines.map((line) => ({
            x0: line.x - 2,
            x1: line.right + 2,
            y0: line.y - block.size * 0.5,
            y1: line.y + block.size * 0.06,
          }))
        )
    );

    for (let i = 0; i < rewrites.length; i++) {
      const { block, text, finds } = rewrites[i];
      if (!survived[i]) {
        // The amount cells are set in a CID font, where the file holds glyph numbers and
        // not characters, so there is no text to take out — and every other way of reading
        // them back agrees they are there. A single line has a known extent, so it can be
        // covered instead; a paragraph is left alone and reported, because a white band
        // across one would take the rules and underlines with it.
        if (block.lines.length !== 1 || !text) continue;
        const line = block.lines[0];
        page.drawRectangle({
          x: line.x - 1,
          y: line.y - block.size * 0.24,
          width: line.right - line.x + 1.5,
          height: block.size * 1.06,
          color: rgb(1, 1, 1),
        });
      }
      // Only now is the placeholder really gone from the page and its value on it.
      finds.forEach((find) => filled.add(find));
      if (!text) continue;
      const font = fontFor(block.font);
      const width = block.limit - block.x;

      // Set at the template's size if it fits the space the paragraph owns, and otherwise
      // stepped down a quarter point at a time — far less conspicuous than a value set at
      // half the size of the sentence it sits in. It keeps stepping down until the whole
      // of it fits: an address too long for its line comes out small, never cut short,
      // because a contract missing half of where the employee lives is worse than one set
      // a little tight.
      let size = block.size;
      let lines = wrap(text, font, size, width);
      while (lines.length > block.maxLines && size > MIN_SIZE) {
        size -= 0.25;
        lines = wrap(text, font, size, width);
      }

      lines.forEach((line, index) => {
        if (!line) return;
        // A column set to the right of its cell — the amounts — keeps its right edge, so
        // the figures still line up under one another whatever their length.
        const x = block.alignRight
          ? block.anchorRight - font.widthOfTextAtSize(line, size)
          : block.x;
        page.drawText(line, {
          x,
          y: block.lines[0].y - index * block.leading,
          size,
          font,
          color: rgb(0, 0, 0),
        });
      });
    }
  }

  return {
    bytes: await pdf.save(),
    filled: spec.map((s) => s.find).filter((f) => filled.has(f)),
    missing: spec.map((s) => s.find).filter((f) => !filled.has(f)),
  };
}
