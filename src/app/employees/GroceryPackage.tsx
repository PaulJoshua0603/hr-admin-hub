"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { Employee } from "@/types";
import { Button, Input, SearchInput, TableWrap } from "@/components/ui";
import { useNotifications } from "@/lib/notificationContext";
import { countableEmployees, separationDate } from "@/lib/employeeStatus";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import {
  GROCERY_EXTRAS,
  GROCERY_TEAMS,
  groceryNote,
  NO_CLIENT,
  TEAM_CLIENTS_KEY,
  type TeamClient,
  clientOf,
  compareByLastName,
  compareText,
  groupKeyOf,
  departmentOf,
  groceryFullName,
  grocerySheets,
  teamClientMap,
  teamCounts,
  teamOf,
  defaultTeamOf,
} from "@/lib/groceryPackage";

/**
 * Team choice for one employee: "Default" follows the attendance sheet or their department (and
 * keeps following it if the department changes); any other choice pins them to that team.
 * Shared by Grocery Package and Employee details so both offer exactly the same list.
 */
export function TeamPicker({
  employee,
  onPick,
  onClose,
  autoFocus,
  disabled,
  className = "",
}: {
  employee: Employee;
  onPick: (team: string) => void;
  onClose?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const fallback = defaultTeamOf(employee)?.team;
  return (
    <select
      value={employee.team && GROCERY_TEAMS.some((t) => t.team === employee.team) ? employee.team : ""}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(ev) => onPick(ev.target.value)}
      onBlur={onClose}
      onKeyDown={(ev) => {
        if (ev.key === "Escape") onClose?.();
      }}
      className={`w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      <option value="">Default ({fallback || "no team"})</option>
      {[...GROCERY_TEAMS]
        .sort((a, b) => compareText(a.team, b.team))
        .map((t) => (
          <option key={t.team} value={t.team}>
            {t.team}
          </option>
        ))}
    </select>
  );
}

const ALL = "__all__";

/** Distinct and alphabetical, with "No client set" kept at the end. */
const uniqueSorted = (values: string[]) =>
  [...new Set(values)].sort(
    (a, b) => Number(a === NO_CLIENT) - Number(b === NO_CLIENT) || compareText(a, b)
  );

const SELECT =
  "min-w-[12rem] rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

/**
 * Grocery Package: everyone currently employed plus new hires whose start date is still
 * ahead — the same people as the Current Employees and New Hires counts — counted per
 * department with its team, and listed by surname for the signing sheets.
 */
export default function GroceryPackage({
  employees,
  coeIndex,
}: {
  employees: Employee[];
  coeIndex: Map<string, string>;
}) {
  const { notify } = useNotifications();
  const { items: savedClients, setItems: setSavedClients } = useSupabaseStore<TeamClient>(
    TEAM_CLIENTS_KEY,
    []
  );
  const clients = useMemo(() => teamClientMap(savedClients), [savedClients]);
  // Same shared copy the Employees pages edit, so a team changed here shows there at once.
  const { update: updateEmployee } = useSupabaseStore<Employee>("hr_employees", []);
  const [editingTeamFor, setEditingTeamFor] = useState<string | null>(null);
  const [client, setClient] = useState(ALL);
  const [team, setTeam] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [search, setSearch] = useState("");
  // Hired on or before this date; blank shows everyone.
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [editingClients, setEditingClients] = useState(false);

  // Recomputed from the live employee list, so adding, editing, resigning or onboarding
  // someone changes these counts straight away.
  const scoped = useMemo(
    () => [
      ...countableEmployees(employees).filter((e) => separationDate(e, coeIndex) === null),
      // Listed for the Grocery Package without an employee record (e.g. Vietnam-based).
      ...GROCERY_EXTRAS,
    ],
    [employees, coeIndex]
  );

  // End date first: everyone hired on or before it. Blank leaves nobody out.
  const dated = useMemo(() => {
    if (!endDate) return scoped;
    return scoped.filter((e) => {
      const hired = (e.dateHired || "").slice(0, 10);
      // Grocery-only people (no record, no hire date) are always counted.
      if (groceryNote(e)) return true;
      return !!hired && hired <= endDate;
    });
  }, [scoped, endDate]);

  // Client → Team → Department: each picker only offers what sits under the one before it.
  const clientOptions = useMemo(
    () => uniqueSorted(dated.map((e) => clientOf(e, clients))),
    [dated, clients]
  );
  const inClient = useMemo(
    () => dated.filter((e) => client === ALL || clientOf(e, clients) === client),
    [dated, client, clients]
  );
  const teamOptions = useMemo(() => teamCounts(inClient, clients), [inClient, clients]);
  const inTeam = useMemo(
    () => inClient.filter((e) => team === ALL || groupKeyOf(e) === team),
    [inClient, team]
  );
  const departmentOptions = useMemo(() => uniqueSorted(inTeam.map(departmentOf)), [inTeam]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inTeam
      .filter((e) => department === ALL || departmentOf(e) === department)
      .filter(
        (e) =>
          !q ||
          [e.name, e.companyIdNumber, e.position, e.department].some((v) =>
            (v || "").toLowerCase().includes(q)
          )
      )
      .sort(compareByLastName);
  }, [inTeam, department, search]);
  const counts = useMemo(() => teamCounts(filtered, clients), [filtered, clients]);
  const isFiltered =
    client !== ALL || team !== ALL || department !== ALL || search.trim() !== "" || !!endDate;

  function pickClient(value: string) {
    setClient(value);
    setTeam(ALL);
    setDepartment(ALL);
  }
  function pickTeam(value: string) {
    setTeam(value);
    setDepartment(ALL);
  }

  function saveTeamClient(teamName: string, value: string) {
    const next = value.trim();
    if (next === (clients.get(teamName) || "")) return;
    setSavedClients([...savedClients.filter((s) => s.id !== teamName), { id: teamName, client: next }]);
    // A filter on the old client name would otherwise hide the team that just moved.
    pickClient(ALL);
  }

  async function handleExport() {
    if (filtered.length === 0) {
      notify("No employees to export for this filter.", "warn");
      return;
    }
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
      const thin = { style: "thin" as const, color: { argb: "FF9CA3AF" } };
      const box = { top: thin, left: thin, bottom: thin, right: thin };
      const today = format(new Date(), "MMMM d, yyyy");

      // Summary first: every department, its team and its count, with the grand total.
      const summary = wb.addWorksheet("Summary");
      summary.columns = [{ width: 6 }, { width: 24 }, { width: 46 }, { width: 34 }, { width: 12 }];
      const sTitle = summary.addRow(["Grocery Package — Employees per Department"]);
      summary.mergeCells(sTitle.number, 1, sTitle.number, 5);
      sTitle.getCell(1).font = { bold: true, size: 13 };
      sTitle.getCell(1).fill = solid("FFEAF4F1");
      sTitle.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      const sDate = summary.addRow([`As of ${today}`]);
      summary.mergeCells(sDate.number, 1, sDate.number, 5);
      sDate.getCell(1).alignment = { horizontal: "center" };
      sDate.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
      const sHead = summary.addRow(["No.", "Client", "Team", "Department", "Employees"]);
      sHead.eachCell((c, col) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = solid("FF0E5E56");
        c.border = box;
        c.alignment = { horizontal: col === 1 || col === 5 ? "center" : "left", vertical: "middle" };
      });
      counts.forEach((d, i) => {
        const row = summary.addRow([i + 1, d.client, d.team || "No team assigned", d.departments.join(" / "), d.count]);
        row.eachCell((c, col) => {
          c.border = box;
          if (col === 1 || col === 5) c.alignment = { horizontal: "center" };
        });
      });
      const sTotal = summary.addRow(["", "Grand Total", "", "", filtered.length]);
      sTotal.eachCell((c, col) => {
        c.font = { bold: true };
        c.border = box;
        if (col === 5) c.alignment = { horizontal: "center" };
      });

      // Then one signing sheet per team (or per department with no team).
      grocerySheets(filtered, ["Summary"]).forEach((group) => {
        const ws = wb.addWorksheet(group.sheet);
        ws.columns = [{ width: 6 }, { width: 14 }, { width: 32 }, { width: 34 }, { width: 28 }];

        const title = ws.addRow([group.title]);
        ws.mergeCells(title.number, 1, title.number, 5);
        title.height = 22;
        title.getCell(1).font = { bold: true, size: 13 };
        title.getCell(1).fill = solid("FFEAF4F1");
        title.getCell(1).alignment = { horizontal: "center", vertical: "middle" };


        const head = ws.addRow(["No.", "Employee ID", "Full Name", "Position", "Signature"]);
        head.height = 20;
        head.eachCell((c, col) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = solid("FF0E5E56");
          c.border = box;
          c.alignment = { horizontal: col === 1 ? "center" : "left", vertical: "middle" };
        });

        group.employees.forEach((e, i) => {
          const row = ws.addRow([i + 1, e.companyIdNumber || "", groceryFullName(e), e.position || "", ""]);
          // Tall enough to sign in.
          row.height = 24;
          row.eachCell({ includeEmpty: true }, (c, col) => {
            c.border = box;
            c.alignment = { horizontal: col === 1 ? "center" : "left", vertical: "middle" };
          });
          // Someone listed only here: the ID cell says so, in amber.
          const note = groceryNote(e);
          if (note) {
            const id = row.getCell(2);
            id.value = "VIETNAM";
            id.fill = solid("FFFDE68A");
            id.note = note;
          }
        });

        ws.addRow([]);
        const total = ws.addRow([
          `Total: ${group.employees.length} Employee${group.employees.length === 1 ? "" : "s"}`,
        ]);
        total.getCell(1).font = { bold: true };

        // Prints on one page width with the column headings repeated on every page.
        ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
        ws.pageSetup.printTitlesRow = `${head.number}:${head.number}`;
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Grocery Package - ${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Exported Grocery Package (${filtered.length} employees)`, "created");
    } catch (err) {
      notify(`Could not export: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          End date
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        {endDate && (
          <button
            onClick={() => setEndDate("")}
            className="mb-2 text-xs font-medium text-accent hover:underline"
          >
            Clear date
          </button>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Client
          <select value={client} onChange={(e) => pickClient(e.target.value)} className={SELECT}>
            <option value={ALL}>All clients ({scoped.length})</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Team
          <select value={team} onChange={(e) => pickTeam(e.target.value)} className={SELECT}>
            <option value={ALL}>All teams ({inClient.length})</option>
            {teamOptions.map((d) => (
              <option key={d.key} value={d.key}>
                {d.team || d.departments.join(" / ")} ({d.count})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Department
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className={SELECT}>
            <option value={ALL}>All departments ({inTeam.length})</option>
            {departmentOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name, ID, position"
          className="w-64"
        />
        <Button
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto"
          title="One sheet per team, plus a Summary sheet with the department counts"
        >
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        <span>
          Current employees and new hires with an upcoming onboarding date. End date shows everyone hired on or before it.
          {isFiltered && ` Showing ${filtered.length} of ${scoped.length}.`}
        </span>
        <button
          onClick={() => setEditingClients((v) => !v)}
          className="font-medium text-accent hover:underline"
        >
          {editingClients ? "Hide Team → Client" : "Set Team → Client"}
        </button>
      </div>

      {editingClients && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <p className="mb-2 text-xs text-ink-muted">
            Type the client each team works for — everyone on the team takes it, and it shows on
            their Employee details. Saved as you leave each box. Employees whose department has
            no team keep the Client on their own record.
          </p>
          <datalist id="grocery-client-names">
            {uniqueSorted([...clients.values()].filter(Boolean)).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
            {GROCERY_TEAMS.map((t) => (
              <label key={t.team} className="flex items-center gap-2 text-sm">
                <span className="w-1/2 truncate text-ink" title={t.team}>
                  {t.team}
                </span>
                <input
                  key={clients.get(t.team) || ""}
                  defaultValue={clients.get(t.team) || ""}
                  list="grocery-client-names"
                  placeholder="Client"
                  onBlur={(e) => saveTeamClient(t.team, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-1/2 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Department counts */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Employees per Team</h3>
          <TableWrap maxHeight="34rem">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 text-center">No.</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2 text-center">Count</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((d, i) => (
                  <tr
                    key={d.key}
                    onClick={() => pickTeam(team === d.key ? ALL : d.key)}
                    className={`cursor-pointer border-t border-border hover:bg-background ${
                      team === d.key ? "bg-accent-soft" : ""
                    }`}
                    title="Click to show only this team"
                  >
                    <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{i + 1}</td>
                    <td className="px-3 py-2 text-ink-muted">{d.client}</td>
                    <td className="px-3 py-2 text-ink">{d.team || "No team assigned"}</td>
                    <td className="px-3 py-2 text-ink-muted">{d.departments.join(" / ")}</td>
                    <td className="px-3 py-2 text-center font-medium tabular-nums text-ink">{d.count}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-background font-semibold">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-ink" colSpan={3}>
                    Grand Total
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-ink">{filtered.length}</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
        </div>

        {/* Employee list */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Employee List</h3>
          <TableWrap maxHeight="34rem">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 text-center">No.</th>
                  <th className="px-3 py-2">Employee ID</th>
                  <th className="px-3 py-2">Full Name</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Client</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                      No employees match this filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e, i) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{i + 1}</td>
                      <td className="px-3 py-2 tabular-nums text-ink-muted">{e.companyIdNumber || "—"}</td>
                      <td className="px-3 py-2">
                        {groceryNote(e) ? (
                          // Not an employee record, so there is no team to save onto.
                          <span className="text-ink">{groceryFullName(e)}</span>
                        ) : (
                          <button
                            onClick={() => setEditingTeamFor(editingTeamFor === e.id ? null : e.id)}
                            className="text-left text-ink hover:text-accent hover:underline"
                            title="Change this employee's team"
                          >
                            {groceryFullName(e)}
                          </button>
                        )}
                        {groceryNote(e) && (
                          <span className="ml-2 inline-flex rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn ring-1 ring-warn/20">
                            {groceryNote(e)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{e.position || ""}</td>
                      <td className="px-3 py-2 text-ink-muted">{departmentOf(e)}</td>
                      <td className="px-3 py-2 text-ink-muted">
                        {editingTeamFor === e.id ? (
                          <TeamPicker
                            employee={e}
                            autoFocus
                            onPick={(value) => {
                              updateEmployee(e.id, { team: value || undefined });
                              setEditingTeamFor(null);
                              notify(
                                `${e.name}: ${value || `default team (${defaultTeamOf(e)?.team || "none"})`}`,
                                "created"
                              );
                            }}
                            onClose={() => setEditingTeamFor(null)}
                          />
                        ) : (
                          <span>
                            {teamOf(e)?.team || "—"}
                            {e.team && teamOf(e)?.team === e.team && !groceryNote(e) && (
                              <span className="ml-1 text-[10px] uppercase text-accent" title="Set by hand">
                                set
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{clientOf(e, clients)}</td>
                    </tr>
                  ))
                )}
                <tr className="border-t-2 border-border bg-background font-semibold">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-ink" colSpan={6}>
                    Grand Total: {filtered.length}
                  </td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
        </div>
      </div>
    </div>
  );
}
