"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useSupabaseStore, getStoreSnapshot } from "@/lib/useSupabaseStore";
import { Button, Card, Input } from "@/components/ui";
import { formatDate, formatTime12 } from "@/lib/dates";
import { inRange, rangeFor } from "@/lib/dateRanges";
import { useNotifications } from "@/lib/notificationContext";
import { NOT_SET_LABEL } from "@/lib/milestoneNotes";
import { sixthMonthRows } from "./SixthMonthReport";
import type {
  ER2ReportRow,
  EventReportRow,
  CustomReportTable,
  COERequest,
  Employee,
  ER2Form,
  ER2Template,
} from "@/types";
import { EVENT_STATUS_LABELS } from "@/types";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5E56" } } as const;

/**
 * Export every report table — including both COE tables — for a chosen date coverage.
 * Rows are matched on the date that identifies the record: date created for ER2,
 * date of regularization, event date, plan start date, and date requested for COE.
 */
export function ReportExportSection() {
  const today = new Date();
  const monthRange = rangeFor("month", today);

  const { items: coeRequests } = useSupabaseStore<COERequest>("hr_coe_requests", []);
  const { items: er2Rows } = useSupabaseStore<ER2ReportRow>("hr_report_er2", []);
  const { items: eventRows } = useSupabaseStore<EventReportRow>("hr_report_events", []);
  const { items: customTables } = useSupabaseStore<CustomReportTable>("hr_report_custom_tables", []);
  const { items: employees } = useSupabaseStore<Employee>("hr_employees", []);
  const { items: er2Forms } = useSupabaseStore<ER2Form>("hr_er2_forms", []);
  // Only its file name is ever read here, and only once someone actually exports — not
  // worth pulling the template's base64 body down on every visit to Reports for that.
  const { reload: reloadEr2Template } = useSupabaseStore<ER2Template>("hr_er2_template", [], {
    autoLoad: false,
  });
  const { notify } = useNotifications();

  const [startDate, setStartDate] = useState(monthRange.start);
  const [endDate, setEndDate] = useState(monthRange.end);
  const [exporting, setExporting] = useState(false);

  const coeWithPurpose = coeRequests.filter(
    (r) => r.category !== "endOfEmployment" && inRange(r.dateRequested, startDate, endDate)
  );
  const coeResigned = coeRequests.filter(
    (r) => r.category === "endOfEmployment" && inRange(r.dateRequested, startDate, endDate)
  );
  const er2 = er2Rows.filter((r) => inRange(r.dateCreated, startDate, endDate));
  const events = eventRows.filter((r) => inRange(r.date, startDate, endDate));
  const sixthMonth = sixthMonthRows(employees, startDate, endDate);
  // An ER2 form counts as in-coverage when its own coverage overlaps the export range.
  const matchingEr2Forms = er2Forms.filter(
    (f) => f.coverageStart <= endDate && f.coverageEnd >= startDate
  );
  const customRowCount = customTables.reduce((n, t) => n + t.rows.length, 0);

  const totalRows =
    coeWithPurpose.length +
    coeResigned.length +
    er2.length +
    sixthMonth.length +
    events.length;

  function coverageLabel(): string {
    const s = new Date(startDate);
    const e = new Date(endDate);
    // A whole calendar month reads as "September 2026", a single day as one date.
    if (startDate === endDate) return format(s, "MMMM d, yyyy");
    const monthStart = new Date(s.getFullYear(), s.getMonth(), 1);
    const monthEnd = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    if (
      s.getTime() === monthStart.getTime() &&
      format(e, "yyyy-MM-dd") === format(monthEnd, "yyyy-MM-dd")
    ) {
      return format(s, "MMMM yyyy");
    }
    const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
    return sameMonth
      ? `${format(s, "MMMM d")}–${format(e, "d, yyyy")}`
      : `${format(s, "MMMM d, yyyy")}–${format(e, "MMMM d, yyyy")}`;
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Fetched here rather than kept loaded the whole time this page is open — see the
      // reload() above.
      await reloadEr2Template();
      const er2Templates = getStoreSnapshot<ER2Template>("hr_er2_template");
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      type Sheet = ReturnType<InstanceType<typeof ExcelJS.Workbook>["addWorksheet"]>;

      // Excel rejects duplicate sheet names, which two custom tables sharing a title would hit.
      const usedNames = new Set<string>();
      function uniqueSheetName(name: string): string {
        const base = (name || "Table").slice(0, 31);
        if (!usedNames.has(base)) {
          usedNames.add(base);
          return base;
        }
        for (let i = 2; ; i++) {
          const candidate = `${base.slice(0, 31 - `${i}`.length - 1)} ${i}`;
          if (!usedNames.has(candidate)) {
            usedNames.add(candidate);
            return candidate;
          }
        }
      }

      function addSheet(name: string, widths: number[], title: string, headers: string[]): Sheet {
        const s = wb.addWorksheet(uniqueSheetName(name));
        s.columns = widths.map((width) => ({ width }));
        const t = s.addRow([title]);
        t.getCell(1).font = { bold: true, size: 12 };
        s.addRow([`Coverage: ${coverageLabel()}`]);
        s.addRow([]);
        const h = s.addRow(headers);
        h.eachCell((c) => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { ...HEADER_FILL };
        });
        return s;
      }

      /** Blank row, then a bold "Total: 5 Employees" under the sheet's table. */
      function addTotal(s: Sheet, count: number, noun: string) {
        s.addRow([]);
        const total = s.addRow([`Total: ${count} ${count === 1 ? noun : `${noun}s`}`]);
        total.getCell(1).font = { bold: true };
      }

      const summary = wb.addWorksheet("Summary");
      summary.columns = [{ width: 36 }, { width: 16 }];
      const heading = summary.addRow([`Reports — ${coverageLabel()}`]);
      heading.getCell(1).font = { bold: true, size: 14 };
      summary.addRow([`Date coverage`, `${startDate} to ${endDate}`]);
      summary.addRow([]);
      [
        ["COE with Purpose", coeWithPurpose.length],
        ["COE for Resigned Employees", coeResigned.length],
        ["ER2 Form for PhilHealth", er2.length],
        ["Employee 6th-Month", sixthMonth.length],
        ["ER2 forms in coverage", matchingEr2Forms.length],
        ["Events Attended", events.length],
        ["Custom table rows (all dates)", customRowCount],
      ].forEach(([label, count]) => summary.addRow([label, count]));

      const coeHeaders = ["Employee Name", "Position", "Department", "Email Address", "Date Requested", "Purpose", "Date Issued"];
      const coeWidths = [26, 24, 20, 28, 18, 26, 18];

      function coeRow(r: COERequest) {
        return [
          r.employeeName,
          r.position,
          r.department,
          r.email || employees.find((e) => e.name.trim().toLowerCase() === r.employeeName.trim().toLowerCase())?.realcognitaEmail || "",
          formatDate(r.dateRequested, "MMMM d, yyyy"),
          r.category === "endOfEmployment" ? "Resigned" : r.purpose || "—",
          r.dateGiven ? formatDate(r.dateGiven, "MMMM d, yyyy") : "—",
        ];
      }

      if (coeWithPurpose.length > 0) {
        const s = addSheet("COE with Purpose", coeWidths, "COE with Purpose", coeHeaders);
        coeWithPurpose.forEach((r) => s.addRow(coeRow(r)));
        addTotal(s, coeWithPurpose.length, "Employee");
      }
      if (coeResigned.length > 0) {
        const s = addSheet("COE for Resigned", coeWidths, "COE for Resigned Employees", coeHeaders);
        coeResigned.forEach((r) => s.addRow(coeRow(r)));
        addTotal(s, coeResigned.length, "Employee");
      }
      if (er2.length > 0) {
        const s = addSheet(
          "ER2 Form for PhilHealth",
          [26, 24, 20, 18],
          "ER2 Form for PhilHealth Report",
          ["Employee Name", "Position", "Department", "Date Created"]
        );
        er2.forEach((r) =>
          s.addRow([r.employeeName, r.position, r.department, formatDate(r.dateCreated, "MMMM d, yyyy")])
        );
        addTotal(s, er2.length, "Employee");
      }
      if (matchingEr2Forms.length > 0) {
        const s = wb.addWorksheet(uniqueSheetName("ER2 Form (PhilHealth)"));
        s.columns = [{ width: 26 }, { width: 30 }, { width: 26 }, { width: 14 }, { width: 22 }, { width: 26 }];
        const t = s.addRow(["ER2 Form for PhilHealth — completed forms"]);
        t.getCell(1).font = { bold: true, size: 12 };
        s.addRow([`Coverage: ${coverageLabel()}`]);
        const templateFile = er2Templates[0]?.fileName;
        s.addRow([
          "Template on file",
          templateFile || "None uploaded — the completed PDF is generated from the uploaded ER2 template",
        ]);

        matchingEr2Forms.forEach((formRecord) => {
          s.addRow([]);
          const head = s.addRow([formRecord.title]);
          head.getCell(1).font = { bold: true, color: { argb: "FF0A2E2A" } };
          head.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F0EE" } };
          s.addRow(["Coverage", `${formRecord.coverageStart} to ${formRecord.coverageEnd}`]);
          s.addRow([]);
          const h = s.addRow([
            "PhilHealth SSS/GSIS Number",
            "Name of Employee",
            "Position",
            "Salary",
            "Date of Employment",
          ]);
          h.eachCell((c) => {
            c.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c.fill = { ...HEADER_FILL };
          });
          formRecord.entries.forEach((entry) =>
            s.addRow([
              entry.philhealthNo,
              entry.name,
              entry.position,
              entry.salary,
              entry.dateOfEmployment,
            ])
          );
          s.addRow([]);
          const total = s.addRow([
            `Total: ${formRecord.entries.length} ${formRecord.entries.length === 1 ? "Employee" : "Employees"}`,
          ]);
          total.getCell(1).font = { bold: true };
        });
      }
      if (sixthMonth.length > 0) {
        const s = addSheet(
          "Employee 6th-Month",
          [26, 24, 20, 18, 24, 18],
          "Employee 6th-Month Report",
          [
            "Employee Name",
            "Position",
            "Department",
            "Salary Status",
            "Salary Increase Percentage",
            "6th Month Date",
          ]
        );
        sixthMonth.forEach((r) => {
          const employee = employees.find((e) => e.id === r.id);
          const review = employee?.sixthMonthSalaryReview;
          const percent = (employee?.regularizationIncreasePercent || "").trim();
          s.addRow([
            r.name,
            r.position,
            r.department,
            review === "withIncrease"
              ? "With Increase"
              : review === "asIs"
                ? "As Is Salary"
                : NOT_SET_LABEL,
            review === "withIncrease" ? (percent ? `${percent}%` : "") : review === "asIs" ? "N/A" : "",
            formatDate(r.sixthMonth, "MMMM d, yyyy"),
          ]);
        });
        addTotal(s, sixthMonth.length, "Employee");
      }
      if (events.length > 0) {
        const s = addSheet("Events Attended", [28, 18, 14, 14, 26, 14], "Events Attended Report", [
          "Event Name",
          "Date",
          "Start Time",
          "End Time",
          "Location",
          "Status",
        ]);
        events.forEach((r) =>
          s.addRow([
            r.eventName,
            formatDate(r.date, "MMMM d, yyyy"),
            formatTime12(r.time),
            formatTime12(r.endTime || ""),
            r.location,
            r.status ? EVENT_STATUS_LABELS[r.status] : "",
          ])
        );
        addTotal(s, events.length, "Event");
      }
      customTables.forEach((ct) => {
        if (ct.rows.length === 0) return;
        const s = addSheet(
          ct.title || "Custom Table",
          ct.columns.map(() => 22),
          ct.title,
          ct.columns
        );
        ct.rows.forEach((row) => s.addRow(ct.columns.map((col) => row[col] || "")));
        addTotal(s, ct.rows.length, "Record");
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `HR Reports - ${coverageLabel()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Reports exported to Excel", "created");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg text-ink">Export to Excel</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Pick a start and end date, then export every report table above — both COE tables included — into one
        Excel file.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Start date
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          End date
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <Button onClick={handleExport} disabled={exporting || startDate > endDate} className="ml-auto">
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
      </div>

      {startDate > endDate ? (
        <p className="mt-3 text-xs text-warn">Start date must be on or before the end date.</p>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">
          Coverage: {coverageLabel()} — {totalRows} dated record{totalRows === 1 ? "" : "s"}
          {customRowCount > 0 ? `, plus ${customRowCount} custom table row${customRowCount === 1 ? "" : "s"}` : ""}
          {totalRows === 0 && customRowCount === 0 ? " (nothing to export yet)" : ""}
        </p>
      )}
    </Card>
  );
}

