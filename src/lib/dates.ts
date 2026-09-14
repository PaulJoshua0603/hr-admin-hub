import {
  differenceInCalendarDays,
  addDays,
  addMonths,
  format,
  isPast,
  isToday,
  parseISO,
} from "date-fns";

/**
 * Every helper here takes a stored date string, and stored data is not always clean —
 * a legacy record, a cleared field or a bad import can hand us "" or nonsense. date-fns
 * throws RangeError on those, and a throw during render blanks the whole page, so each
 * helper fails soft instead.
 */
function safeParse(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidDateString(iso: string | null | undefined): boolean {
  return safeParse(iso) !== null;
}

export function todayISO(): string {
  return new Date().toISOString();
}

export function addDaysISO(iso: string, days: number): string {
  const d = safeParse(iso);
  return d ? addDays(d, days).toISOString() : todayISO();
}

export function addMonthsISO(iso: string, months: number): string {
  const d = safeParse(iso);
  return d ? addMonths(d, months).toISOString() : todayISO();
}

export function daysSince(iso: string): number {
  const d = safeParse(iso);
  return d ? differenceInCalendarDays(new Date(), d) : 0;
}

export function daysUntil(iso: string): number {
  const d = safeParse(iso);
  return d ? differenceInCalendarDays(d, new Date()) : 0;
}

export function formatDate(iso: string, pattern = "MMM d, yyyy"): string {
  // Dates in this app are stored as UTC-midnight timestamps representing a
  // calendar day (not a specific moment). Re-anchor to a local Date built
  // from the UTC Y/M/D components before formatting, so the displayed
  // calendar day never shifts based on the viewer's local timezone offset.
  const d = safeParse(iso);
  if (!d) return "—";
  const safe = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return format(safe, pattern);
}

export function isOverdue(iso: string): boolean {
  const d = safeParse(iso);
  return d ? isPast(d) && !isToday(d) : false;
}

export function isDueToday(iso: string): boolean {
  const d = safeParse(iso);
  return d ? isToday(d) : false;
}

// Returns the ISO date of the next upcoming Monday (today if today is Monday).
export function nextMondayISO(fromISO?: string): string {
  const base = safeParse(fromISO) || new Date();
  const day = base.getDay(); // 0 = Sun ... 6 = Sat
  const diff = (1 - day + 7) % 7;
  return addDays(base, diff).toISOString();
}

/**
 * Normalises a time to 24-hour `HH:mm` — "14:30", never the military "1430" and never
 * a 12-hour form. Pads a single-digit hour and accepts a bare "1430" typed by hand.
 * Blank or unparseable values pass through untouched.
 */
export function formatTime24(value: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  const match = /^(d{1,2}):?(d{2})/.exec(raw);
  if (!match) return raw;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || hours > 23 || minutes > 59) return raw;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/**
 * Turns a 24-hour `HH:mm` time (what `<input type="time">` stores) into 12-hour
 * display form, e.g. "17:30" -> "5:30 PM". Blank or unparseable values pass through.
 */
export function formatTime12(value: string): string {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || hours > 23 || minutes > 59) return value;
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}
