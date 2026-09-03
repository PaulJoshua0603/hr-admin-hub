import {
  differenceInCalendarDays,
  addDays,
  addMonths,
  format,
  isPast,
  isToday,
  parseISO,
} from "date-fns";

export function todayISO(): string {
  return new Date().toISOString();
}

export function addDaysISO(iso: string, days: number): string {
  return addDays(parseISO(iso), days).toISOString();
}

export function addMonthsISO(iso: string, months: number): string {
  return addMonths(parseISO(iso), months).toISOString();
}

export function daysSince(iso: string): number {
  return differenceInCalendarDays(new Date(), parseISO(iso));
}

export function daysUntil(iso: string): number {
  return differenceInCalendarDays(parseISO(iso), new Date());
}

export function formatDate(iso: string, pattern = "MMM d, yyyy"): string {
  return format(parseISO(iso), pattern);
}

export function isOverdue(iso: string): boolean {
  return isPast(parseISO(iso)) && !isToday(parseISO(iso));
}

export function isDueToday(iso: string): boolean {
  return isToday(parseISO(iso));
}

// Returns the ISO date of the next upcoming Monday (today if today is Monday).
export function nextMondayISO(fromISO?: string): string {
  const base = fromISO ? parseISO(fromISO) : new Date();
  const day = base.getDay(); // 0 = Sun ... 6 = Sat
  const diff = (1 - day + 7) % 7;
  return addDays(base, diff).toISOString();
}
