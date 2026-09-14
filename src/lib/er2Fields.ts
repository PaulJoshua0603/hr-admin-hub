import { formatDate } from "@/lib/dates";
import type { Employee, ER2Entry } from "@/types";

/**
 * How each ER2 value is written on the PhilHealth sheet. Everything goes on in
 * upper case, matching how the form is filled by hand:
 *
 *   PhilHealth no.      01-250472813-5
 *   Name of employee    BAYANI, HAZEL ENTERIA
 *   Salary              ₱25,000.00
 *   Date of employment  SEPTEMBER 01, 2026
 */

/** 12 digits become XX-XXXXXXXXX-X; anything else is passed through as typed. */
export function formatPhilHealthNo(raw?: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length !== 12) return (raw || "").trim().toUpperCase();
  return `${digits.slice(0, 2)}-${digits.slice(2, 11)}-${digits.slice(11)}`;
}

/**
 * Surname first, as the form expects: "BAYANI, HAZEL ENTERIA".
 *
 * Imports capture the name parts, so those are used when present. Records imported
 * before that keep only a display name like "Hazel E. Bayani"; for those the last
 * word is taken as the surname, which is right for most names but will need a manual
 * correction for compound surnames such as "Dela Cruz" or "San Pedro III".
 */
export function formatEr2Name(e: Pick<Employee, "name" | "firstName" | "middleName" | "lastName">): string {
  const last = (e.lastName || "").trim();
  const first = (e.firstName || "").trim();
  const middle = (e.middleName || "").trim();
  if (last && first) {
    return `${last}, ${[first, middle].filter(Boolean).join(" ")}`.toUpperCase();
  }

  const parts = (e.name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].toUpperCase();

  // A trailing suffix belongs to the surname: "Ernesto P. Castillo Jr." is
  // "CASTILLO JR., ERNESTO P.", not "JR., ERNESTO P. CASTILLO".
  const SUFFIXES = /^(jr|sr|ii|iii|iv|v)\.?$/i;
  let cut = parts.length - 1;
  while (cut > 1 && SUFFIXES.test(parts[cut])) cut--;

  // Surname particles come along too, so "Lim P. San Pedro III" reads
  // "SAN PEDRO III, LIM P." rather than "PEDRO III, LIM P. SAN".
  const PARTICLES = /^(de|del|dela|delos|di|da|la|las|los|san|santa|santo|sta|sto|van|von)\.?$/i;
  while (cut > 1 && PARTICLES.test(parts[cut - 1])) cut--;

  const surname = parts.slice(cut).join(" ");
  const rest = parts.slice(0, cut).join(" ");
  return `${surname}, ${rest}`.toUpperCase();
}

/** Peso amount with thousands separators and two decimals. */
export function formatEr2Salary(raw?: string): string {
  if (!raw) return "";
  const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(num)) return String(raw).trim().toUpperCase();
  return `₱${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatEr2Date(iso?: string): string {
  if (!iso) return "";
  const formatted = formatDate(iso, "MMMM dd, yyyy");
  return formatted === "—" ? "" : formatted.toUpperCase();
}

/** Builds an ER2 line from an employee record, with every field already formatted. */
export function er2EntryFromEmployee(e: Employee, id: string): ER2Entry {
  return {
    id,
    employeeId: e.id,
    philhealthNo: formatPhilHealthNo(e.philhealthNo),
    name: formatEr2Name(e),
    position: (e.position || "").toUpperCase(),
    salary: formatEr2Salary(e.basicSalary),
    dateOfEmployment: formatEr2Date(e.dateHired),
  };
}

/** Upper-cased, punctuation stripped, spaces collapsed — for comparing names. */
function normalizeName(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Name words worth matching on; single letters are middle initials, not names. */
function significantTokens(value: string): string[] {
  return normalizeName(value).split(" ").filter((t) => t.length > 1);
}

/**
 * Finds the employee a typed name refers to, so the rest of the ER2 line can be filled
 * without picking from the dropdown. Accepts either direction — "BAYANI, HAZEL ENTERIA"
 * or "Hazel E. Bayani" — because it compares the set of name words rather than their
 * order, ignoring middle initials.
 *
 * Returns null when nothing matches *or* when more than one employee does: filling in
 * someone's PhilHealth number and salary off an ambiguous name is worse than leaving
 * the row blank for the user to resolve.
 */
export function findEmployeeByName(employees: Employee[], typed: string): Employee | null {
  const target = normalizeName(typed);
  if (target.length < 3) return null;

  // An exact hit on either spelling wins outright.
  const exact = employees.filter(
    (e) => normalizeName(e.name) === target || normalizeName(formatEr2Name(e)) === target
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // Otherwise every significant word of the stored name must appear in what was typed.
  const typedTokens = new Set(significantTokens(typed));
  if (typedTokens.size === 0) return null;
  const partial = employees.filter((e) => {
    const tokens = significantTokens(e.name);
    return tokens.length > 0 && tokens.every((t) => typedTokens.has(t));
  });
  return partial.length === 1 ? partial[0] : null;
}
