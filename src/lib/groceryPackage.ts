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
  { team: "Team Shiela-Arch 2", sheet: "Arch 2", departments: ["Arch 2", "Arch 2A", "Arch 2C"] },
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

/**
 * Which client each team works for: Client → Team → Department. These are only the
 * starting values; HR sets the rest in the Team → Client editor (Grocery Package), which
 * saves to `TEAM_CLIENTS_KEY` and wins over anything here.
 */
export const DEFAULT_TEAM_CLIENTS: Record<string, string> = {
  "Team Atlas Building (Est 1 - Com)": "Atlas",
  "Team Atlas Pre-Cast": "Atlas",
  "Team Simonds Pampanga": "Simonds",
  "Team Simonds BGC (Arch 1 & Simonds WA)": "Simonds",
  "Team Aprille (Realform)": "Realform",
  "Team Go Frameit-SF 1": "Go Frameit",
  "Team Consolidated Energy (DE-Invoicing & DE-PO)": "Consolidated Energy",
  "Team Catsys": "Catsys",
};

/**
 * People who receive the Grocery Package but have no record in Employees — the
 * attendance sheet lists them, the employee list does not. They are counted and
 * exported like everyone else, and shown with `groceryNote` beside their name.
 */
type GroceryExtra = Pick<
  Employee,
  "id" | "name" | "lastName" | "firstName" | "position" | "department" | "team"
> & { groceryNote: string };

const GROCERY_EXTRAS_DATA: GroceryExtra[] = [
  {
    id: "grocery-extra-tran-hien",
    name: "HIEN TRAN",
    lastName: "TRAN",
    firstName: "HIEN",
    position: "SENIOR DRAFTER",
    department: "Arch 2",
    team: "Team Shiela-Arch 2",
    groceryNote: "Vietnam-based · not in Employees",
  },
];

export const GROCERY_EXTRAS: Employee[] = GROCERY_EXTRAS_DATA.map(
  (x) => ({ ...x, dateAdded: "", requirementsDeadline: "", requirements: {} }) as unknown as Employee
);

const EXTRA_NOTES = new Map(GROCERY_EXTRAS_DATA.map((x) => [x.id, x.groceryNote]));

/** The note for someone listed only in Grocery Package, or null for a real employee. */
export function groceryNote(e: Employee): string | null {
  return EXTRA_NOTES.get(e.id) ?? null;
}

/** Supabase store key for the Team → Client choices: `{ id: team name, client }`. */
export const TEAM_CLIENTS_KEY = "hr_team_clients";
export type TeamClient = { id: string; client: string };

/** Team name → client, saved choices over the defaults. */
export function teamClientMap(saved: TeamClient[]): Map<string, string> {
  const map = new Map(Object.entries(DEFAULT_TEAM_CLIENTS));
  saved.forEach((s) => map.set(s.id, s.client.trim()));
  return map;
}

export const NO_CLIENT = "No client set";

/**
 * An employee's client: their team's, so everyone on a team stays with the same client
 * (a Client typed on one member's record never splits them off); only someone with no
 * team at all uses the Client on their own record.
 */
export function clientOf(e: Employee, clients: Map<string, string>): string {
  const team = teamOf(e);
  if (team) return clients.get(team.team) || NO_CLIENT;
  return (e.client || "").trim() || NO_CLIENT;
}

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

const TEAM_BY_NAME = new Map(GROCERY_TEAMS.map((t) => [t.team, t]));

/**
 * Employees the October 2026 attendance sheet puts on a team their department does not
 * map to, keyed by employee record id. Checked against the whole sheet: these were the
 * only two whose team in the system differed from it.
 */
const ATTENDANCE_SHEET_TEAMS: Record<string, string> = {
  // Phryncess Mhary S. Cacal (240104), department Struc 2
  "014b01ec-29d8-4c2e-90da-4f7d6f43d0f8": "Team Atlas Pre-Cast",
  // Ryan Jay M. Estolano (260911), department AES
  "c70520d9-7cf2-41c3-9bcc-8898f484336c": "Team Atlas Pre-Cast",
};

/** The team someone is on unless picked by hand: the attendance sheet's, else their department's. */
export function defaultTeamOf(e: Employee): GroceryTeam | null {
  const fromSheet = ATTENDANCE_SHEET_TEAMS[e.id];
  return (fromSheet && TEAM_BY_NAME.get(fromSheet)) || teamForDepartment(departmentOf(e));
}

/**
 * An employee's team: the one HR picked for them (Employee details or Grocery Package),
 * otherwise their default — so someone just added lands on a team straight away, and a
 * department change moves them unless they were placed by hand.
 */
export function teamOf(e: Employee): GroceryTeam | null {
  const chosen = e.team ? TEAM_BY_NAME.get(e.team) : undefined;
  return chosen ?? defaultTeamOf(e);
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

/** Which count row an employee falls under: their team, or their department if it has none. */
export function groupKeyOf(e: Employee): string {
  const department = departmentOf(e);
  const team = teamOf(e);
  return team ? `team:${team.team}` : `dept:${normalize(department)}`;
}

export type GroceryTeamCount = {
  key: string;
  departments: string[];
  team: string;
  client: string;
  count: number;
};

/**
 * One row per team — Team Finance is one row however many of its departments have
 * people — and one per department with no team, alphabetical by department.
 */
export function teamCounts(employees: Employee[], clients: Map<string, string>): GroceryTeamCount[] {
  const rows = new Map<string, GroceryTeamCount>();
  employees.forEach((e) => {
    const department = departmentOf(e);
    const key = groupKeyOf(e);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        departments: [],
        team: teamOf(e)?.team || "",
        client: clientOf(e, clients),
        count: 0,
      };
      rows.set(key, row);
    }
    if (!row.departments.includes(department)) row.departments.push(department);
    row.count++;
  });
  return [...rows.values()]
    .map((r) => ({ ...r, departments: r.departments.sort(compareText) }))
    .sort(
      (a, b) =>
        Number(a.client === NO_CLIENT) - Number(b.client === NO_CLIENT) ||
        compareText(a.client, b.client) ||
        compareText(a.departments[0], b.departments[0])
    );
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
    const team = teamOf(e);
    const key = groupKeyOf(e);
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
