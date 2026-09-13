/**
 * Status choices for the 6th-month evaluation note, shared by the Employees milestone
 * view, the Employee 6th-Month Report, and both Excel exports so the wording — and the
 * reference table printed under the export — can never drift apart.
 *
 * The chosen label is stored as the note text itself, which keeps notes written before
 * this dropdown existed readable and keeps exports self-explanatory.
 */
export const SIXTH_MONTH_NOTE_OPTIONS = [
  "Evaluation Reminder Sent",
  "Awaiting Evaluation",
  "Evaluation Submitted",
  "Done",
] as const;

export type SixthMonthNote = (typeof SIXTH_MONTH_NOTE_OPTIONS)[number];

export const SIXTH_MONTH_NOTE_MEANINGS: Record<SixthMonthNote, string> = {
  "Evaluation Reminder Sent":
    "Reminder email for the Performance Evaluation has been sent to the Head.",
  "Awaiting Evaluation": "Waiting for the Head to submit the Performance Evaluation.",
  "Evaluation Submitted":
    "Performance Evaluation submitted and Regularization Form prepared; waiting for the regularization date.",
  Done: "Regularization discussion completed with the employee.",
};

export const NOT_SET = "";
export const NOT_SET_LABEL = "— Set status —";

export function sixthMonthNoteTone(value: string): "neutral" | "success" | "warn" | "accent" {
  switch (value) {
    case "Done":
      return "success";
    case "Awaiting Evaluation":
      return "warn";
    case "Evaluation Reminder Sent":
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

/** Rows for the "what these mean" table printed under the 6th-month Excel sheets. */
export const SIXTH_MONTH_NOTE_REFERENCE: [string, string][] = SIXTH_MONTH_NOTE_OPTIONS.map(
  (option) => [option, SIXTH_MONTH_NOTE_MEANINGS[option]]
);
