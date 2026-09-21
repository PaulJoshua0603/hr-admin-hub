/**
 * Status choices for the 6th-month evaluation note, shared by the Employees milestone
 * view and the Employee 6th-Month Report so the two can never drift apart.
 *
 * The chosen label is stored as the note text itself, which keeps notes written before
 * this dropdown existed readable. Same two choices as the 3rd month, and the same
 * "-Set Status-" default — the 6th month used to carry two extra states for chasing the
 * Head for an evaluation, which this system no longer tracks here.
 */
export const SIXTH_MONTH_NOTE_OPTIONS = ["Evaluation Submitted", "Done"] as const;

export const NOT_SET = "";
export const NOT_SET_LABEL = "-Set Status-";

/**
 * Status choices for the 3rd-month assessment. A shorter list than the 6th month's: the
 * 3rd month is a check-in, so it is either submitted or finished, with none of the
 * chasing-the-Head states that regularization needs.
 */
export const THIRD_MONTH_NOTE_OPTIONS = ["Done", "Evaluation Submitted"] as const;

export function thirdMonthNoteOptions(current: string): string[] {
  const base: string[] = [NOT_SET, ...THIRD_MONTH_NOTE_OPTIONS];
  return base.includes(current) ? base : [...base, current];
}

export function thirdMonthNoteLabels(current: string): Record<string, string> {
  const labels: Record<string, string> = { [NOT_SET]: NOT_SET_LABEL };
  THIRD_MONTH_NOTE_OPTIONS.forEach((o) => {
    labels[o] = o;
  });
  if (current && !labels[current]) labels[current] = current;
  return labels;
}

/**
 * Colouring shared by the 3rd- and 6th-month status dropdowns: green once it's done,
 * accent while it's in motion, and plain for anything else — including a note left over
 * from before this dropdown existed, or before the 6th month trimmed its own list down to
 * these two choices.
 */
export function milestoneNoteTone(value: string): "neutral" | "success" | "warn" | "accent" {
  switch (value) {
    case "Done":
      return "success";
    case "Evaluation Submitted":
      return "accent";
    default:
      return "neutral";
  }
}

/**
 * Options to offer for a note. A note typed before the dropdown existed is kept as its
 * own choice so switching to the dropdown never silently discards what was written.
 */
export function sixthMonthNoteOptions(current: string): string[] {
  const base: string[] = [NOT_SET, ...SIXTH_MONTH_NOTE_OPTIONS];
  return base.includes(current) ? base : [...base, current];
}

export function sixthMonthNoteLabels(current: string): Record<string, string> {
  const labels: Record<string, string> = { [NOT_SET]: NOT_SET_LABEL };
  SIXTH_MONTH_NOTE_OPTIONS.forEach((o) => {
    labels[o] = o;
  });
  if (current && !labels[current]) labels[current] = current;
  return labels;
}
