import type JSZip from "jszip";
import type { PDFDocument } from "pdf-lib";

/**
 * The Realcognita letterhead ("Realcognita Template.pdf"): the logo and contact strip
 * across the top of every page, the green address bar across the bottom. Both images were
 * taken straight from that PDF and live in public/letterhead/.
 *
 * Every generated letter and form goes through one of the two functions here as its last
 * step, so the letterhead is the same everywhere and changing it again means replacing
 * those two images. The old letterhead — a full-page background picture — is removed.
 */
const HEADER_URL = "/letterhead/header.png";
const FOOTER_URL = "/letterhead/footer.png";
/** Height ÷ width of each image (2001×353 and 2001×117 pixels). */
const HEADER_RATIO = 353 / 2000;
const FOOTER_RATIO = 117 / 2001;
/** Space kept between the pictures and the text, in twips (1/20 pt). */
const HEADER_GAP = 120;
const FOOTER_GAP = 160;

let imagesPromise: Promise<{ header: Uint8Array; footer: Uint8Array }> | null = null;

function letterheadImages() {
  if (!imagesPromise) {
    imagesPromise = Promise.all([HEADER_URL, FOOTER_URL].map((u) => fetch(u).then((r) => r.arrayBuffer())))
      .then(([header, footer]) => ({ header: new Uint8Array(header), footer: new Uint8Array(footer) }))
      .catch((err) => {
        imagesPromise = null;
        throw err;
      });
  }
  return imagesPromise;
}

/* ------------------------------------------------------------------ Word (.docx) */

const EMU_PER_TWIP = 635;
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_IMAGE = `${R_NS}/image`;
const REL_HEADER = `${R_NS}/header`;
const REL_FOOTER = `${R_NS}/footer`;
const CT_HEADER = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const CT_FOOTER = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";

/** Every element `tag` (with whatever it contains, nesting included), as [start, end) spans. */
function elementSpans(xml: string, tag: string): [number, number][] {
  const spans: [number, number][] = [];
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "g");
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const start = m.index;
    const firstClose = xml.indexOf(">", start);
    if (xml[firstClose - 1] === "/") {
      spans.push([start, firstClose + 1]);
      continue;
    }
    let depth = 1;
    let i = firstClose + 1;
    const scan = new RegExp(`<${tag}(?=[\\s>/])|</${tag}>`, "g");
    scan.lastIndex = i;
    let s: RegExpExecArray | null;
    while (depth > 0 && (s = scan.exec(xml))) {
      if (s[0].startsWith("</")) depth--;
      else if (xml[xml.indexOf(">", s.index) - 1] !== "/") depth++;
      i = s.index + s[0].length;
    }
    spans.push([start, i]);
    open.lastIndex = i;
  }
  return spans;
}

function removeSpans(xml: string, spans: [number, number][]): string {
  return [...spans].sort((a, b) => b[0] - a[0]).reduce((x, [a, b]) => x.slice(0, a) + x.slice(b), xml);
}

/** Drops every picture and drawn shape (the old letterhead) from a header or footer part. */
function stripGraphics(xml: string): string {
  for (const tag of ["mc:AlternateContent", "w:drawing", "w:pict"]) xml = removeSpans(xml, elementSpans(xml, tag));
  return xml;
}

/** True for a picture behind the text covering most of the page: the old letterhead. */
function isPageBackground(fragment: string, pageW: number, pageH: number): boolean {
  if (!/behindDoc="1"/.test(fragment)) return false;
  const ext = fragment.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
  return !!ext && +ext[1] >= pageW * 0.8 && +ext[2] >= pageH * 0.5;
}

let drawingId = 9100;
function anchorRun(rId: string, cx: number, cy: number, y: number): string {
  const id = drawingId++;
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="Letterhead ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="letterhead"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

function ensureNamespaces(xml: string, rootTag: string): string {
  return xml.replace(new RegExp(`<${rootTag}(\\s[^>]*)?>`), (root) => {
    let r = root;
    for (const [prefix, ns] of [["w", W_NS], ["r", R_NS], ["wp", WP_NS]] as const) {
      if (!new RegExp(`xmlns:${prefix}=`).test(r)) r = r.replace(/>$/, ` xmlns:${prefix}="${ns}">`);
    }
    return r;
  });
}

/** Puts the letterhead picture into the first paragraph of a header or footer part. */
function withPicture(xml: string, rootTag: "w:hdr" | "w:ftr", run: string): string {
  xml = ensureNamespaces(stripGraphics(xml), rootTag);
  const p = xml.match(/<w:p(?:\s[^>]*)?>(?:<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>)?/);
  if (p && p.index !== undefined) return xml.slice(0, p.index + p[0].length) + run + xml.slice(p.index + p[0].length);
  return xml.replace(`</${rootTag}>`, `<w:p>${run}</w:p></${rootTag}>`);
}

async function addRelationship(zip: JSZip, relsPath: string, type: string, target: string): Promise<string> {
  const existing = (await zip.file(relsPath)?.async("text")) ||
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const found = existing.match(new RegExp(`<Relationship [^>]*Id="([^"]+)"[^>]*Target="${target.replace(/[.]/g, "\\.")}"[^>]*/>`));
  if (found) return found[1];
  let n = 1;
  while (existing.includes(`Id="rIdLh${n}"`)) n++;
  const id = `rIdLh${n}`;
  zip.file(relsPath, existing.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`));
  return id;
}

const relsPathFor = (part: string) => part.replace(/^word\//, "word/_rels/") + ".rels";

/**
 * Replaces the letterhead of a Word document in place: header and footer pictures on
 * every page, the old full-page background removed, and the top and bottom margins
 * widened only as far as needed so the text never runs under the new pictures.
 */
export async function applyLetterheadToDocx(zip: JSZip): Promise<void> {
  const { header, footer } = await letterheadImages();
  zip.file("word/media/letterhead-header.png", header);
  zip.file("word/media/letterhead-footer.png", footer);

  let types = await zip.file("[Content_Types].xml")!.async("text");
  for (const [ext, ct] of [["jpg", "image/jpeg"], ["png", "image/png"]]) {
    if (!new RegExp(`Extension="${ext}"`, "i").test(types)) {
      types = types.replace("</Types>", `<Default Extension="${ext}" ContentType="${ct}"/></Types>`);
    }
  }

  const docPath = "word/document.xml";
  let doc = await zip.file(docPath)!.async("text");
  const docRels = relsPathFor(docPath);
  const relsXml = (await zip.file(docRels)?.async("text")) || "";
  const targetOf = (rId: string) =>
    relsXml.match(new RegExp(`<Relationship [^>]*Id="${rId}"[^>]*Target="([^"]+)"`))?.[1] ||
    relsXml.match(new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rId}"`))?.[1];
  const evenAndOdd = /<w:evenAndOddHeaders(?:\s[^>]*)?\/>/.test((await zip.file("word/settings.xml")?.async("text")) || "");

  const sections = [...doc.matchAll(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/g)];
  const first = sections[0]?.[0] || "";
  const pageW = +(first.match(/<w:pgSz [^>]*w:w="(\d+)"/)?.[1] || 11906);
  const pageH = +(first.match(/<w:pgSz [^>]*w:h="(\d+)"/)?.[1] || 16838);
  const cx = pageW * EMU_PER_TWIP;
  const headerCy = Math.round(cx * HEADER_RATIO);
  const footerCy = Math.round(cx * FOOTER_RATIO);
  const headerTwips = Math.ceil(headerCy / EMU_PER_TWIP);
  const footerTwips = Math.ceil(footerCy / EMU_PER_TWIP);

  // The old letterhead, when it sits in the body as a full-page picture behind the text.
  const bg: [number, number][] = [];
  for (const tag of ["mc:AlternateContent", "w:drawing"]) {
    for (const [a, b] of elementSpans(doc, tag)) {
      if (bg.some(([x, y]) => a >= x && b <= y)) continue;
      if (isPageBackground(doc.slice(a, b), cx, pageH * EMU_PER_TWIP)) bg.push([a, b]);
    }
  }
  doc = removeSpans(doc, bg);

  // Header and footer parts every section uses, plus a new one where a kind is missing.
  const partsDone = new Set<string>();
  let created: { header?: string; footer?: string } = {};
  async function decorate(part: string, kind: "header" | "footer") {
    if (partsDone.has(part)) return;
    partsDone.add(part);
    const rId = await addRelationship(
      zip,
      relsPathFor(part),
      REL_IMAGE,
      kind === "header" ? "media/letterhead-header.png" : "media/letterhead-footer.png"
    );
    const run =
      kind === "header"
        ? anchorRun(rId, cx, headerCy, 0)
        : anchorRun(rId, cx, footerCy, pageH * EMU_PER_TWIP - footerCy);
    const xml = (await zip.file(part)?.async("text")) ||
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="${W_NS}"><w:p/></w:${kind === "header" ? "hdr" : "ftr"}>`;
    // White footer text (page numbers) was made for the old dark footer; on the white page
    // just above the new green bar it would vanish, so it turns dark grey.
    const readable =
      kind === "footer" ? xml.replace(/<w:color w:val="FFFFFF"[^>]*\/>/gi, '<w:color w:val="595959"/>') : xml;
    zip.file(part, withPicture(readable.replace(/<w:p\/>/, "<w:p></w:p>"), kind === "header" ? "w:hdr" : "w:ftr", run));
  }
  async function newPart(kind: "header" | "footer"): Promise<string> {
    if (created[kind]) return created[kind]!;
    const part = `word/${kind}_letterhead.xml`;
    await decorate(part, kind);
    types = types.replace(
      "</Types>",
      `<Override PartName="/${part}" ContentType="${kind === "header" ? CT_HEADER : CT_FOOTER}"/></Types>`
    );
    const rId = await addRelationship(zip, docRels, kind === "header" ? REL_HEADER : REL_FOOTER, `${kind}_letterhead.xml`);
    created = { ...created, [kind]: rId };
    return rId;
  }

  // Blank lines at the top of the page were spacing to clear the old letterhead. The taller
  // margin below does that job now, so as many of them as that extra margin covers go.
  const oldTop = +(first.match(/<w:pgMar [^>]*w:top="(\d+)"/)?.[1] || 1440);
  let toTrim = Math.max(0, headerTwips + HEADER_GAP - oldTop);
  const body = doc.match(/<w:body>/);
  if (body?.index !== undefined && toTrim > 0) {
    const at = body.index + body[0].length;
    for (;;) {
      const p = doc.slice(at).match(/^<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/);
      if (!p || /<w:t[\s>]|<w:drawing|<w:pict|<w:sectPr|<w:fldChar|<w:instrText|<w:br /.test(p[0])) break;
      const sz = +(p[0].match(/<w:sz w:val="(\d+)"/)?.[1] || 22);
      const spacing = +(p[0].match(/<w:spacing [^>]*w:after="(\d+)"/)?.[1] || 0) + +(p[0].match(/<w:spacing [^>]*w:before="(\d+)"/)?.[1] || 0);
      const height = Math.round(sz * 10 * 1.15) + spacing;
      if (height > toTrim) break;
      doc = doc.slice(0, at) + doc.slice(at + p[0].length);
      toTrim -= height;
    }
  }

  let rebuilt = doc;
  for (const match of [...rebuilt.matchAll(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/g)].reverse()) {
    let sect = match[0];
    const kinds: ("default" | "first" | "even")[] = ["default"];
    if (/<w:titlePg(?:\s[^>]*)?\/>/.test(sect) && !/<w:titlePg w:val="(?:0|false)"/.test(sect)) kinds.push("first");
    if (evenAndOdd) kinds.push("even");
    for (const kind of ["header", "footer"] as const) {
      for (const ref of sect.matchAll(new RegExp(`<w:${kind}Reference [^>]*r:id="([^"]+)"[^>]*/>`, "g"))) {
        const target = targetOf(ref[1]);
        if (target) await decorate(`word/${target.replace(/^\/?word\//, "")}`, kind);
      }
      for (const type of kinds) {
        if (new RegExp(`<w:${kind}Reference [^>]*w:type="${type}"`).test(sect)) continue;
        const rId = await newPart(kind);
        sect = sect.replace(/^<w:sectPr(?:\s[^>]*)?>/, (open) => `${open}<w:${kind}Reference w:type="${type}" r:id="${rId}"/>`);
      }
    }
    // Room for the pictures: text starts below the header and ends above the footer.
    sect = sect.replace(/<w:pgMar ([^>]*)\/>/, (tag, attrs: string) => {
      const get = (n: string) => +(attrs.match(new RegExp(`w:${n}="(-?\\d+)"`))?.[1] || 0);
      const set = (s: string, n: string, v: number) =>
        new RegExp(`w:${n}="`).test(s) ? s.replace(new RegExp(`w:${n}="-?\\d+"`), `w:${n}="${v}"`) : `${s} w:${n}="${v}"`;
      let a = attrs.trim();
      a = set(a, "top", Math.max(get("top"), headerTwips + HEADER_GAP));
      a = set(a, "bottom", Math.max(get("bottom"), footerTwips + FOOTER_GAP));
      // Footer text (page numbers) sits just above the green bar, not on it.
      a = set(a, "footer", Math.max(get("footer"), footerTwips + 60));
      return `<w:pgMar ${a}/>`;
    });
    rebuilt = rebuilt.slice(0, match.index!) + sect + rebuilt.slice(match.index! + match[0].length);
  }
  zip.file(docPath, ensureNamespaces(rebuilt, "w:document"));
  zip.file("[Content_Types].xml", types);
}

/** applyLetterheadToDocx for a finished .docx Blob (documents built with the docx library). */
export async function withLetterhead(blob: Blob): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(blob);
  await applyLetterheadToDocx(zip);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/* ------------------------------------------------------------------ PDF */

const latin1Decode = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};
const latin1Encode = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/**
 * The same letterhead on every page of a finished PDF (the Temporary Contract): the old
 * full-page background picture is taken out, the page's content moves down a little so it
 * clears the taller header, and the new header and footer are drawn on top.
 */
export async function applyLetterheadToPdf(pdf: PDFDocument): Promise<void> {
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const { header, footer } = await letterheadImages();
  const headerImg = await pdf.embedPng(header);
  const footerImg = await pdf.embedPng(footer);

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    // Take out any picture drawn over most of the page: that is the old letterhead.
    const contents = page.node.Contents();
    const refs =
      contents instanceof PDFArray
        ? contents.asArray()
        : page.node.get(PDFName.of("Contents"))
          ? [page.node.get(PDFName.of("Contents"))!]
          : [];
    const newRefs = refs.map((ref) => {
      const stream = pdf.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return ref;
      const text = latin1Decode(decodePDFRawStream(stream).decode());
      const cleaned = text.replace(
        /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm\s*(\/[^\s/]+)\s+Do/g,
        (all, a: string, _b: string, _c: string, d: string, ...rest: unknown[]) => {
          const name = rest[2] as string;
          return +a >= width * 0.8 && +d >= height * 0.5 ? `${all.slice(0, all.lastIndexOf(name))}` : all;
        }
      );
      if (cleaned === text) return ref;
      return pdf.context.register(pdf.context.flateStream(latin1Encode(cleaned)));
    });
    const headerH = width * HEADER_RATIO;
    const footerH = width * FOOTER_RATIO;
    // The page's own content moves down far enough for its title to clear the taller
    // header (the template leaves room at the bottom); the letterhead is drawn after it,
    // outside that move, so it sits exactly on the page edges. Written by hand because
    // pdf-lib's translateContent also moves anything drawn later on the same page.
    const headerName = page.node.newXObject("LhHeader", headerImg.ref);
    const footerName = page.node.newXObject("LhFooter", footerImg.ref);
    const raw = (text: string) => pdf.context.register(pdf.context.flateStream(latin1Encode(text)));
    const n = (v: number) => v.toFixed(3);
    page.node.set(
      PDFName.of("Contents"),
      pdf.context.obj([
        raw("q 1 0 0 1 0 -30 cm\n"),
        ...newRefs,
        raw("\nQ\n"),
        raw(
          `q ${n(width)} 0 0 ${n(headerH)} 0 ${n(height - headerH)} cm ${headerName.toString()} Do Q\n` +
            `q ${n(width)} 0 0 ${n(footerH)} 0 0 cm ${footerName.toString()} Do Q\n`
        ),
      ])
    );
  }
}
