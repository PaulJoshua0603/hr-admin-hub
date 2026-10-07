import type { Employee } from "@/types";
import { employeeNameParts } from "@/lib/employeeNamePdf";

/**
 * Which team each department belongs to for the Grocery Package. One team can take in
 * several departments (Team Finance covers five); `sheet` is the Excel tab it exports to,
 * kept within Excel's 31-character limit and free of the characters Excel refuses.
 */
export type GroceryTeam = { team: string; sheet: string; departments: string[] };

export const GROCERY_TEAMS: GroceryTeam[] = [
  { team: "Team Aldous (Arch 4)", sheet: "Arch 4", departments: ["Arch 4"] },
  { team: "Team Jenepher (Est 1 - Res)", sheet: "Est 1 - Res", departments: ["Est 1 - Res"] },
  { team: "Team Atlas Building (Est 1 - Com)", sheet: "Est 1 - Com", departments: ["Est 1 - Com"] },
  {
    team: "Team Estimating Insulation Team (Est 2 - Ins Team)",
    sheet: "Est 2 - Ins",
    departments: ["Est 2 - Ins"],
  },
  {
    team: "Team Jonalyn (Energy Rating - AU & US)",
    sheet: "Energy Rating - AU & US",
    departments: ["Energy Rating - AU", "Energy Rating - US"],
  },
  { team: "Team Simonds Pampanga", sheet: "SIMONDS PAMPANGA", departments: ["SIMONDS PAMPANGA"] },
  {
    team: "Team Simonds BGC (Arch 1 & Simonds WA)",
    sheet: "Arch 1 & Simonds WA",
    departments: ["Arch 1", "Simonds WA"],
  },
  { team: "Team Christian Lloyd (Arch 6)", sheet: "Arch 6", departments: ["Arch 6"] },
  { team: "Team James (Vis 1)", sheet: "Vis 1", departments: ["Vis 1"] },
  { team: "Team HVAC (HVAC 1)", sheet: "HVAC 1", departments: ["HVAC 1"] },
  { team: "Team Go Frameit-SF 1", sheet: "SF 1", departments: ["SF 1"] },
  {
    team: "Team Finance",
    sheet: "Finance",
    departments: ["Payroll Services", "Accounting", "Accounts Payable", "Tax and Compliance", "APD"],
  },
  { team: "Team Catsys", sheet: "Catsys", departments: ["Catsys"] },
  {
    team: "Team Consolidated Energy (DE-Invoicing & DE-PO)",
    sheet: "DE - Invoicing & DE - PO",
    departments: ["DE - Invoicing", "DE - PO"],
  },
  { team: "Team Rojison (Arch 5)", sheet: "Arch 5", departments: ["Arch 5"] },
  {
    team: "Team Admin & HR",
    sheet: "Admin & HR",
    departments: ["Admin", "Talent Acquisition", "HRIS Administrator", "General HR Services"],
  },
  { team: "Team Shiela-Arch 2", sheet: "Arch 2", departments: ["Arch 2C", "Arch 2"] },
  { team: "Team Aprille (Realform)", sheet: "Adrch D 1", departments: ["Adrch D 1"] },
  {
    team: "Team Chris - IT Support",
    sheet: "IT Support",
    departments: ["IT Helpdesk Support", "Systems/Security/Network"],
  },
  { team: "Team Atlas Pre-Cast", sheet: "Struc 1", departments: ["Struc 1"] },
  { team: "Team Mark-Arch 3", sheet: "Arch 3", departments: ["Arch 3"] },
  { team: "Team Management", sheet: "Management", departments: ["Management"] },
  {
    team: "Team Marketing and Business Development",
    sheet: "Marketing and Business Dev",
    departments: ["Marketing and Business Development"],
  },
  {
    team: "Team DGS Technical Services",
    sheet: "DGS Technical Services",
    departments: ["DGS Technical Services"],
  },
  { team: "Team Jude Arch 7", sheet: "Arch 7", departments: ["Arch 7"] },
  { team: "Team Ely Arch 8", sheet: "Arch 8", departments: ["Arch 8"] },
];

/** "Est 1 - Res", "EST 1-RES" and "est1 res" are the same department. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const TEAM_BY_DEPARTMENT = new Map<string, GroceryTeam>();
GROCERY_TEAMS.forEach((t) => t.departments.forEach((d) => TEAM_BY_DEPARTMENT.set(normalize(d), t)));

export const NO_DEPARTMENT = "No Department";

export function departmentOf(e: Employee): string {
  return (e.department || "").trim() || NO_DEPARTMENT;
}

/** The team a department belongs to, or null for one not in the list above. */
export function teamForDepartment(department: string): GroceryTeam | null {
  return TEAM_BY_DEPARTMENT.get(normalize(department)) ?? null;
}

/** Last name, first name and middle initial, preferring what Employee details holds. */
function nameKeys(e: Employee) {
  const parts = employeeNameParts(e);
  const middle = (e.middleName || "").trim();
  return {
    last: (e.lastName || "").trim() || parts.surname,
    first: (e.firstName || "").trim() || parts.first,
    initial: middle ? `${middle.charAt(0).toUpperCase()}.` : parts.middleInitial,
  };
}

/** "Cruz, Juan D." */
export function groceryFullName(e: Employee): string {
  const { last, first, initial } = nameKeys(e);
  if (!last) return e.name || "";
  return [`${last},`, first, initial].filter(Boolean).join(" ");
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Last name, then first name, then middle initial. */
export function compareByLastName(a: Employee, b: Employee): number {
  const x = nameKeys(a);
  const y = nameKeys(b);
  return (
    collator.compare(x.last, y.last) ||
    collator.compare(x.first, y.first) ||
    collator.compare(x.initial, y.initial)
  );
}

export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

export type GroceryDepartmentCount = { department: string; team: string; count: number };

/** One row per department present, alphabetical, with its team. */
export function departmentCounts(employees: Employee[]): GroceryDepartmentCount[] {
  const counts = new Map<string, number>();
  employees.forEach((e) => {
    const d = departmentOf(e);
    counts.set(d, (counts.get(d) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([department, count]) => ({
      department,
      team: teamForDepartment(department)?.team || "",
      count,
    }))
    .sort((a, b) => compareText(a.department, b.department));
}

export type GrocerySheet = {
  /** The team's name, or the department's own for one with no team. */
  title: string;
  team: string;
  sheet: string;
  departments: string[];
  employees: Employee[];
};

/** Excel refuses \ / ? * [ ] : in tab names and anything past 31 characters. */
function safeSheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, "-").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * The employees split into one sheet per team (a department with no team gets a sheet of
 * its own), each sorted by name, sheets in alphabetical order of their tab names.
 */
export function grocerySheets(employees: Employee[], reserved: string[] = []): GrocerySheet[] {
  const groups = new Map<string, Omit<GrocerySheet, "sheet"> & { sheetName: string }>();
  employees.forEach((e) => {
    const department = departmentOf(e);
    const team = teamForDepartment(department);
    const key = team ? `team:${team.team}` : `dept:${normalize(department)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        title: team?.team || department,
        team: team?.team || "",
        sheetName: team?.sheet || department,
        departments: [],
        employees: [],
      };
      groups.set(key, group);
    }
    if (!group.departments.includes(department)) group.departments.push(department);
    group.employees.push(e);
  });

  const taken = new Set(reserved.map((r) => r.toLowerCase()));
  return [...groups.values()]
    .sort((a, b) => compareText(a.sheetName, b.sheetName))
    .map(({ sheetName, ...g }) => ({
      ...g,
      sheet: safeSheetName(sheetName, taken),
      departments: g.departments.sort(compareText),
      employees: [...g.employees].sort(compareByLastName),
    }));
}
