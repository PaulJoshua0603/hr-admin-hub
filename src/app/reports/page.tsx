"use client";

import { useMemo, useState } from "react";
import { startOfWeek, addDays, format, parseISO } from "date-fns";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, SectionHeading } from "@/components/ui";
import { useNotifications } from "@/lib/notificationContext";
import {
  EMPLOYMENT_MILESTONE_MONTHS,
  getLackingRequirements,
  type COERequest,
  type Employee,
} from "@/types";
import { addMonthsISO, formatDate } from "@/lib/dates";

const BRAND_TEAL = "0E5E56";
const BRAND_TEAL_DARK = "0A2E2A";
const LIGHT_TEAL = "E4F0EE";
const SUCCESS_GREEN = "3F7D52";
const SUCCESS_SOFT = "E7F2EA";
const WARN_ORANGE = "C1502B";
const WARN_SOFT = "FBE9E1";
const WHITE = "FFFFFF";
const BORDER_GREY = "DDE3DD";

const STANDARD_HEADERS = [
  "Employee Name",
  "Position",
  "Department",
  "Hired/Onboarding Date",
  "Requirements Status",
  "Lacking Requirements",
  "3rd Month Date",
  "6th Month Date",
  "1-Year Anniversary Date",
];

const COE_HEADERS = [
  "Employee Name",
  "Position",
  "Department",
  "Purpose",
  "Date Requested",
  "Date COE Given",
];

type StandardRow = {
  name: string;
  position: string;
  department: string;
  hired: string;
  status: "Complete" | "Incomplete" | "—";
  lacking: string;
  third: string;
  sixth: string;
  oneYear: string;
};

function toStandardRow(e: Employee): StandardRow {
  const lacking = getLackingRequirements(e);
  const status: StandardRow["status"] = lacking.length === 0 ? "Complete" : "Incomplete";
  const hired = e.dateHired;
  return {
    name: e.name,
    position: e.position || "",
    department: e.department || "",
    hired: hired ? formatDate(hired, "MMMM d, yyyy") : "",
    status,
    lacking: lacking.length > 0 ? lacking.join("; ") : "",
    third: hired ? formatDate(addMonthsISO(hired, EMPLOYMENT_MILESTONE_MONTHS.thirdMonth), "MMMM d, yyyy") : "",
    sixth: hired ? formatDate(addMonthsISO(hired, EMPLOYMENT_MILESTONE_MONTHS.sixthMonth), "MMMM d, yyyy") : "",
    oneYear: hired ? formatDate(addMonthsISO(hired, EMPLOYMENT_MILESTONE_MONTHS.oneYear), "MMMM d, yyyy") : "",
  };
}

export default function ReportsPage() {
  const { items: employees, hydrated: employeesReady } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );
  const { items: coeRequests, hydrated: coeReady } = useSupabaseStore<COERequest>(
    "hr_coe_requests",
    []
  );
  const { notify } = useNotifications();
  const [generating, setGenerating] = useState(false);

  const summary = useMemo(() => {
    const withHireDate = employees.filter((e) => e.dateHired).length;
    const withBirthday = employees.filter((e) => e.birthday).length;
    return { total: employees.length, withHireDate, withBirthday, coeCount: coeRequests.length };
  }, [employees, coeRequests]);

  async function generateWorkbook() {
    setGenerating(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "HR Admin Hub";
      wb.created = new Date();

      const weeklySheet = wb.addWorksheet("Weekly Report");
      const monthlySheet = wb.addWorksheet("Monthly Report");
      const yearlySheet = wb.addWorksheet("Yearly Report");
      const birthdaySheet = wb.addWorksheet("Birthdays");

      buildGroupedSheet(weeklySheet, groupByWeek(employees), coeRequests);
      buildGroupedSheet(monthlySheet, groupByMonth(employees), coeRequests);
      buildGroupedSheet(yearlySheet, groupByYear(employees), coeRequests);
      buildBirthdaySheet(birthdaySheet, employees);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `HR_Admin_Employee_Report_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      notify("Employee Excel report generated", "created");
    } finally {
      setGenerating(false);
    }
  }

  if (!employeesReady || !coeReady) return null;

  return (
    <div>
      <SectionHeading
        title="Reports"
        subtitle="Generate a professionally formatted, four-sheet Excel report from your Employees database."
      />

      <Card className="mb-6">
        <h2 className="font-display text-lg text-ink">Employee Report (Excel)</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Builds a styled workbook with four sheets: Weekly Report (grouped by
          the Mon-Fri week of each employee&apos;s Hired/Onboarding Date), Monthly
          Report, Yearly Report — each including standard employee columns
          plus a COE Tracking table appended at the bottom — and a Birthdays
          sheet grouped by month.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-2xl font-semibold text-ink">{summary.total}</p>
            <p className="text-xs text-ink-muted">Employees</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-ink">{summary.withHireDate}</p>
            <p className="text-xs text-ink-muted">With hire date</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-ink">{summary.withBirthday}</p>
            <p className="text-xs text-ink-muted">With birthday</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-ink">{summary.coeCount}</p>
            <p className="text-xs text-ink-muted">COE requests</p>
          </div>
        </div>

        <Button className="mt-5" onClick={generateWorkbook} disabled={generating}>
          {generating ? "Generating…" : "Download Employee Report (Excel)"}
        </Button>
      </Card>
    </div>
  );
}

/* ------------------------------ Grouping helpers ------------------------------ */

type Group = { title: string; rows: StandardRow[] };

function groupByWeek(employees: Employee[]): Group[] {
  const withDate = employees.filter((e) => e.dateHired);
  const map = new Map<string, Employee[]>();
  for (const e of withDate) {
    const monday = startOfWeek(parseISO(e.dateHired!), { weekStartsOn: 1 });
    const key = monday.toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.keys())
    .sort()
    .map((key) => {
      const monday = parseISO(key);
      const friday = addDays(monday, 4);
      return {
        title: `Week of ${format(monday, "MMM d")} - ${format(friday, "MMM d, yyyy")} (Mon-Fri)`,
        rows: map.get(key)!.map(toStandardRow),
      };
    });
}

function groupByMonth(employees: Employee[]): Group[] {
  const withDate = employees.filter((e) => e.dateHired);
  const map = new Map<string, Employee[]>();
  for (const e of withDate) {
    const key = format(parseISO(e.dateHired!), "yyyy-MM");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.keys())
    .sort()
    .map((key) => ({
      title: format(parseISO(`${key}-01`), "MMMM yyyy"),
      rows: map.get(key)!.map(toStandardRow),
    }));
}

function groupByYear(employees: Employee[]): Group[] {
  const withDate = employees.filter((e) => e.dateHired);
  const map = new Map<string, Employee[]>();
  for (const e of withDate) {
    const key = format(parseISO(e.dateHired!), "yyyy");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.keys())
    .sort()
    .map((key) => ({ title: key, rows: map.get(key)!.map(toStandardRow) }));
}

/* ------------------------------ Sheet builders ------------------------------ */

// Using a loose type here since ExcelJS's Worksheet type is only imported
// dynamically at call time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function styleHeaderRow(row: any, color = BRAND_TEAL) {
  row.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: `FF${WHITE}` }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      top: { style: "thin", color: { argb: `FF${color}` } },
      bottom: { style: "thin", color: { argb: `FF${color}` } },
    };
  });
  row.height = 20;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function styleGroupTitleRow(row: any) {
  row.eachCell((cell: any) => {
    cell.font = { bold: true, size: 12, color: { argb: `FF${BRAND_TEAL_DARK}` } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${LIGHT_TEAL}` } };
  });
  row.height = 22;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function styleDataRow(row: any, statusColIndex?: number, statusValue?: string) {
  row.eachCell((cell: any, colNumber: number) => {
    cell.border = {
      top: { style: "hair", color: { argb: `FF${BORDER_GREY}` } },
      bottom: { style: "hair", color: { argb: `FF${BORDER_GREY}` } },
      left: { style: "hair", color: { argb: `FF${BORDER_GREY}` } },
      right: { style: "hair", color: { argb: `FF${BORDER_GREY}` } },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
    if (statusColIndex && colNumber === statusColIndex) {
      if (statusValue === "Complete") {
        cell.font = { bold: true, color: { argb: `FF${SUCCESS_GREEN}` } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${SUCCESS_SOFT}` } };
      } else if (statusValue === "Incomplete") {
        cell.font = { bold: true, color: { argb: `FF${WARN_ORANGE}` } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${WARN_SOFT}` } };
      }
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setStandardColumnWidths(ws: any) {
  ws.columns = [
    { width: 26 },
    { width: 22 },
    { width: 18 },
    { width: 20 },
    { width: 16 },
    { width: 34 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildGroupedSheet(ws: any, groups: Group[], coeRequests: COERequest[]) {
  setStandardColumnWidths(ws);

  if (groups.length === 0) {
    const headerRow = ws.addRow(STANDARD_HEADERS);
    styleHeaderRow(headerRow);
    const emptyRow = ws.addRow(["No employees with a Hired/Onboarding Date yet."]);
    ws.mergeCells(emptyRow.number, 1, emptyRow.number, STANDARD_HEADERS.length);
    emptyRow.getCell(1).font = { italic: true, color: { argb: "FF808080" } };
  }

  for (const group of groups) {
    const titleRow = ws.addRow([group.title]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, STANDARD_HEADERS.length);
    styleGroupTitleRow(titleRow);

    const headerRow = ws.addRow(STANDARD_HEADERS);
    styleHeaderRow(headerRow, BRAND_TEAL_DARK);

    group.rows.forEach((r) => {
      const row = ws.addRow([
        r.name,
        r.position,
        r.department,
        r.hired,
        r.status,
        r.lacking,
        r.third,
        r.sixth,
        r.oneYear,
      ]);
      styleDataRow(row, 5, r.status);
    });

    ws.addRow([]);
  }

  // COE Tracking append
  const coeTitleRow = ws.addRow(["Certificate of Employment (COE) Tracking"]);
  ws.mergeCells(coeTitleRow.number, 1, coeTitleRow.number, COE_HEADERS.length);
  styleGroupTitleRow(coeTitleRow);

  const coeHeaderRow = ws.addRow(COE_HEADERS);
  styleHeaderRow(coeHeaderRow, BRAND_TEAL_DARK);

  if (coeRequests.length === 0) {
    const noneRow = ws.addRow(["No COE requests logged."]);
    ws.mergeCells(noneRow.number, 1, noneRow.number, COE_HEADERS.length);
    noneRow.getCell(1).font = { italic: true, color: { argb: "FF808080" } };
  } else {
    coeRequests.forEach((c) => {
      const row = ws.addRow([
        c.employeeName,
        c.position || "",
        c.department || "",
        c.purpose || "",
        formatDate(c.dateRequested, "MMMM d, yyyy"),
        c.dateGiven ? formatDate(c.dateGiven, "MMMM d, yyyy") : "",
      ]);
      styleDataRow(row);
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBirthdaySheet(ws: any, employees: Employee[]) {
  ws.columns = [{ width: 26 }, { width: 22 }, { width: 18 }, { width: 16 }];

  const withBday = employees.filter((e) => e.birthday);
  const byMonth = new Map<number, Employee[]>();
  for (const e of withBday) {
    const m = parseISO(e.birthday!).getMonth();
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(e);
  }

  if (withBday.length === 0) {
    const row = ws.addRow(["No employee birthdays on file yet."]);
    row.getCell(1).font = { italic: true, color: { argb: "FF808080" } };
    return;
  }

  for (let m = 0; m < 12; m++) {
    const list = byMonth.get(m);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => parseISO(a.birthday!).getDate() - parseISO(b.birthday!).getDate());

    const titleRow = ws.addRow([format(new Date(2000, m, 1), "MMMM")]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, 4);
    styleGroupTitleRow(titleRow);

    const headerRow = ws.addRow(["Employee Name", "Position", "Department", "Birthday"]);
    styleHeaderRow(headerRow, BRAND_TEAL_DARK);

    list.forEach((e) => {
      const row = ws.addRow([
        e.name,
        e.position || "",
        e.department || "",
        formatDate(e.birthday!, "MMMM d"),
      ]);
      styleDataRow(row);
    });

    ws.addRow([]);
  }
}
