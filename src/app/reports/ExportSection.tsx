"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, Input } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { inRange, rangeFor } from "@/lib/dateRanges";
import { useNotifications } from "@/lib/notificationContext";
import { countableEmployees, hasLeft, resignedCoeIndex, separationReason } from "@/lib/employeeStatus";
import { NO_CLIENT, TEAM_CLIENTS_KEY, type TeamClient, clientOf, teamClientMap, teamOf } from "@/lib/groceryPackage";
import { sixthMonthRows } from "./SixthMonthReport";
import type { COERequest, Employee, ER2Form } from "@/types";

type Report = { key: string; title: string; sheet: string; columns: { header: string; width: number }[]; rows: string[][] };

const day = (iso?: string) => (iso ? formatDate(iso, "MMMM d, yyyy") : "");
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Reports by date: pick a Start and End date and see, for that coverage, the ER2 forms,
 * COEs with Purpose and for Resigned, New Hires and 6th-Month milestones — and export the
 * same five lists to Excel, one sheet each.
 */
export function ReportExportSection() {
  const monthRange = rangeFor("month", new Date());
  const { items: coeRequests } = useSupabaseStore<COERequest>("hr_coe_requests", []);
  const { items: employees } = useSupabaseStore<Employee>("hr_employees", []);
  const { items: er2Forms } = useSupabaseStore<ER2Form>("hr_er2_forms", []);
  const { items: savedClients } = useSupabaseStore<TeamClient>(TEAM_CLIENTS_KEY, []);
  const { notify } = useNotifications();

  const [startDate, setStartDate] = useState(monthRange.start);
  const [endDate, setEndDate] = useState(monthRange.end);
  const [exporting, setExporting] = useState(false);

  const reports: Report[] = useMemo(() => {
    const byName = new Map(employees.map((e) => [nameKey(e.name || ""), e]));
    const coeIndex = resignedCoeIndex(coeRequests);
    const clients = teamClientMap(savedClients);

    // ER2: everyone on a form whose coverage overlaps the range, each name once.
    const seen = new Set<string>();
    const er2: string[][] = [];
    er2Forms
      .filter((f) => f.coverageStart.slice(0, 10) <= endDate && f.coverageEnd.slice(0, 10) >= startDate)
      .forEach((f) =>
        f.entries.forEach((en) => {
          const k = nameKey(en.name || "");
          if (!k || seen.has(k)) return;
          seen.add(k);
          er2.push([en.name, en.position || byName.get(k)?.position || ""]);
        })
      );

    const inRangeCoe = coeRequests.filter((r) => inRange(r.dateRequested, startDate, endDate));
    const purpose = inRangeCoe
      .filter((r) => r.category !== "endOfEmployment")
      .map((r) => [r.employeeName, day(r.dateRequested), day(r.dateGiven), r.purpose || ""]);
    const resigned = inRangeCoe
      .filter((r) => r.category === "endOfEmployment")
      .map((r) => {
        const e = byName.get(nameKey(r.employeeName));
        return [
          r.employeeName,
          r.position || e?.position || "",
          r.department || e?.department || "",
          day(r.dateGiven),
          e ? separationReason(e, coeIndex) : "",
          day(e?.lastDay),
        ];
      });

    const newHires = countableEmployees(employees)
      .filter((e) => e.dateHired && inRange(e.dateHired, startDate, endDate) && !hasLeft(e))
      .sort((a, b) => (a.dateHired! < b.dateHired! ? -1 : 1))
      .map((e) => {
        const client = clientOf(e, clients);
        return [e.name, e.position || "", e.department || "", client === NO_CLIENT ? "" : client, day(e.dateHired)];
      });

    const byId = new Map(employees.map((e) => [e.id, e]));
    const sixth = sixthMonthRows(countableEmployees(employees), startDate, endDate).map((r) => {
      const e = byId.get(r.id);
      return [r.name, r.position, r.department, (e && teamOf(e)?.team) || "", day(r.sixthMonth)];
    });

    return [
      {
        key: "er2",
        title: "ER2 Form (PhilHealth Template)",
        sheet: "ER2 Form",
        columns: [{ header: "Employee Name", width: 34 }, { header: "Position", width: 34 }],
        rows: er2,
      },
      {
        key: "purpose",
        title: "COE with Purpose",
        sheet: "COE with Purpose",
        columns: [
          { header: "Employee Name", width: 32 },
          { header: "Date Requested", width: 20 },
          { header: "Date Issued", width: 20 },
          { header: "Purpose", width: 36 },
        ],
        rows: purpose,
      },
      {
        key: "resigned",
        title: "COE for Resigned Employees",
        sheet: "COE for Resigned",
        columns: [
          { header: "Employee Name", width: 30 },
          { header: "Position", width: 28 },
          { header: "Department", width: 20 },
          { header: "Date Issued", width: 20 },
          { header: "Reason for Resignation", width: 32 },
          { header: "Resignation Date", width: 20 },
        ],
        rows: resigned,
      },
      {
        key: "newHires",
        title: "New Hires",
        sheet: "New Hires",
        columns: [
          { header: "Employee Name", width: 30 },
          { header: "Position", width: 28 },
          { header: "Department", width: 20 },
          { header: "Client", width: 22 },
          { header: "Hire/Onboarding Date", width: 22 },
        ],
        rows: newHires,
      },
      {
        key: "sixth",
        title: "Employee 6th-Month Report",
        sheet: "6th-Month Report",
        columns: [
          { header: "Name", width: 30 },
          { header: "Position", width: 28 },
          { header: "Department", width: 20 },
          { header: "Team", width: 34 },
          { header: "6th-Month Date", width: 20 },
        ],
        rows: sixth,
      },
    ];
  }, [coeRequests, employees, er2Forms, savedClients, startDate, endDate]);

  function coverageLabel(): string {
    const s = new Date(`${startDate}T00:00:00`);
    const e = new Date(`${endDate}T00:00:00`);
    if (startDate === endDate) return format(s, "MMMM d, yyyy");
    const wholeMonth =
      s.getDate() === 1 &&
      s.getMonth() === e.getMonth() &&
      s.getFullYear() === e.getFullYear() &&
      e.getDate() === new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate();
    if (wholeMonth) return format(s, "MMMM yyyy");
    const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
    return sameMonth
      ? `${format(s, "MMMM d")}–${format(e, "d, yyyy")}`
      : `${format(s, "MMMM d, yyyy")}–${format(e, "MMMM d, yyyy")}`;
  }

  async function handleExport() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
      for (const r of reports) {
        const ws = wb.addWorksheet(r.sheet);
        const cols = [{ header: "No.", width: 7 }, ...r.columns];
        ws.columns = cols.map((c) => ({ width: c.width }));
        const title = ws.addRow([`${r.title} – ${coverageLabel()}`]);
        ws.mergeCells(title.number, 1, title.number, cols.length);
        title.getCell(1).font = { bold: true, size: 13, color: { argb: "FF0A2E2A" } };
        title.getCell(1).fill = solid("FFE4F0EE");
        title.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
        const head = ws.addRow(cols.map((c) => c.header));
        head.eachCell((c) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = solid("FF0E5E56");
        });
        r.rows.forEach((row, i) => ws.addRow([i + 1, ...row]));
        ws.addRow([]);
        const total = ws.addRow([`Total: ${r.rows.length}`]);
        total.getCell(1).font = { bold: true };
        total.getCell(1).fill = solid("FFFFFF00");
        total.getCell(2).fill = solid("FFFFFF00");
      }
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Reports - ${coverageLabel()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Exported reports for ${coverageLabel()}`, "created");
    } catch (err) {
      notify(`Could not export: ${err instanceof Error ? err.message : "Unknown error"}`, "warn");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg text-ink">Reports by Date</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Pick a date coverage to see these five reports for it, and export them to Excel — one sheet each.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Start date
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          End date
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <span className="mb-2 text-xs text-ink-muted">{coverageLabel()}</span>
        <Button onClick={handleExport} disabled={exporting} className="ml-auto">
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {reports.map((r) => (
          <section key={r.key}>
            <h3 className="text-sm font-semibold text-ink">
              {r.title} – Total: {r.rows.length}
            </h3>
            {r.rows.length === 0 ? (
              <div className="mt-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-ink-muted">
                None in this date range.
              </div>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2">No.</th>
                      {r.columns.map((c) => (
                        <th key={c.header} className="px-3 py-2">
                          {c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 tabular-nums text-ink-muted">{i + 1}</td>
                        {row.map((cell, j) => (
                          <td key={j} className={`px-3 py-2 ${j === 0 ? "text-ink" : "text-ink-muted"}`}>
                            {cell || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}
