/** Date-range helpers shared by the Reports sections. All values are `yyyy-MM-dd`. */

export type RangePreset = "day" | "week" | "month" | "year" | "custom";

export function dayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function rangeFor(preset: RangePreset, base: Date): { start: string; end: string } {
  if (preset === "day") return { start: dayISO(base), end: dayISO(base) };
  if (preset === "week") {
    const weekday = base.getDay();
    const monday = new Date(base);
    monday.setDate(base.getDate() + ((weekday === 0 ? -6 : 1) - weekday));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: dayISO(monday), end: dayISO(sunday) };
  }
  if (preset === "month") {
    return {
      start: dayISO(new Date(base.getFullYear(), base.getMonth(), 1)),
      end: dayISO(new Date(base.getFullYear(), base.getMonth() + 1, 0)),
    };
  }
  return {
    start: dayISO(new Date(base.getFullYear(), 0, 1)),
    end: dayISO(new Date(base.getFullYear(), 11, 31)),
  };
}

export function inRange(iso: string, start: string, end: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= start && d <= end;
}

/** Date an employee hits a months-of-service milestone, given their hire date. */
export function milestoneDate(dateHired: string, months: number): string {
  const d = new Date(dateHired);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}
