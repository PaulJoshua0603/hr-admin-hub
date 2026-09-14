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
 * Rows on file that are not people: the `admin` system account and placeholder records
 * left behind by test imports, such as "Bbb Vvv Rrr". They arrive through the same
 * spreadsheet as everyone else, and counting them is why Current Employees has read one
 * or two above the figure on the HR export.
 *
 * The rules are deliberately narrow, because wrongly excluding a real employee is far
 * worse than counting a stray row:
 *
 *  - the admin account is matched on its reserved Employee ID of 0, or on a name that is
 *    *exactly* "admin"/"admin admin" — never on the word appearing inside a real name;
 *  - a placeholder is a name whose every part is one letter repeated. Imports store names
 *    as "First M. Last", so the middle initial is skipped when judging — the test row
 *    reaches the store as "Rrr V. Bbb", and requiring *every* part to be repeated letters
 *    would let that single "V." keep it in the headcount.
 *
 * Short real surnames — Ng, Uy, Go, Sy, To, Lo — are made of different letters and are
 * unaffected, and a real name needs only one ordinary part to be kept.
 */
export function isNonEmployeeRecord(e: Employee): boolean {
  const name = (e.name || "").trim();
  if (!name) return true; // a row with nobody's name on it is not a headcount

  const lower = name.toLowerCase();
  if (lower === "admin" || lower === "admin admin") return true;
  if ((e.companyIdNumber || "").trim() === "0") return true;

  // Initials carry no evidence either way, so they are set aside rather than counted
  // as ordinary parts.
  const words = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, "").toLowerCase())
    .filter((letters) => letters.length > 1);

  return words.length > 0 && words.every((letters) => /^(.)\1+$/u.test(letters));
}

/** The roster as a headcount: everyone on file who is an actual employee. */
export function countableEmployees(employees: Employee[]): Employee[] {
  return employees.filter((e) => !isNonEmployeeRecord(e));
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

/**
 * Splits the roster once so every count on a screen comes from the same pass. System and
 * placeholder rows are set aside rather than sorted into a bucket, and returned as
 * `excluded` so a screen can say how many it left out instead of silently disagreeing
 * with the number of records on file.
 */
export function groupEmployees(
  employees: Employee[],
  coeRequests: COERequest[],
  now: Date = new Date()
): {
  active: Employee[];
  newHires: Employee[];
  resigned: Employee[];
  excluded: Employee[];
  coeIndex: Map<string, string>;
} {
  const coeIndex = resignedCoeIndex(coeRequests);
  const active: Employee[] = [];
  const newHires: Employee[] = [];
  const resigned: Employee[] = [];
  const excluded: Employee[] = [];
  employees.forEach((e) => {
    if (isNonEmployeeRecord(e)) {
      excluded.push(e);
      return;
    }
    const status = classifyEmployee(e, coeIndex, now);
    if (status === "resigned") resigned.push(e);
    else if (status === "newHire") newHires.push(e);
    else active.push(e);
  });
  return { active, newHires, resigned, excluded, coeIndex };
}
