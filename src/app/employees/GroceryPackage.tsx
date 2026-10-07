"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { Employee } from "@/types";
import { Button, SearchInput, TableWrap } from "@/components/ui";
import { useNotifications } from "@/lib/notificationContext";
import { countableEmployees, separationDate } from "@/lib/employeeStatus";
import {
  compareByLastName,
  departmentCounts,
  departmentOf,
  groceryFullName,
  grocerySheets,
  teamForDepartment,
} from "@/lib/groceryPackage";

const ALL = "__all__";

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
  const [department, setDepartment] = useState(ALL);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  // Recomputed from the live employee list, so adding, editing, resigning or onboarding
  // someone changes these counts straight away.
  const scoped = useMemo(
    () => countableEmployees(employees).filter((e) => separationDate(e, coeIndex) === null),
    [employees, coeIndex]
  );
  const allDepartments = useMemo(() => departmentCounts(scoped), [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((e) => department === ALL || departmentOf(e) === department)
      .filter(
        (e) =>
          !q ||
          [e.name, e.companyIdNumber, e.position, e.department].some((v) =>
            (v || "").toLowerCase().includes(q)
          )
      )
      .sort(compareByLastName);
  }, [scoped, department, search]);
  const counts = useMemo(() => departmentCounts(filtered), [filtered]);
  const isFiltered = department !== ALL || search.trim() !== "";

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
      summary.columns = [{ width: 6 }, { width: 34 }, { width: 46 }, { width: 12 }];
      const sTitle = summary.addRow(["Grocery Package — Employees per Department"]);
      summary.mergeCells(sTitle.number, 1, sTitle.number, 4);
      sTitle.getCell(1).font = { bold: true, size: 13 };
      sTitle.getCell(1).fill = solid("FFEAF4F1");
      sTitle.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      const sDate = summary.addRow([`As of ${today}`]);
      summary.mergeCells(sDate.number, 1, sDate.number, 4);
      sDate.getCell(1).alignment = { horizontal: "center" };
      sDate.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
      const sHead = summary.addRow(["No.", "Department", "Team", "Employees"]);
      sHead.eachCell((c, col) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = solid("FF0E5E56");
        c.border = box;
        c.alignment = { horizontal: col === 1 || col === 4 ? "center" : "left", vertical: "middle" };
      });
      counts.forEach((d, i) => {
        const row = summary.addRow([i + 1, d.department, d.team || "No team assigned", d.count]);
        row.eachCell((c, col) => {
          c.border = box;
          if (col === 1 || col === 4) c.alignment = { horizontal: "center" };
        });
      });
      const sTotal = summary.addRow(["", "Grand Total", "", filtered.length]);
      sTotal.eachCell((c, col) => {
        c.font = { bold: true };
        c.border = box;
        if (col === 4) c.alignment = { horizontal: "center" };
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

        const sub = ws.addRow([`Grocery Package · ${group.departments.join(", ")} · ${today}`]);
        ws.mergeCells(sub.number, 1, sub.number, 5);
        sub.getCell(1).alignment = { horizontal: "center" };
        sub.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };

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
          Department
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="min-w-[14rem] rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            <option value={ALL}>All departments ({scoped.length})</option>
            {allDepartments.map((d) => (
              <option key={d.department} value={d.department}>
                {d.department} ({d.count})
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

      <p className="mt-3 text-xs text-ink-muted">
        Current employees and new hires with an upcoming onboarding date.
        {isFiltered && ` Showing ${filtered.length} of ${scoped.length}.`}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Department counts */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Employees per Department</h3>
          <TableWrap maxHeight="34rem">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 text-center">No.</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2 text-center">Count</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((d, i) => (
                  <tr
                    key={d.department}
                    onClick={() => setDepartment(department === d.department ? ALL : d.department)}
                    className={`cursor-pointer border-t border-border hover:bg-background ${
                      department === d.department ? "bg-accent-soft" : ""
                    }`}
                    title="Click to show only this department"
                  >
                    <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{i + 1}</td>
                    <td className="px-3 py-2 text-ink">{d.department}</td>
                    <td className="px-3 py-2 text-ink-muted">{d.team || "No team assigned"}</td>
                    <td className="px-3 py-2 text-center font-medium tabular-nums text-ink">{d.count}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-background font-semibold">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-ink" colSpan={2}>
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
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                      No employees match this filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e, i) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{i + 1}</td>
                      <td className="px-3 py-2 tabular-nums text-ink-muted">{e.companyIdNumber || "—"}</td>
                      <td className="px-3 py-2 text-ink">{groceryFullName(e)}</td>
                      <td className="px-3 py-2 text-ink-muted">{e.position || ""}</td>
                      <td className="px-3 py-2 text-ink-muted">{departmentOf(e)}</td>
                      <td className="px-3 py-2 text-ink-muted">
                        {teamForDepartment(departmentOf(e))?.team || "—"}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="border-t-2 border-border bg-background font-semibold">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-ink" colSpan={5}>
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
