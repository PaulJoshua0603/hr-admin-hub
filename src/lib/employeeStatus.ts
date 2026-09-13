import type { COERequest, Employee } from "@/types";

/**
 * One definition of "who counts as what", shared by the Employees count cards, the
 * Active/Resigned view under Advanced Filtering, and the Excel exports. These used to
 * be worked out separately in each place, which is how the same staff could total 278
 * on one screen and something else on another.
 */
export type EmployeeStatus = "active" | "newHire" | "resigned";

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Employees named on a COE for Resigned, keyed by name with the earliest request date.
 * Anyone who also has a COE with Purpose is left out — a purpose COE is issued to
 * someone still employed, so it keeps them off the resigned list.
 */
export function resignedCoeIndex(coeRequests: COERequest[]): Map<string, string> {
  const withPurpose = new Set(
    coeRequests.filter((r) => r.category !== "endOfEmployment").map((r) => nameKey(r.employeeName))
  );
  const index = new Map<string, string>();
  coeRequests
    .filter((r) => r.category === "endOfEmployment")
    .forEach((r) => {
      const key = nameKey(r.employeeName);
      if (withPurpose.has(key)) return;
      const existing = index.get(key);
      if (!existing || r.dateRequested < existing) index.set(key, r.dateRequested);
    });
  return index;
}

/**
 * Separation date, or null when the employee has not resigned. An empty string means
 * resigned with no date on record — never their date added, which is not a last day.
 */
export function separationDate(e: Employee, coeIndex: Map<string, string>): string | null {
  if (e.lastDay) return e.lastDay;
  const fromCoe = coeIndex.get(nameKey(e.name));
  if (fromCoe) return fromCoe;
  if (e.resignedStatus === "resigned") return "";
  return null;
}

/**
 * A new hire whose onboarding date is still ahead of them — hired on paper, but not yet
 * started, so they are counted separately from current staff.
 */
export function isAwaitingOnboarding(e: Employee, now: Date = new Date()): boolean {
  if (!e.dateHired) return false;
  const start = new Date(e.dateHired);
  if (Number.isNaN(start.getTime())) return false;
  return start.getTime() > now.getTime();
}

export function classifyEmployee(
  e: Employee,
  coeIndex: Map<string, string>,
  now: Date = new Date()
): EmployeeStatus {
  if (separationDate(e, coeIndex) !== null) return "resigned";
  if (isAwaitingOnboarding(e, now)) return "newHire";
  return "active";
}

/** Splits the roster once so every count on a screen comes from the same pass. */
export function groupEmployees(
  employees: Employee[],
  coeRequests: COERequest[],
  now: Date = new Date()
): { active: Employee[]; newHires: Employee[]; resigned: Employee[]; coeIndex: Map<string, string> } {
  const coeIndex = resignedCoeIndex(coeRequests);
  const active: Employee[] = [];
  const newHires: Employee[] = [];
  const resigned: Employee[] = [];
  employees.forEach((e) => {
    const status = classifyEmployee(e, coeIndex, now);
    if (status === "resigned") resigned.push(e);
    else if (status === "newHire") newHires.push(e);
    else active.push(e);
  });
  return { active, newHires, resigned, coeIndex };
}
