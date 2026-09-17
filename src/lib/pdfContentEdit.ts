/**
 * Small content-stream surgery for filled PDF forms.
 *
 * Painting a white box over a placeholder is a poor way to replace it: the box has to be
 * guessed wide enough to hide the highlight yet narrow enough to spare the table rules
 * and the punctuation beside it, and there is no size that is dependably both. These two
 * helpers change the page itself instead — the highlight is recoloured to white and the
 * placeholder's glyphs are deleted — so there is nothing left to cover up.
 */
import type { PDFDocument, PDFPage, PDFRef } from "pdf-lib";

/**
 * Yellow fills, as Word's PDF export writes a text highlight. Non-stroking operators only
 * (the lower-case ones): the stroking forms draw rules and borders, which must survive.
 */
const YELLOW_FILL = /(?<![\d.])1(?:\.0+)?\s+1(?:\.0+)?\s+0(?:\.0+)?\s+(rg|sc|scn)\b/g;

/**
 * Reads a page's content streams as text, keeping each stream's reference so the edited
 * bytes can be put back in its place.
 */
async function readContents(
  pdf: PDFDocument,
  page: PDFPage
): Promise<{ refs: PDFRef[]; texts: string[] }> {
  const { PDFArray, PDFRawStream, PDFRef: Ref, decodePDFRawStream, PDFName } = await import("pdf-lib");
  const contents = page.node.get(PDFName.of("Contents"));
  const resolved = contents && pdf.context.lookup(contents);

  const refs: PDFRef[] = [];
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      const entry = resolved.get(i);
      if (entry instanceof Ref) refs.push(entry);
    }
  } else if (contents instanceof Ref) {
    refs.push(contents);
  }

  const texts = refs.map((ref) => {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) return "";
    const bytes = decodePDFRawStream(stream).decode();
    // A content stream is bytes, so this is a Latin-1 round trip. Chunked, because a
    // multi-page form's stream is long enough to blow the argument limit in one call.
    let out = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      out += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return out;
  });
  return { refs, texts };
}

/** Puts edited bytes back as a fresh uncompressed stream at the same reference. */
function writeContents(pdf: PDFDocument, refs: PDFRef[], texts: string[]) {
  refs.forEach((ref, i) => {
    const bytes = new Uint8Array(texts[i].length);
    for (let j = 0; j < texts[i].length; j++) bytes[j] = texts[i].charCodeAt(j) & 0xff;
    pdf.context.assign(ref, pdf.context.stream(bytes));
  });
}

/**
 * Repaints every yellow fill white, which is what actually removes a Word highlight —
 * the whole of it, including the overhang past the text, without having to know where it
 * ends.
 */
export async function removeYellowHighlights(pdf: PDFDocument): Promise<number> {
  let repainted = 0;
  for (const page of pdf.getPages()) {
    const { refs, texts } = await readContents(pdf, page);
    const edited = texts.map((t) =>
      t.replace(YELLOW_FILL, (_m, op: string) => {
        repainted++;
        return `1 1 1 ${op}`;
      })
    );
    if (edited.some((t, i) => t !== texts[i])) writeContents(pdf, refs, edited);
  }
  return repainted;
}

/** Text inside a literal PDF string, with the escapes a content stream may carry. */
function decodeLiteral(body: string): string {
  const simple: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    "(": "(",
    ")": ")",
    "\\": "\\",
  };
  return body
    .replace(/\\([nrtbf()\\])/g, (_m, c: string) => simple[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** Every string in a content stream — literal or hex — with its span and decoded text. */
function scanStrings(stream: string): { start: number; end: number; text: string; hex: boolean }[] {
  const found: { start: number; end: number; text: string; hex: boolean }[] = [];
  let m: RegExpExecArray | null;

  const literal = /\(((?:\\.|[^\\()])*)\)/g;
  while ((m = literal.exec(stream)) !== null) {
    found.push({ start: m.index, end: m.index + m[0].length, text: decodeLiteral(m[1]), hex: false });
  }

  // Hex strings, which is how pdf-lib and many Word exports write text. "<<" opens a
  // dictionary, so those are skipped rather than mistaken for a string.
  const hex = /<([0-9A-Fa-f\s]*)>/g;
  while ((m = hex.exec(stream)) !== null) {
    if (stream[m.index - 1] === "<" || stream[m.index + m[0].length] === ">") continue;
    const digits = m[1].replace(/\s+/g, "");
    if (digits.length === 0 || digits.length % 2 !== 0) continue;
    let text = "";
    for (let i = 0; i < digits.length; i += 2) {
      text += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
    }
    found.push({ start: m.index, end: m.index + m[0].length, text, hex: true });
  }

  return found.sort((a, b) => a.start - b.start);
}

/**
 * Deletes the glyphs of each phrase from the page's text, emptying the strings but
 * leaving the operators in place so everything positioned afterwards stays put.
 *
 * Literal and hex strings are both handled. A subsetted CID font encodes glyph ids rather
 * than characters, and those cannot be matched this way, so the caller is told which
 * phrases were actually erased and can fall back to covering the rest.
 */
export async function erasePhrases(pdf: PDFDocument, phrases: string[]): Promise<Set<string>> {
  const erased = new Set<string>();
  // Longest first, so "Employee Full name" cannot eat part of a longer phrase.
  const wanted = [...new Set(phrases)].sort((a, b) => b.length - a.length);

  for (const page of pdf.getPages()) {
    const { refs, texts } = await readContents(pdf, page);
    const edited = texts.map((text) => {
      let out = text;
      for (const phrase of wanted) {
        const target = normalize(phrase);

        // Word splits one line of text across many strings, so a phrase is looked for
        // across consecutive ones.
        const literals = scanStrings(out);

        // Every occurrence, not just the first: a contract repeats "Hired Date" and
        // "00,000.00" in several places, and leaving the later ones behind would print the
        // new value on top of the old placeholder.
        const spans: { from: number; to: number }[] = [];
        for (let i = 0; i < literals.length; i++) {
          if (spans.some((sp) => i >= sp.from && i <= sp.to)) continue;
          let joined = "";
          for (let j = i; j < literals.length && j < i + 80; j++) {
            joined += literals[j].text;
            const seen = normalize(joined);
            if (seen === target) {
              spans.push({ from: i, to: j });
              erased.add(phrase);
              i = j;
              break;
            }
            if (seen.length > target.length) break;
          }
        }
        // Emptied from the last span backwards so the earlier offsets stay valid.
        for (const span of spans.reverse()) {
          for (let k = span.to; k >= span.from; k--) {
            const empty = literals[k].hex ? "<>" : "()";
            out = out.slice(0, literals[k].start) + empty + out.slice(literals[k].end);
          }
        }
      }
      return out;
    });
    if (edited.some((t, i) => t !== texts[i])) writeContents(pdf, refs, edited);
  }
  return erased;
}

/** Turns the bytes a string holds into the characters the reader sees. */
type Decoder = (raw: string) => string;

/**
 * Reads a font's ToUnicode CMap: what each code in a string it is set in actually says.
 *
 * A composite font does not store characters at all. The amount cells of the contract are
 * set in one, and hold `<0013>` where the page reads "0" — so matched against text they
 * look like nothing at all, and the placeholder can neither be found nor taken out. The
 * CMap the file carries for its own copy-and-paste is exactly the table needed to read
 * them back.
 */
function parseToUnicode(cmap: string): Decoder | null {
  const codes = new Map<number, string>();
  let width = 0;

  const chars = (hex: string) => {
    let out = "";
    for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  };

  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const [, src, dst] of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      width = width || src.length / 2;
      codes.set(parseInt(src, 16), chars(dst));
    }
  }
  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const [, lo, hi, single, list] of block.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g
    )) {
      width = width || lo.length / 2;
      const from = parseInt(lo, 16);
      const to = Math.min(parseInt(hi, 16), from + 0xffff);
      if (single !== undefined) {
        const base = parseInt(single, 16);
        for (let c = from; c <= to; c++) codes.set(c, String.fromCharCode(base + (c - from)));
      } else if (list !== undefined) {
        const items = [...list.matchAll(/<([0-9A-Fa-f]+)>/g)];
        items.forEach((item, i) => codes.set(from + i, chars(item[1])));
      }
    }
  }
  if (codes.size === 0) return null;

  const bytes = width === 2 ? 2 : 1;
  return (raw: string) => {
    let out = "";
    for (let i = 0; i + bytes - 1 < raw.length; i += bytes) {
      let code = 0;
      for (let b = 0; b < bytes; b++) code = (code << 8) | (raw.charCodeAt(i + b) & 0xff);
      out += codes.get(code) ?? "";
    }
    return out;
  };
}

/** A decoder for each font a page names, for the fonts that need one. */
async function pageDecoders(pdf: PDFDocument, page: PDFPage): Promise<Map<string, Decoder>> {
  const { PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const decoders = new Map<string, Decoder>();
  const resources = page.node.get(PDFName.of("Resources"));
  const dict = resources && pdf.context.lookup(resources);
  if (!(dict instanceof PDFDict)) return decoders;
  const fontsRef = dict.get(PDFName.of("Font"));
  const fonts = fontsRef && pdf.context.lookup(fontsRef);
  if (!(fonts instanceof PDFDict)) return decoders;

  for (const [name, ref] of fonts.entries()) {
    const font = pdf.context.lookup(ref);
    if (!(font instanceof PDFDict)) continue;
    // A simple font's bytes are already the characters; only a composite one needs reading.
    if (String(font.get(PDFName.of("Subtype"))) !== "/Type0") continue;
    const mapRef = font.get(PDFName.of("ToUnicode"));
    const stream = mapRef && pdf.context.lookup(mapRef);
    if (!(stream instanceof PDFRawStream)) continue;
    try {
      const bytes = decodePDFRawStream(stream).decode();
      let text = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const decoder = parseToUnicode(text);
      if (decoder) decoders.set(String(name).replace(/^\//, ""), decoder);
    } catch {
      // Unreadable: the font is left as raw bytes, and its text simply will not match.
    }
  }
  return decoders;
}

/**
 * The strings a content stream actually prints, in the order it prints them.
 *
 * `scanStrings` finds every string in the stream, and a stream holds more than text: Word
 * tags each run of body copy with its language, so `/Lang (en-US)` markers sit between the
 * words and would otherwise be read as part of the sentence. Only the operands of the
 * text-showing operators count, so those are the ones picked out here — each read back
 * through the font it is set in.
 */
function textStrings(
  stream: string,
  decoders: Map<string, Decoder>
): { start: number; end: number; text: string; hex: boolean }[] {
  const all = scanStrings(stream);
  if (all.length === 0) return [];

  /** True where the stream is inside a string, so operators found there are not operators. */
  const inString = (at: number) => {
    let lo = 0;
    let hi = all.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (at < all[mid].start) hi = mid - 1;
      else if (at >= all[mid].end) lo = mid + 1;
      else return true;
    }
    return false;
  };

  const showing = new Set<number>();
  // Tj and ' and " take the string just before them; TJ takes every string in the array
  // that precedes it. Anything else — a marked-content property, an XObject name — is not
  // text and is left where it is.
  const operators = /(?<![A-Za-z0-9])(TJ|Tj|'|")(?![A-Za-z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = operators.exec(stream)) !== null) {
    const at = match.index;
    if (inString(at)) continue;
    let last = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].end <= at) {
        last = i;
        break;
      }
    }
    if (last < 0) continue;
    if (match[1] !== "TJ") {
      showing.add(last);
      continue;
    }
    // Back to the "[" that opened the array, taking the strings on the way.
    const open = stream.lastIndexOf("[", at);
    if (open < 0) continue;
    for (let i = last; i >= 0 && all[i].start > open; i--) showing.add(i);
  }

  if (decoders.size === 0) return [...showing].sort((a, b) => a - b).map((i) => all[i]);

  // Which font was selected where, so each string is read with the right table.
  const selections: { at: number; font: string }[] = [];
  const tf = /\/([^\s/<>[\]()]+)\s+[\d.-]+\s+Tf/g;
  let pick: RegExpExecArray | null;
  while ((pick = tf.exec(stream)) !== null) {
    if (!inString(pick.index)) selections.push({ at: pick.index, font: pick[1] });
  }

  return [...showing]
    .sort((a, b) => a - b)
    .map((i) => {
      const string = all[i];
      let font = "";
      for (const selection of selections) {
        if (selection.at > string.start) break;
        font = selection.font;
      }
      const decoder = decoders.get(font);
      return decoder ? { ...string, text: decoder(string.text) } : string;
    });
}

/**
 * Compares text by its letters and digits alone.
 *
 * The same sentence is spelled differently inside the file than a text extractor reports
 * it: the stream positions words with operators rather than spaces, and writes punctuation
 * in the font's own encoding — an en dash is one byte there and U+2013 to the extractor.
 * Letters and digits survive both, and a whole line of them is specific enough to identify
 * without help from the rest.
 */
const letters = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");

/**
 * Deletes exactly the strings that print each given line of a page.
 *
 * `erasePhrases` matches a phrase against whole content-stream strings, so a placeholder
 * sitting inside a longer string — "00,000.00" in a table cell, "Address" in "Address:
 * Address" — is never found, and the old value stays printed under the new one. This takes
 * a line of text as the reader sees it and removes the strings that produced it, so the
 * caller can set the line again with the value substituted in.
 *
 * Lines are given in groups, and a group is erased only if every line in it was found:
 * a paragraph half deleted and not rewritten would silently lose a sentence, which is far
 * worse than leaving a placeholder on show. Each group claims the strings it consumes, so
 * a line that occurs twice on a page — the two amount cells — is erased once per request,
 * in document order.
 *
 * Returns, for each group in the order given, whether it was erased.
 */
export async function eraseLines(
  pdf: PDFDocument,
  pageIndex: number,
  groups: string[][]
): Promise<boolean[]> {
  const page = pdf.getPages()[pageIndex];
  if (!page) return groups.map(() => false);
  const { refs, texts } = await readContents(pdf, page);

  const decoders = await pageDecoders(pdf, page);
  const scans = texts.map((t) => textStrings(t, decoders));
  const claimed = texts.map(() => new Set<number>());
  const cuts: { stream: number; index: number }[] = [];
  const done = groups.map(() => false);

  /** The strings that print `line`, or null; nothing is claimed until the group is whole. */
  const locate = (line: string, taken: Set<number>[]) => {
    const target = letters(line);
    if (!target) return null;
    // The punctuation at either end of a line carries no letters to match on, and Word
    // often gives it a string of its own — the full stop that closes a sentence, the
    // bracket that closes "(What Reason)". Those strings are taken in as well, or they
    // would be the one fragment of the placeholder left showing.
    const head = line.slice(0, line.search(/[A-Za-z0-9]/)).replace(/\s+/g, "");
    const tail = line.slice(line.length - (/[^A-Za-z0-9]*$/.exec(line)?.[0].length ?? 0)).replace(/\s+/g, "");

    const free = (s: number, i: number) =>
      i >= 0 && i < scans[s].length && !claimed[s].has(i) && !taken[s].has(i);
    /** Walks outwards over strings with no letters, while they spell out `edge`. */
    const extend = (s: number, at: number, step: -1 | 1, edge: string) => {
      let last = at;
      let spelt = "";
      for (let i = at + step; free(s, i); i += step) {
        const text = scans[s][i].text.replace(/\s+/g, "");
        if (letters(text)) break;
        spelt = step < 0 ? text + spelt : spelt + text;
        if (!(step < 0 ? edge.endsWith(spelt) : edge.startsWith(spelt))) break;
        last = i;
        if (spelt === edge) break;
      }
      return last;
    };

    for (let s = 0; s < scans.length; s++) {
      const strings = scans[s];
      for (let start = 0; start < strings.length; start++) {
        if (!free(s, start)) continue;
        if (!letters(strings[start].text)) continue;
        let joined = "";
        for (let end = start; end < strings.length && end < start + 400; end++) {
          if (!free(s, end)) break;
          joined += letters(strings[end].text);
          if (joined === target) {
            return {
              stream: s,
              from: head ? extend(s, start, -1, head) : start,
              to: tail ? extend(s, end, 1, tail) : end,
            };
          }
          if (joined.length >= target.length) break;
          if (!target.startsWith(joined)) break;
        }
      }
    }
    return null;
  };

  // Longest first, so a short line cannot claim strings that a longer one needs.
  const order = groups
    .map((lines, i) => ({ lines, i }))
    .sort((a, b) => b.lines.join("").length - a.lines.join("").length);

  for (const { lines, i } of order) {
    const taken = texts.map(() => new Set<number>());
    const spans: { stream: number; from: number; to: number }[] = [];
    let whole = true;
    for (const line of lines) {
      const span = locate(line, taken);
      if (!span) {
        whole = false;
        break;
      }
      for (let k = span.from; k <= span.to; k++) taken[span.stream].add(k);
      spans.push(span);
    }
    if (!whole) continue;
    for (const span of spans) {
      for (let k = span.from; k <= span.to; k++) {
        claimed[span.stream].add(k);
        cuts.push({ stream: span.stream, index: k });
      }
    }
    done[i] = true;
  }

  if (cuts.length === 0) return done;
  const edited = [...texts];
  // Back to front within each stream, so earlier offsets are untouched by later edits.
  for (const cut of cuts.sort((a, b) => b.index - a.index)) {
    const str = scans[cut.stream][cut.index];
    const empty = str.hex ? "<>" : "()";
    edited[cut.stream] =
      edited[cut.stream].slice(0, str.start) + empty + edited[cut.stream].slice(str.end);
  }
  writeContents(pdf, refs, edited);
  return done;
}

/** A ruled line of a table, in PDF points. */
export type TableRule = { x0: number; y0: number; x1: number; y1: number };

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * The vertical rules of a page's tables, which is what tells the filler where one cell
 * ends and the next begins. Word draws them as thin filled rectangles, so the content
 * stream is walked for `re` operators with the current transformation applied — a label's
 * own cell is often much wider than its text, and without the rules a value placed "just
 * after the label" lands inside the label's cell rather than the one next to it.
 */
export async function findRules(
  pdf: PDFDocument,
  pageIndex: number
): Promise<{ vertical: TableRule[]; horizontal: TableRule[] }> {
  const page = pdf.getPages()[pageIndex];
  if (!page) return { vertical: [], horizontal: [] };
  const { texts } = await readContents(pdf, page);

  const rules: TableRule[] = [];
  const horizontals: TableRule[] = [];
  for (const stream of texts) {
    let ctm: Matrix = [...IDENTITY] as Matrix;
    const stack: Matrix[] = [];
    const operands: number[] = [];
    // Points of the path being built, already in page coordinates. A rule may be drawn
    // as a rectangle operator or, as pdf-lib does, as four line segments — so the path is
    // collected either way and measured when it is painted.
    let path: [number, number][] = [];

    const tokens = stream.match(/-?\d*\.?\d+|[A-Za-z*'"]+/g) || [];
    for (const token of tokens) {
      if (/^-?\d*\.?\d+$/.test(token)) {
        operands.push(Number(token));
        if (operands.length > 8) operands.shift();
        continue;
      }
      switch (token) {
        case "q":
          stack.push([...ctm] as Matrix);
          break;
        case "Q":
          ctm = (stack.pop() || [...IDENTITY]) as Matrix;
          break;
        case "cm":
          if (operands.length >= 6) ctm = multiply(operands.slice(-6) as Matrix, ctm);
          break;
        case "m":
        case "l":
          if (operands.length >= 2) {
            const [x, y] = operands.slice(-2);
            path.push(apply(ctm, x, y));
          }
          break;
        case "re":
          if (operands.length >= 4) {
            const [x, y, w, h] = operands.slice(-4);
            path.push(apply(ctm, x, y));
            path.push(apply(ctm, x + w, y + h));
          }
          break;
        case "f":
        case "f*":
        case "F":
        case "B":
        case "B*":
        case "b":
        case "b*": {
          if (path.length >= 2) {
            const xs = path.map((pt) => pt[0]);
            const ys = path.map((pt) => pt[1]);
            const x0 = Math.min(...xs);
            const x1 = Math.max(...xs);
            const y0 = Math.min(...ys);
            const y1 = Math.max(...ys);
            // Thin and tall: a vertical rule rather than a cell fill or a shaded band.
            // Thin and tall is a vertical rule; wide and thin is a horizontal one. Either
            // way it is a cell edge; anything else is a fill or a shaded band.
            if (x1 - x0 <= 3 && y1 - y0 >= 5) rules.push({ x0, y0, x1, y1 });
            else if (y1 - y0 <= 3 && x1 - x0 >= 5) horizontals.push({ x0, y0, x1, y1 });
          }
          path = [];
          break;
        }
        case "n":
        case "S":
        case "s":
          path = [];
          break;
      }
      if (/^[A-Za-z*'"]+$/.test(token)) operands.length = 0;
    }
  }
  return { vertical: rules, horizontal: horizontals };
}

/** Just the vertical rules, for callers that only need cell edges left and right. */
export async function findVerticalRules(pdf: PDFDocument, pageIndex: number): Promise<TableRule[]> {
  return (await findRules(pdf, pageIndex)).vertical;
}

/** A rectangle of the page, in PDF points. */
export type Zone = { x0: number; y0: number; x1: number; y1: number };

/**
 * Takes the underline out from under text that has been erased.
 *
 * A Word highlight is a fill and comes off with the colour, but an underline is a rule
 * drawn separately from the words above it, so deleting the placeholder's glyphs leaves
 * its underline behind — ruled to the length of the words that are gone and ending in the
 * middle of the ones that replace them. Only rules lying in the band a baseline occupies
 * are taken, so a table's own borders, which sit outside it, stay where they are.
 *
 * The paint operator is turned into `n`, which ends the path without marking the page, and
 * is written over the same number of bytes so every other offset into the stream still
 * holds.
 */
export async function removeUnderlines(
  pdf: PDFDocument,
  pageIndex: number,
  zones: Zone[]
): Promise<number> {
  const page = pdf.getPages()[pageIndex];
  if (!page || zones.length === 0) return 0;
  const { refs, texts } = await readContents(pdf, page);

  let removed = 0;
  const edited = texts.map((stream) => {
    let ctm: Matrix = [...IDENTITY] as Matrix;
    const stack: Matrix[] = [];
    const operands: number[] = [];
    let path: [number, number][] = [];
    const drop: { at: number; length: number }[] = [];

    const token = /-?\d*\.?\d+|[A-Za-z*'"]+/g;
    let match: RegExpExecArray | null;
    while ((match = token.exec(stream)) !== null) {
      const text = match[0];
      if (/^-?\d*\.?\d+$/.test(text)) {
        operands.push(Number(text));
        if (operands.length > 8) operands.shift();
        continue;
      }
      switch (text) {
        case "q":
          stack.push([...ctm] as Matrix);
          break;
        case "Q":
          ctm = (stack.pop() || [...IDENTITY]) as Matrix;
          break;
        case "cm":
          if (operands.length >= 6) ctm = multiply(operands.slice(-6) as Matrix, ctm);
          break;
        case "m":
        case "l":
          if (operands.length >= 2) path.push(apply(ctm, ...(operands.slice(-2) as [number, number])));
          break;
        case "re":
          if (operands.length >= 4) {
            const [x, y, w, h] = operands.slice(-4);
            path.push(apply(ctm, x, y));
            path.push(apply(ctm, x + w, y + h));
          }
          break;
        case "f":
        case "f*":
        case "F":
        case "B":
        case "B*":
        case "b":
        case "b*": {
          if (path.length >= 2) {
            const xs = path.map((p) => p[0]);
            const ys = path.map((p) => p[1]);
            const rule = {
              x0: Math.min(...xs),
              x1: Math.max(...xs),
              y0: Math.min(...ys),
              y1: Math.max(...ys),
            };
            const thin = rule.y1 - rule.y0 <= 2.5 && rule.x1 - rule.x0 >= 2;
            if (
              thin &&
              zones.some(
                (z) =>
                  rule.x0 >= z.x0 - 2 && rule.x1 <= z.x1 + 2 && rule.y0 >= z.y0 && rule.y1 <= z.y1
              )
            ) {
              drop.push({ at: match.index, length: text.length });
              removed++;
            }
          }
          path = [];
          break;
        }
        case "n":
        case "S":
        case "s":
          path = [];
          break;
      }
      if (/^[A-Za-z*'"]+$/.test(text)) operands.length = 0;
    }

    let out = stream;
    for (const cut of drop.reverse()) {
      out = out.slice(0, cut.at) + "n".padEnd(cut.length) + out.slice(cut.at + cut.length);
    }
    return out;
  });

  if (removed) writeContents(pdf, refs, edited);
  return removed;
}



/** A column of one line: where it starts, where it ends, and which line it is on. */
export type TextColumn = { x: number; right: number; y: number };

/**
 * How far the text under a point should move up the page, and from where.
 *
 * A form reserves room for a field by leaving blank lines after it, and it has to reserve
 * enough for the longest thing anyone might type. Fill in something shorter and the unused
 * remainder is left as a hole in the middle of the page. `below` is where the reserved
 * space ended and `by` is how much of it went unused, so everything under it can be
 * brought up and the page reads continuously whatever was typed.
 */
export type TextLift = { below: number; by: number };

/** Word's bottom margin: the footer sits below it and is not part of the body text. */
const BOTTOM_MARGIN = 72;

/**
 * Sets a page's type smaller without re-typesetting it.
 *
 * Two things have to change together. The size operand of each `Tf` is scaled, which is
 * what makes the glyphs smaller — the kerning in a `TJ` array is in thousandths of an em,
 * so it comes down with them and the run simply gets narrower. But Word does not set a
 * line as one run: it starts a new one, at an absolute position, wherever the formatting
 * changes — either side of the hyphen in "Pag-IBIG", either side of a superscript "th".
 * Those keep the position they were given for the larger type, so scaling alone strands
 * each one to the right of the run it follows and opens a gap in the middle of a word.
 *
 * So every run is also brought back towards the start of its own column by the same
 * proportion. Its own column, not its line: the figure in a table's second cell has to
 * stay in that cell, and moving it towards the row's left edge would carry it out.
 *
 * Only the `1 0 0 1 x y Tm` form is touched, and only where a column is known to contain
 * it. A run positioned any other way keeps its place, which at worst leaves a gap that was
 * already there — it never moves text somewhere it does not belong.
 *
 * Returns how many sizes were scaled.
 */
export async function scaleTextRuns(
  pdf: PDFDocument,
  pageIndex: number,
  factor: number,
  columns: TextColumn[],
  lift?: TextLift
): Promise<number> {
  const page = pdf.getPages()[pageIndex];
  if (!page || (factor === 1 && !lift?.by)) return 0;
  const { refs, texts } = await readContents(pdf, page);

  /** A run sits a little outside the ink of its column: a trailing space, a superscript. */
  const SLACK = 8;
  const anchorFor = (x: number, y: number) => {
    let best: TextColumn | null = null;
    for (const column of columns) {
      if (Math.abs(column.y - y) > 2.5) continue;
      if (x < column.x - 1 || x > column.right + SLACK) continue;
      // The narrowest match, so a run inside a cell is not anchored to a wider neighbour.
      if (!best || column.right - column.x < best.right - best.x) best = column;
    }
    return best?.x ?? null;
  };

  let scaled = 0;
  const edited = texts.map((stream) => {
    const strings = scanStrings(stream);
    // A "Tf" or "Tm" inside a string is part of someone's sentence, not an operator.
    const inString = (at: number) => strings.some((s) => at >= s.start && at < s.end);

    return stream
      .replace(
        /(\/[^\s/<>[\]()]+\s+)(\d*\.?\d+)(\s+Tf)/g,
        (whole, head: string, size: string, tail: string, at: number) => {
          if (inString(at)) return whole;
          const next = Number(size) * factor;
          if (!Number.isFinite(next) || next <= 0) return whole;
          scaled++;
          return `${head}${Number(next.toFixed(2))}${tail}`;
        }
      )
      .replace(
        /1 0 0 1 (-?\d*\.?\d+) (-?\d*\.?\d+) Tm/g,
        (whole, xs: string, ys: string, at: number) => {
          if (inString(at)) return whole;
          const x = Number(xs);
          const anchor = anchorFor(x, Number(ys));
          if (anchor === null) return whole;
          const toX = anchor + (x - anchor) * factor;
          const y = Number(ys);
          // Text below the reserved space comes up to close the gap. The bottom margin is
          // the floor: the page's footer lives under it and must not move with the body.
          const toY =
            lift && lift.by > 0 && y <= lift.below && y > BOTTOM_MARGIN ? y + lift.by : y;
          return `1 0 0 1 ${Number(toX.toFixed(2))} ${Number(toY.toFixed(2))} Tm`;
        }
      );
  });

  if (scaled) writeContents(pdf, refs, edited);
  return scaled;
}
