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
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
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
export function relieverContractValues(
  employee: Employee
): { find: string; values: string[]; lift?: boolean; list?: boolean }[] {
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
    // The blank form leaves five empty lines between "including:" and this placeholder, so
    // the duties printed where it stood and the gap above them read as a mistake. `lift`
    // closes that up: the list starts one line under the sentence that introduces it, and
    // the space the template left is where it grows.
    // `list` keeps one duty per line, exactly as the user typed them — their own markers
    // and nothing added — each wrapped under a hanging indent rather than run together
    // into a single paragraph.
    { find: "Job Duties", values: [employee.replacedJobDuties || ""], lift: true, list: true },
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
  /** The baseline of the line this block sits on, which its own may be a point off. */
  baseline: number;
  /** The line above and the line below, which bound the space it can use. */
  prevY: number | null;
  floorY: number;
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
/**
 * How far below its introducing sentence a lifted field starts, in lines.
 *
 * Two, so there is a clear line of space between "including:" and the first duty. Butted
 * straight underneath, the list read as a continuation of the sentence rather than as the
 * list the sentence promises.
 */
const LIFT_GAP_LINES = 2;
/**
 * The contract is wanted at 11 point, and the template is set at 12. Scaling rather than
 * flattening to 11 keeps the section headings a size above the body copy, and keeps the
 * bullet lists a size below it, exactly as the template intends.
 */
const BODY_SCALE = 11 / 12;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Tidies the spacing without losing the line breaks.
 *
 * `collapse` flattens a value onto one line, which is right for a field that occupies one
 * — but the duties are a list, and flattening them is what ran nine entries together into
 * a single paragraph. Runs of spaces still go, and so do blank lines.
 */
const tidyLines = (s: string) =>
  s
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

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
    // Line breaks are kept: in the duties field each one is the user starting a new entry,
    // and it is the only record of how they laid the list out.
    .replace(/\r\n?/g, "\n")
    .replace(/₱/g, "P")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\t\v\f]/g, " ")
    .replace(/[^\n\x20-\x7e•]/g, "");
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
          // Where the ink ends, not where the run of padding spaces after it does: a text
          // extractor reports that padding as one wide item reaching the next column, and
          // counting it would make this column look as though it covered that one too.
          right: Math.max(
            ...cells.filter((c) => c.str.trim()).map((c) => c.x + c.width),
            cells[0].x
          ),
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
        // A table cell is often set a point clear of its row's baseline; taking the row's
        // own settles the figures onto the same line as the descriptions beside them.
        baseline: line[0].y,
        prevY: page[lineIndex - 1]?.[0]?.y ?? null,
        floorY: RIGHT_MARGIN,
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
    block.floorY = below?.[0]?.y ?? RIGHT_MARGIN;
    const spare = Math.max(
      0,
      Math.floor((bottom.y - block.floorY - block.leading) / block.leading)
    );
    block.maxLines = block.lines.length + spare;
  }
  return blocks;
}

/**
 * Where a line of a drawn block sits, and how it is set.
 *
 * A bullet is kept apart from the text it introduces rather than glued to its front,
 * because justifying the line would otherwise stretch the space after the bullet and the
 * markers would no longer line up down the page.
 */
type Placed = { text: string; x: number; width: number; justify: boolean; marker?: string };

/**
 * The duties as the user laid them out, one entry per line.
 *
 * Whatever they typed is what gets printed: if they wrote a bullet at the start of each
 * line, those bullets are theirs and appear once. Nothing is added and nothing is
 * reordered — the only tidying is dropping blank lines and a stray marker left on the end
 * of one, which would otherwise print as an empty entry.
 */
function listItems(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s*[•*]\s*$/, "").trim())
    .filter((line) => line && !/^[•*-]$/.test(line));
}

/**
 * Sets each entry as its own paragraph, with its wrapped lines hanging under its text.
 *
 * An entry that opens with a marker gets an indent the width of that marker, so the second
 * line of a long duty starts under the first word rather than under the bullet — which is
 * what stops a wrapped line from reading as a duty of its own.
 */
function listLines(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
  x: number
): Placed[] {
  const out: Placed[] = [];
  for (const item of listItems(text)) {
    // The marker the user typed, kept as part of the first line and measured so the rest
    // of the entry can hang under it.
    const marker = /^([•*-]\s+)/.exec(item)?.[1] ?? "";
    const body = item.slice(marker.length);
    const indent = marker ? font.widthOfTextAtSize(marker, size) : 0;
    const wrapped = wrap(body, font, size, width - indent);
    wrapped.forEach((line, i) => {
      out.push({
        text: line,
        x: x + indent,
        width: width - indent,
        // The last line of an entry is what ends it, so it keeps its natural width.
        justify: i < wrapped.length - 1,
        marker: i === 0 && marker ? marker.trim() : undefined,
      });
    });
  }
  return out;
}
/**
 * Spreads a line to the full measure by widening its word spaces.
 *
 * pdf-lib has no justification of its own, so each word is placed itself with the slack
 * shared out between them. Only a line that continues onto another is justified:
 * stretching the line that ends an item would pull three words across the whole page.
 */
function drawJustified(
  page: PDFPage,
  line: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  width: number,
  color: RGB
) {
  const words = line.split(" ").filter(Boolean);
  const inked = words.reduce((total, word) => total + font.widthOfTextAtSize(word, size), 0);
  const gaps = words.length - 1;
  const slack = gaps > 0 ? (width - inked) / gaps : 0;
  // A line that needs more than treble spacing is one long word from looking broken.
  if (gaps < 1 || slack <= 0 || slack > font.widthOfTextAtSize(" ", size) * 3) {
    page.drawText(line, { x, y, size, font, color });
    return;
  }
  let cursor = x;
  for (const word of words) {
    page.drawText(word, { x: cursor, y, size, font, color });
    cursor += font.widthOfTextAtSize(word, size) + slack;
  }
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
  const { eraseLines, removeUnderlines, removeYellowHighlights, scaleTextRuns } =
    await import("./pdfContentEdit");

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
  const liftable = new Set(spec.filter((s) => s.lift).map((s) => s.find));
  const listed = new Set(spec.filter((s) => s.list).map((s) => s.find));

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
      rewrites.push({ block, text: tidyLines(text), finds });
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

    // Work out how every rewrite will be set before anything is drawn, because how much
    // room the duties actually use decides how far the rest of the page moves up.
    type Laid = {
      block: Block;
      finds: string[];
      font: PDFFont;
      size: number;
      lines: Placed[];
      /** Baseline of its first line, before any lift. */
      top: number;
      cover: boolean;
      /** The field whose unused space the rest of the page can reclaim. */
      lifted: boolean;
    };
    const laid: Laid[] = [];

    for (let i = 0; i < rewrites.length; i++) {
      const { block, text, finds } = rewrites[i];
      // The amount cells are set in a CID font, where the file holds glyph numbers and not
      // characters, so there is no text to take out — and every other way of reading them
      // back agrees they are there. A single line has a known extent, so it can be covered
      // instead; a paragraph is left alone and reported, because a white band across one
      // would take the rules and underlines with it.
      const cover = !survived[i];
      if (cover && (block.lines.length !== 1 || !text)) continue;
      // Only now is the placeholder really gone from the page and its value on it.
      finds.forEach((find) => filled.add(find));
      if (!text) continue;

      const font = fontFor(block.font);
      const width = block.limit - block.x;
      // A lifted field starts under the sentence that introduces it instead of where the
      // template's placeholder happened to sit, with a clear line between the two.
      const lifted = finds.some((find) => liftable.has(find)) && block.prevY !== null;
      const top = lifted ? block.prevY! - block.leading * LIFT_GAP_LINES : block.lines[0].y;
      const maxLines = lifted
        ? Math.max(1, Math.floor((top - block.floorY) / block.leading))
        : block.maxLines;
      const asList = finds.some((find) => listed.has(find));

      // A list is measured the same way as a paragraph, bullets and hanging indent
      // included, so it cannot overrun the space the template left for it either.
      const set = (at: number): Placed[] =>
        asList
          ? listLines(text, font, at, width, block.x)
          : wrap(text, font, at, width).map((line) => ({
              text: line,
              x: block.x,
              width,
              justify: false,
            }));

      // Set at the template's size if it fits the space the field owns, and otherwise
      // stepped down a quarter point at a time — far less conspicuous than a value set at
      // half the size of the sentence it sits in. It keeps stepping down until the whole of
      // it fits: an address too long for its line comes out small, never cut short, because
      // a contract missing half of where the employee lives is worse than one set tight.
      let size = block.size * BODY_SCALE;
      let lines = set(size);
      while (lines.length > maxLines && size > MIN_SIZE) {
        size -= 0.25;
        lines = set(size);
      }
      laid.push({ block, finds, font, size, lines, top, cover, lifted });
    }

    // How much of the reserved space went unused, and therefore how far everything under it
    // can come up. The template leaves room for a dozen duties; three duties should not
    // leave nine blank lines in the middle of the page.
    let lift: { below: number; by: number } | null = null;
    for (const item of laid) {
      if (!item.lifted || item.cover) continue;
      const bottom = item.top - (item.lines.length - 1) * item.block.leading;
      const wanted = bottom - item.block.leading * LIFT_GAP_LINES;
      const by = wanted - item.block.floorY;
      if (by > 1) lift = { below: item.block.floorY, by };
    }
    /** Where a baseline ends up once the page has closed up. */
    const lifted = (y: number) => (lift && y <= lift.below ? y + lift.by : y);

    // Now the page itself: the size operands already on it are scaled, each run is pulled
    // back towards the start of its own column by the same proportion — so a line Word
    // split into several runs, around a hyphen or a superscript, does not come apart as the
    // type shrinks — and anything below the reserved space moves up to close the gap.
    await scaleTextRuns(
      pdf,
      pageIndex,
      BODY_SCALE,
      pageSegments[pageIndex].flatMap((line) =>
        line.map((segment) => ({ x: segment.x, right: segment.right, y: segment.y }))
      ),
      lift ?? undefined
    );

    for (const item of laid) {
      const { block, font, size, lines, cover } = item;
      const top = lifted(item.top);
      if (cover) {
        const line = block.lines[0];
        page.drawRectangle({
          x: line.x - 1,
          y: lifted(line.y) - block.size * 0.24,
          width: line.right - line.x + 1.5,
          height: block.size * 1.06,
          color: rgb(1, 1, 1),
        });
      }

      // A list gets a little air between items, if there is room for it — the gap is what
      // separates one duty from the next once an item wraps onto a second line.
      const leading =
        item.lines.some((l) => l.marker) && lines.length < block.maxLines
          ? block.leading * 1.08
          : block.leading;

      lines.forEach((line, index) => {
        if (!line.text) return;
        const y = (block.alignRight ? lifted(block.baseline) : top) - index * leading;
        if (line.marker) {
          page.drawText(line.marker, { x: block.x, y, size, font, color: rgb(0, 0, 0) });
        }
        // A column set to the right of its cell — the amounts — keeps its right edge, so
        // the figures still line up under one another whatever their length.
        if (block.alignRight) {
          page.drawText(line.text, {
            x: block.anchorRight - font.widthOfTextAtSize(line.text, size),
            y,
            size,
            font,
            color: rgb(0, 0, 0),
          });
          return;
        }
        if (line.justify) {
          drawJustified(page, line.text, line.x, y, size, font, line.width, rgb(0, 0, 0));
          return;
        }
        page.drawText(line.text, { x: line.x, y, size, font, color: rgb(0, 0, 0) });
      });
    }
  }


  return {
    bytes: await pdf.save(),
    filled: spec.map((s) => s.find).filter((f) => filled.has(f)),
    missing: spec.map((s) => s.find).filter((f) => !filled.has(f)),
  };
}
