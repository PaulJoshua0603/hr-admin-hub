import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Employee, EmploymentMilestoneKey } from "@/types";
import {
  EMPLOYMENT_MILESTONE_LABELS,
  EMPLOYMENT_MILESTONE_MONTHS,
  EMPLOYMENT_MILESTONE_REMINDER_OFFSETS,
  getLackingRequirements,
} from "@/types";
import { addDaysISO, addMonthsISO, formatDate, isOverdue, isDueToday } from "@/lib/dates";

export type EmployeeAlert = {
  id: string;
  employeeId: string;
  label: string;
  detail: string;
  tone: "warn" | "accent";
  href: string;
};

const COE_LEAD_DAYS = 2;

function isOnOrAfterToday(iso: string): boolean {
  return differenceInCalendarDays(new Date(), parseISO(iso)) >= 0;
}

export function computeEmployeeAlerts(employees: Employee[]): EmployeeAlert[] {
  const alerts: EmployeeAlert[] = [];

  for (const e of employees) {
    const href = `/employees/${e.id}`;

    // Incomplete requirements — removed automatically once complete.
    const lacking = getLackingRequirements(e);
    if (lacking.length > 0) {
      alerts.push({
        id: `emp-req-${e.id}`,
        employeeId: e.id,
        label: isOverdue(e.requirementsDeadline)
          ? `${e.name} — requirements overdue`
          : `${e.name} — requirements incomplete`,
        detail: `Lacking: ${lacking.join(", ")}`,
        tone: isOverdue(e.requirementsDeadline) || !isDueToday(e.requirementsDeadline) ? "warn" : "accent",
        href,
      });
    }

    // Employment milestones — only for active (not offboarded) employees with a hire date.
    if (e.dateHired && !e.lastDay) {
      (Object.keys(EMPLOYMENT_MILESTONE_MONTHS) as EmploymentMilestoneKey[]).forEach((key) => {
        const milestoneDate = addMonthsISO(e.dateHired!, EMPLOYMENT_MILESTONE_MONTHS[key]);
        const offsets = EMPLOYMENT_MILESTONE_REMINDER_OFFSETS[key];
        const earliestTrigger = addDaysISO(
          milestoneDate,
          Math.min(...offsets.map((o) => o.offsetDays))
        );
        const latestTrigger = addDaysISO(
          milestoneDate,
          Math.max(...offsets.map((o) => o.offsetDays)) + 3
        );
        if (!isOnOrAfterToday(earliestTrigger)) return;
        if (differenceInCalendarDays(parseISO(latestTrigger), new Date()) < 0) return;
        alerts.push({
          id: `emp-milestone-${key}-${e.id}`,
          employeeId: e.id,
          label: `${e.name} — ${EMPLOYMENT_MILESTONE_LABELS[key]}`,
          detail: isOverdue(milestoneDate)
            ? `Was due ${formatDate(milestoneDate)}`
            : `Due ${formatDate(milestoneDate)}`,
          tone: isOverdue(milestoneDate) ? "warn" : "accent",
          href,
        });
      });
    }

    // COE prep — notify 2 days before Last Day, keep until COE Issued is checked.
    if (e.lastDay && !e.coeIssued) {
      const leadDate = addDaysISO(e.lastDay, -COE_LEAD_DAYS);
      if (isOnOrAfterToday(leadDate)) {
        alerts.push({
          id: `emp-coe-${e.id}`,
          employeeId: e.id,
          label: `${e.name} — generate COE`,
          detail: isOverdue(e.lastDay)
            ? `Last day was ${formatDate(e.lastDay)}`
            : `Last day is ${formatDate(e.lastDay)}`,
          tone: "warn",
          href,
        });
      }
    }
  }

  return alerts;
}
