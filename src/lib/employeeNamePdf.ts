/**
 * The folder label: one employee's name, set large enough to read off a filing cabinet.
 *
 * It goes on the white long folder — the first item on the onboarding task list — so the
 * only thing it has to say is who the folder belongs to, in the order a filing system
 * wants it: surname first, then given names, then the middle initial.
 */
import type { Employee } from "@/types";

/** A middle name is shown as one letter and a full stop, as the filing format wants. */
function middleInitial(middle: string): string {
  const letter = middle.trim().replace(/[^\p{L}]/gu, "").charAt(0);
  return letter ? `${letter.toUpperCase()}.` : "";
}

/**
 * Surname, first name(s), and middle initial, worked out from whatever the record has.
 *
 * The name parts captured on import are used when they are there. The handful of records
 * that predate them keep only a display name like "Rianne Megg N. Francisco", so for those
 * the surname is worked out from the name itself — the last word, except that a suffix
 * belongs to the surname ("Castillo Jr.") and so do the particles of a compound one ("San
 * Pedro III"). A single letter among what is left is the middle initial, not a given name.
 *
 * Every piece is returned exactly as cased in the source; callers that want it upper-cased
 * — the filing label, an export column — do that themselves.
 */
export function employeeNameParts(
  e: Pick<Employee, "name" | "firstName" | "middleName" | "lastName">
): { surname: string; first: string; middleInitial: string } {
  const last = (e.lastName || "").trim();
  const first = (e.firstName || "").trim();
  if (last && first) {
    return { surname: last, first, middleInitial: middleInitial(e.middleName || "") };
  }

  const parts = (e.name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: "", first: "", middleInitial: "" };
  if (parts.length === 1) return { surname: parts[0], first: "", middleInitial: "" };

  const SUFFIXES = /^(jr|sr|ii|iii|iv|v)\.?$/i;
  let cut = parts.length - 1;
  while (cut > 1 && SUFFIXES.test(parts[cut])) cut--;

  const PARTICLES = /^(de|del|dela|delos|di|da|la|las|los|san|santa|santo|sta|sto|van|von)\.?$/i;
  while (cut > 1 && PARTICLES.test(parts[cut - 1])) cut--;

  const surname = parts.slice(cut).join(" ");
  const given = parts.slice(0, cut);
  // A lone letter among the given names is the middle initial, not a name in its own right.
  const initialAt = given.findIndex((part) => /^[\p{L}]\.?$/u.test(part));
  const initial = initialAt >= 0 ? middleInitial(given[initialAt]) : "";
  const rest = given.filter((_, i) => i !== initialAt).join(" ");

  return { surname, first: rest, middleInitial: initial };
}

/** "FRANCISCO, RIANNE MEGG N." — see {@link employeeNameParts} for how each piece is found. */
export function employeeNameLabel(
  e: Pick<Employee, "name" | "firstName" | "middleName" | "lastName">
): string {
  const { surname, first, middleInitial } = employeeNameParts(e);
  if (!surname) return "";
  return [`${surname},`, first, middleInitial].filter(Boolean).join(" ").toUpperCase();
}

/** "Rianne Megg N. Francisco - Employee Name.pdf" */
export function employeeNameFileName(fullName: string): string {
  const safe = (fullName || "Employee").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${safe} - Employee Name.pdf`;
}

/** A4, which is what the office prints on. */
const PAGE = { width: 595.28, height: 841.89 };
/** The label as it is set: Arial Bold at 28 point, which Helvetica-Bold matches. */
const NAME_SIZE = 28;
/** Kept clear of the rules either side, and the floor for a name too long for 28 point. */
const NAME_PADDING = 6;
const MIN_NAME_SIZE = 12;
/** The ruled box, in points from the page edges. */
const BOX = { left: 53.5, right: 53.5, top: 53.5 };
const BORDER = 1.2;
/** The name sits in the second row; the rest are left blank to write on. */
const NAME_ROW = 1;
const ROW_HEIGHTS = [44, 44, 28, 28, 28, 28, 28, 28];

/**
 * Draws the label.
 *
 * The ruled rows are the form as it is printed today, kept so the label can go straight
 * onto the folder alongside the ones already filed. Only the name is filled in; the rest
 * are there to be written on by hand.
 */
export async function buildEmployeeNamePdf(employee: Employee): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  // Arial is not one of the fonts every PDF reader carries, and Helvetica — which is —
  // shares its metrics, so the label prints at the same size and width either way.
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  const left = BOX.left;
  const width = PAGE.width - BOX.left - BOX.right;
  const top = PAGE.height - BOX.top;
  const black = rgb(0, 0, 0);

  // Ruled as lines rather than as filled cells, so nothing prints behind the writing.
  const rule = (x: number, y: number, w: number, h: number) =>
    page.drawRectangle({ x, y, width: w, height: h, color: black });

  const total = ROW_HEIGHTS.reduce((sum, h) => sum + h, 0);
  rule(left, top - total - BORDER, width, BORDER); // bottom
  rule(left, top, width, BORDER); // top
  rule(left, top - total, BORDER, total + BORDER); // left
  rule(left + width - BORDER, top - total, BORDER, total + BORDER); // right

  let y = top;
  ROW_HEIGHTS.forEach((height, index) => {
    const bottom = y - height;
    if (index < ROW_HEIGHTS.length - 1) rule(left, bottom, width, BORDER);
    if (index === NAME_ROW) {
      const label = employeeNameLabel(employee);
      if (label) {
        // 28 point unless the name is too long for the box — a compound surname with two
        // given names can run past it, and a label that overflows its rule is worse than
        // one set a little smaller.
        let size = NAME_SIZE;
        const room = width - NAME_PADDING * 2;
        while (size > MIN_NAME_SIZE && font.widthOfTextAtSize(label, size) > room) size -= 0.5;
        // Centred across the box, on a baseline that leaves the cap height clear of the
        // rule above and the descender clear of the one below.
        const text = font.widthOfTextAtSize(label, size);
        page.drawText(label, {
          x: left + (width - text) / 2,
          y: bottom + (height - size * 0.72) / 2,
          size,
          font,
          color: black,
        });
      }
    }
    y = bottom;
  });

  return pdf.save();
}
