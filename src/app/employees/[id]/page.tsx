"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { useNotifications } from "@/lib/notificationContext";
import { addDaysISO, addMonthsISO, daysSince, formatDate, isOverdue, nextMondayISO, todayISO } from "@/lib/dates";
import {
  exportContractOfEmploymentDocx,
  exportEndorsementLetterDocx,
  exportRequirementsListDocx,
  uploadContractTemplate,
} from "@/lib/docExport";
import {
  Button,
  Card,
  Checkbox,
  FieldGroup,
  Input,
  Pill,
  SectionHeading,
  StatusSelect,
  Textarea,
} from "@/components/ui";
import {
  EMPLOYMENT_MILESTONE_MONTHS,
  EMPLOYMENT_MILESTONE_LABELS,
  EMPLOYMENT_MILESTONE_REMINDER_OFFSETS,
  emptyMedicalExamChecklist,
  emptyPreEmploymentChecklist,
  defaultOnboardingChecklist,
  MEDICAL_EXAM_CHECKLIST_LABELS,
  PRE_EMPLOYMENT_CHECKLIST_LABELS,
  REQUIREMENT_LABELS,
  REQUIREMENT_STATUS_LABELS,
  RESIGNED_STATUS_LABELS,
  getLackingRequirements,
  getMissingCriticalItems,
  type Employee,
  type EmploymentMilestoneKey,
  type MedicalExamChecklistKey,
  type OnboardingChecklistCategory,
  type PreEmploymentChecklistKey,
  type RequirementKey,
  type RequirementStatus,
  type ResignedStatus,
  type Task,
} from "@/types";

const LAST_PAY_DAYS_AFTER_LAST_DAY = 35;

function requirementTone(
  s: RequirementStatus
): "neutral" | "success" | "warn" | "accent" {
  if (s === "complete") return "success";
  if (s === "lacking") return "warn";
  if (s === "withdrawApplication") return "accent";
  return "neutral";
}

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { items: employees, hydrated, update, remove } = useSupabaseStore<Employee>(
    "hr_employees",
    []
  );
  const { items: tasks, add: addTask } = useSupabaseStore<Task>("hr_tasks", []);
  const employee = employees.find((e) => e.id === id);
  const [birthdayInput, setBirthdayInput] = useState(
    employee?.birthday ? employee.birthday.slice(0, 10) : ""
  );
  const [hireDateInput, setHireDateInput] = useState(
    employee?.dateHired ? employee.dateHired.slice(0, 10) : ""
  );
  const [lastDayInput, setLastDayInput] = useState(
    employee?.lastDay ? employee.lastDay.slice(0, 10) : ""
  );
  const [lastPayDateInput, setLastPayDateInput] = useState(
    employee?.lastPayDate ? employee.lastPayDate.slice(0, 10) : ""
  );
  const [sentDateInput, setSentDateInput] = useState(
    employee?.dateRequirementsSent
      ? employee.dateRequirementsSent.slice(0, 10)
      : employee?.dateAdded
      ? employee.dateAdded.slice(0, 10)
      : ""
  );
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [checklistEditing, setChecklistEditing] = useState(false);
  const [newItemLabels, setNewItemLabels] = useState<Record<string, string>>({});
  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  const { notify } = useNotifications();

  // useState initial values above only run once, before hydration finishes,
  // so re-sync the inputs once the employee record has actually loaded.
  useEffect(() => {
    if (!hydrated || !employee) return;
    setBirthdayInput(employee.birthday ? employee.birthday.slice(0, 10) : "");
    setHireDateInput(employee.dateHired ? employee.dateHired.slice(0, 10) : "");
    setLastDayInput(employee.lastDay ? employee.lastDay.slice(0, 10) : "");
    setLastPayDateInput(employee.lastPayDate ? employee.lastPayDate.slice(0, 10) : "");
    setSentDateInput(
      employee.dateRequirementsSent
        ? employee.dateRequirementsSent.slice(0, 10)
        : employee.dateAdded
        ? employee.dateAdded.slice(0, 10)
        : ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, employee?.id]);

  // Auto-manage "Regular employee": auto-check once the 6th month milestone is
  // reached (unless resigned), and auto-uncheck as soon as the employee resigns.
  useEffect(() => {
    if (!hydrated || !employee) return;
    if (employee.resignedStatus === "resigned") {
      if (employee.isRegular) update(employee.id, { isRegular: false });
      return;
    }
    if (!employee.dateHired || employee.isRegular) return;
    const sixthMonthISO = addMonthsISO(employee.dateHired, EMPLOYMENT_MILESTONE_MONTHS.sixthMonth);
    if (new Date(sixthMonthISO).getTime() <= Date.now()) {
      update(employee.id, { isRegular: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, employee?.id, employee?.dateHired, employee?.resignedStatus, employee?.isRegular]);

  if (!hydrated) return null;
  if (!employee) {
    return (
      <div>
        <p className="text-sm text-ink-muted">Employee not found.</p>
        <Link href="/employees" className="text-sm text-accent underline">
          Back to employees
        </Link>
      </div>
    );
  }

  function setRequirementStatus(key: RequirementKey, status: RequirementStatus) {
    const patch: Partial<Employee> = {
      requirements: { ...employee!.requirements, [key]: status },
    };
    if (status === "complete") {
      if (key === "listOfRequirements") {
        const allChecked = Object.keys(PRE_EMPLOYMENT_CHECKLIST_LABELS).reduce(
          (acc, k) => ({ ...acc, [k]: true }),
          {} as Record<PreEmploymentChecklistKey, boolean>
        );
        patch.preEmploymentChecklist = allChecked;
      }
      if (key === "preEmploymentMedical") {
        const allChecked = Object.keys(MEDICAL_EXAM_CHECKLIST_LABELS).reduce(
          (acc, k) => ({ ...acc, [k]: true }),
          {} as Record<MedicalExamChecklistKey, boolean>
        );
        patch.medicalExamChecklist = allChecked;
      }
    }
    update(employee!.id, patch);
    notify(`${employee!.name} — ${REQUIREMENT_LABELS[key]} marked ${status}`, "updated");
  }

  function setRequirementNote(key: RequirementKey, note: string) {
    update(employee!.id, {
      requirementNotes: { ...employee!.requirementNotes, [key]: note },
    });
  }

  function setCombinedRequirementStatus(status: RequirementStatus) {
    const patch: Partial<Employee> = {
      requirements: {
        listOfRequirements: status,
        preEmploymentMedical: status,
      },
    };
    if (status === "complete") {
      patch.preEmploymentChecklist = Object.keys(PRE_EMPLOYMENT_CHECKLIST_LABELS).reduce(
        (acc, k) => ({ ...acc, [k]: true }),
        {} as Record<PreEmploymentChecklistKey, boolean>
      );
      patch.medicalExamChecklist = Object.keys(MEDICAL_EXAM_CHECKLIST_LABELS).reduce(
        (acc, k) => ({ ...acc, [k]: true }),
        {} as Record<MedicalExamChecklistKey, boolean>
      );
      patch.requirementsCompletedAt = todayISO();
    } else {
      patch.requirementsCompletedAt = undefined;
    }
    update(employee!.id, patch);
    notify(
      `${employee!.name} — Pre-Employment Requirements marked ${
        status === "complete" ? "Complete" : "Incomplete"
      }`,
      "updated"
    );
  }

  function setCombinedRequirementNote(note: string) {
    update(employee!.id, {
      requirementNotes: {
        ...employee!.requirementNotes,
        listOfRequirements: note,
        preEmploymentMedical: note,
      },
    });
  }

  function handleBirthdayChange(value: string) {
    setBirthdayInput(value);
    if (!value) return;
    update(employee!.id, {
      birthday: new Date(value).toISOString(),
    });
  }

  function handleHireDateChange(value: string) {
    setHireDateInput(value);
    if (!value) return;
    update(employee!.id, {
      dateHired: new Date(value).toISOString(),
    });
  }

  function applySuggestedOnboardingDate(iso: string) {
    setHireDateInput(iso.slice(0, 10));
    update(employee!.id, { dateHired: iso });
    notify(`${employee!.name} — onboarding date moved to ${formatDate(iso)}`, "updated");
  }

  function saveLastPayDate() {
    if (!lastPayDateInput) return;
    update(employee!.id, {
      lastPayDate: new Date(lastPayDateInput).toISOString(),
    });
    notify(`${employee!.name} — last pay date saved`, "updated");
  }

  function handleLastDayChange(value: string) {
    setLastDayInput(value);
    if (!value) return;
    const lastDayISO = new Date(value).toISOString();
    const autoLastPay = addDaysISO(lastDayISO, LAST_PAY_DAYS_AFTER_LAST_DAY);
    setLastPayDateInput(autoLastPay.slice(0, 10));
    update(employee!.id, {
      lastDay: lastDayISO,
      lastPayDate: autoLastPay,
    });
    notify(
      `${employee!.name} — last day saved, last pay date auto-set to ${formatDate(autoLastPay)}`,
      "updated"
    );
  }

  function sendMilestoneReminders() {
    if (!employee!.dateHired) return;
    const keys = Object.keys(EMPLOYMENT_MILESTONE_LABELS) as EmploymentMilestoneKey[];
    let created = 0;
    const now = todayISO();
    keys.forEach((key) => {
      const milestoneISO = addMonthsISO(employee!.dateHired!, EMPLOYMENT_MILESTONE_MONTHS[key]);
      EMPLOYMENT_MILESTONE_REMINDER_OFFSETS[key].forEach((reminder) => {
        const dueISO = addDaysISO(milestoneISO, reminder.offsetDays);
        const title = `${employee!.name} — ${EMPLOYMENT_MILESTONE_LABELS[key]} (${reminder.label})`;
        const alreadyExists = tasks.some((t) => t.title === title);
        if (alreadyExists) return;
        addTask({
          id: uuid(),
          title,
          notes: "Auto-generated employment milestone reminder.",
          createdAt: now,
          inputDate: now,
          dateNeeded: dueISO,
          accomplished: false,
        });
        created += 1;
      });
    });
    update(employee!.id, { milestoneRemindersSentAt: todayISO() });
    notify(
      created > 0
        ? `${employee!.name} — ${created} milestone reminder(s) added to Tasks`
        : `${employee!.name} — milestone reminders already exist`,
      "updated"
    );
  }



  function addCategory() {
    if (!newCategoryTitle.trim()) return;
    const current = employee!.onboardingChecklist || [];
    const category: OnboardingChecklistCategory = {
      id: uuid(),
      title: newCategoryTitle.trim(),
      items: [],
    };
    update(employee!.id, { onboardingChecklist: [...current, category] });
    setNewCategoryTitle("");
  }

  function setCategoryTitle(catId: string, title: string) {
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.map((c) => (c.id === catId ? { ...c, title } : c)),
    });
  }

  function removeCategory(catId: string) {
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.filter((c) => c.id !== catId),
    });
  }

  function addItem(catId: string) {
    const label = (newItemLabels[catId] || "").trim();
    if (!label) return;
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.map((c) =>
        c.id === catId
          ? { ...c, items: [...c.items, { id: uuid(), label, checked: false }] }
          : c
      ),
    });
    setNewItemLabels((prev) => ({ ...prev, [catId]: "" }));
  }

  function setItemLabel(catId: string, itemId: string, label: string) {
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.map((c) =>
        c.id === catId
          ? { ...c, items: c.items.map((it) => (it.id === itemId ? { ...it, label } : it)) }
          : c
      ),
    });
  }

  function toggleItem(catId: string, itemId: string, checked: boolean) {
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.map((c) =>
        c.id === catId
          ? { ...c, items: c.items.map((it) => (it.id === itemId ? { ...it, checked } : it)) }
          : c
      ),
    });
  }

  function removeItem(catId: string, itemId: string) {
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.map((c) =>
        c.id === catId ? { ...c, items: c.items.filter((it) => it.id !== itemId) } : c
      ),
    });
  }

  function handleSaveAll() {
    setIsEditing(false);
    notify(`${employee!.name} — changes saved`, "updated");
  }

  function handleSentDateChange(value: string) {
    setSentDateInput(value);
    if (!value) return;
    const sentISO = new Date(value).toISOString();
    update(employee!.id, {
      dateRequirementsSent: sentISO,
      requirementsDeadline: addDaysISO(sentISO, 14),
    });
    notify(`${employee!.name} — requirements sent date saved`, "updated");
  }

  function setChecklistItem(key: PreEmploymentChecklistKey, checked: boolean) {
    const current = employee!.preEmploymentChecklist || emptyPreEmploymentChecklist();
    update(employee!.id, {
      preEmploymentChecklist: { ...current, [key]: checked },
    });
  }

  function setMedicalChecklistItem(key: MedicalExamChecklistKey, checked: boolean) {
    const current = employee!.medicalExamChecklist || emptyMedicalExamChecklist();
    update(employee!.id, {
      medicalExamChecklist: { ...current, [key]: checked },
    });
  }

  const milestones = employee.dateHired
    ? (Object.keys(EMPLOYMENT_MILESTONE_LABELS) as EmploymentMilestoneKey[]).map((key) => ({
        key,
        label: EMPLOYMENT_MILESTONE_LABELS[key],
        date: addMonthsISO(employee.dateHired!, EMPLOYMENT_MILESTONE_MONTHS[key]),
      }))
    : [];

  const completeCount = Object.values(employee.requirements).filter(
    (s) => s === "complete"
  ).length;
  const totalCount = Object.keys(employee.requirements).length;

  const onboardingCategories = employee.onboardingChecklist || [];
  const onboardingAllItems = onboardingCategories.flatMap((c) => c.items);
  const onboardingChecked = onboardingAllItems.filter((it) => it.checked).length;
  const onboardingTotal = onboardingAllItems.length;

  const lackingRequirements = getLackingRequirements(employee);
  const missingCritical = getMissingCriticalItems(employee);
  const suggestedOnboardingDate = nextMondayISO(employee.dateHired);
  const requirementCompletionDeadline = employee.dateHired
    ? addDaysISO(employee.dateHired, 14)
    : null;

  return (
    <div className="max-w-[1800px]">
      <Link
        href="/employees"
        className="group mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-ink-muted shadow-sm transition-all duration-200 hover:-translate-x-0.5 hover:border-accent/40 hover:bg-accent-soft hover:text-accent hover:shadow-md"
      >
        <span className="transition-transform duration-200 group-hover:-translate-x-0.5">←</span>
        Employees
      </Link>

      <SectionHeading
        title={employee.name}
        subtitle={[employee.position, employee.department].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex items-center gap-2">
            {isEditing ? (
              <Button variant="primary" onClick={handleSaveAll}>
                Save
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                if (!window.confirm(`Delete ${employee.name}? This cannot be undone.`)) return;
                notify(`Employee removed: "${employee.name}"`, "deleted");
                remove(employee.id);
                window.location.href = "/employees";
              }}
            >
              Delete employee
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <h2 className="font-display text-lg text-ink">Employee details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldGroup label="Birthday">
            <div className="flex w-full flex-col gap-1">
              <Input
                type="date"
                value={birthdayInput}
                disabled={!isEditing}
                onChange={(e) => handleBirthdayChange(e.target.value)}
              />
              {employee.birthday && (
                <p className="text-xs text-ink-muted">
                  {formatDate(employee.birthday, "MMMM d, yyyy")}
                </p>
              )}
            </div>
          </FieldGroup>
          <FieldGroup label="Hired/Onboarding Date">
            <div className="flex w-full flex-col gap-1">
              <Input
                type="date"
                value={hireDateInput}
                disabled={!isEditing}
                onChange={(e) => handleHireDateChange(e.target.value)}
              />
              {employee.dateHired && (
                <p className="text-xs text-ink-muted">
                  {formatDate(employee.dateHired, "MMMM d, yyyy")}
                </p>
              )}
            </div>
          </FieldGroup>
        </div>
        {missingCritical.length > 0 && (
          <div className="mt-4 rounded-md border border-warn/30 bg-warn-soft p-3">
            <p className="text-sm font-medium text-warn">
              Critical requirements incomplete: {missingCritical.join(", ")}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Suggested onboarding date: {formatDate(suggestedOnboardingDate)} (next Monday)
            </p>
            <Button
              variant="ghost"
              className="mt-2"
              disabled={!isEditing}
              onClick={() => applySuggestedOnboardingDate(suggestedOnboardingDate)}
            >
              Use suggested date
            </Button>
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="font-display text-lg text-ink">Compensation</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldGroup label="Basic Salary">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                ₱
              </span>
              <Input
                type="text"
                inputMode="decimal"
                className="pl-7"
                value={employee.basicSalary || ""}
                disabled={!isEditing}
                onChange={(e) => update(employee.id, { basicSalary: e.target.value })}
              />
            </div>
          </FieldGroup>
          <FieldGroup label="Total Monthly Gross Compensation Income">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                ₱
              </span>
              <Input
                type="text"
                inputMode="decimal"
                className="pl-7"
                value={employee.totalMonthlyGrossCompensation || ""}
                disabled={!isEditing}
                onChange={(e) => update(employee.id, { totalMonthlyGrossCompensation: e.target.value })}
              />
            </div>
          </FieldGroup>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="font-display text-lg text-ink">Identification & Profile</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FieldGroup label="PhilHealth No.">
            <Input
              value={employee.philhealthNo || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { philhealthNo: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="ID Number (Company ID)">
            <Input
              value={employee.companyIdNumber || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { companyIdNumber: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Biometrics No.">
            <Input
              value={employee.biometricsNo || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { biometricsNo: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Realcognita Issued Email">
            <Input
              type="email"
              value={employee.realcognitaEmail || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { realcognitaEmail: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Home Address">
            <Input
              value={employee.homeAddress || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { homeAddress: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="City">
            <Input
              placeholder="e.g. Taguig City"
              value={employee.homeCity || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { homeCity: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Working Hours">
            <select
              value={employee.workingHours || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { workingHours: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Select shift…</option>
              <option value="6:30am – 3:00pm">6:30am – 3:00pm</option>
              <option value="7:00am – 4:00pm">7:00am – 4:00pm</option>
              <option value="7:30am – 4:30pm">7:30am – 4:30pm</option>
            </select>
          </FieldGroup>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <h2 className="font-display text-lg text-ink">Pre-Employment Requirements</h2>
            <Pill tone={completeCount === totalCount ? "success" : "accent"}>
              {completeCount === totalCount ? "Complete" : "Incomplete"}
            </Pill>
          </div>

          <div className="mt-4 rounded-md bg-background p-3">
            <div className="flex flex-wrap items-end gap-3">
              <FieldGroup label="Date MC sent pre-employment requirements">
                <div className="flex w-full flex-col gap-1">
                  <Input
                    type="date"
                    value={sentDateInput}
                    disabled={!isEditing}
                    onChange={(e) => handleSentDateChange(e.target.value)}
                  />
                  {employee.dateRequirementsSent && (
                    <p className="text-xs text-ink-muted">
                      {formatDate(employee.dateRequirementsSent, "MMMM d, yyyy")}
                    </p>
                  )}
                </div>
              </FieldGroup>
            </div>

            {employee.dateRequirementsSent && (
              <div className="mt-3 flex flex-col gap-1">
                <p className="text-xs text-ink-muted">
                  Deadline (auto, +14 days):{" "}
                  <span
                    className={`font-medium ${
                      completeCount !== totalCount && isOverdue(employee.requirementsDeadline)
                        ? "text-warn"
                        : "text-ink"
                    }`}
                  >
                    {formatDate(employee.requirementsDeadline, "MMMM d, yyyy")}
                  </span>
                </p>
                <p className="text-xs text-ink-muted">
                  Turnaround:{" "}
                  {completeCount === totalCount && employee.requirementsCompletedAt ? (
                    <span className="font-medium text-success">
                      Completed in {daysSince(employee.dateRequirementsSent)} day
                      {daysSince(employee.dateRequirementsSent) === 1 ? "" : "s"} (
                      {formatDate(employee.requirementsCompletedAt, "MMM d, yyyy")})
                    </span>
                  ) : (
                    <span className="font-medium text-warn">
                      {daysSince(employee.dateRequirementsSent)} day
                      {daysSince(employee.dateRequirementsSent) === 1 ? "" : "s"} elapsed, still
                      incomplete
                    </span>
                  )}
                </p>
                {completeCount !== totalCount && (
                  <p className="text-xs text-warn">
                    Lacking:{" "}
                    {employee.requirementNotes?.listOfRequirements ||
                      employee.requirementNotes?.preEmploymentMedical ||
                      "Not specified yet"}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setChecklistOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-sm font-medium text-ink hover:text-accent"
                >
                  <span
                    className={`inline-block text-ink-muted transition-transform ${
                      checklistOpen ? "rotate-90" : ""
                    }`}
                  >
                    ›
                  </span>
                  Pre-Employment Requirements — checklist
                </button>
                <StatusSelect
                  value={completeCount === totalCount ? "complete" : "lacking"}
                  onChange={(v) => setCombinedRequirementStatus(v)}
                  options={["complete", "lacking"] as const as RequirementStatus[]}
                  labels={{ complete: "Complete Requirements", lacking: "Incomplete Requirements" } as Record<RequirementStatus, string>}
                  tone={(v) => (v === "complete" ? "success" : "warn")}
                  disabled={!isEditing}
                />
              </div>

              {completeCount !== totalCount && (
                <Textarea
                  className="mt-3"
                  placeholder="Which documents are lacking or missing?"
                  rows={2}
                  disabled={!isEditing}
                  value={
                    employee.requirementNotes?.listOfRequirements ||
                    employee.requirementNotes?.preEmploymentMedical ||
                    ""
                  }
                  onChange={(e) => setCombinedRequirementNote(e.target.value)}
                />
              )}

              {checklistOpen && (
                <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 pl-4">
                  {(Object.keys(PRE_EMPLOYMENT_CHECKLIST_LABELS) as PreEmploymentChecklistKey[]).map(
                    (ck) => {
                      const checked = employee.preEmploymentChecklist?.[ck] || false;
                      return (
                        <Checkbox
                          key={ck}
                          checked={checked}
                          disabled={!isEditing}
                          onChange={(c) => setChecklistItem(ck, c)}
                          label={PRE_EMPLOYMENT_CHECKLIST_LABELS[ck]}
                        />
                      );
                    }
                  )}
                  <p className="mt-3 text-xs font-semibold text-ink-muted">
                    Pre-Employment Medical Exam (Original Copies)
                  </p>
                  {(Object.keys(MEDICAL_EXAM_CHECKLIST_LABELS) as MedicalExamChecklistKey[]).map(
                    (mk) => {
                      const checked = employee.medicalExamChecklist?.[mk] || false;
                      return (
                        <Checkbox
                          key={mk}
                          checked={checked}
                          disabled={!isEditing}
                          onChange={(c) => setMedicalChecklistItem(mk, c)}
                          label={MEDICAL_EXAM_CHECKLIST_LABELS[mk]}
                        />
                      );
                    }
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg text-ink">Employment milestones</h2>
            <Button
              variant="ghost"
              disabled={!employee.dateHired}
              onClick={sendMilestoneReminders}
            >
              Send milestone reminders
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Checkbox
              checked={employee.isRegular}
              disabled={!isEditing}
              onChange={(c) => update(employee.id, { isRegular: c })}
              label="Regular employee (stays Regular until changed here)"
            />
          </div>

          {milestones.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {milestones.map((m) => (
                <li
                  key={m.key}
                  className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm"
                >
                  <span className="text-ink">{m.label}</span>
                  <span className="text-ink-muted">{formatDate(m.date)}</span>
                </li>
              ))}
            </ul>
          )}
          {milestones.length === 0 && (
            <p className="mt-4 text-xs text-ink-muted">
              Set the onboarding date above to auto-calculate milestones.
            </p>
          )}
          {employee.milestoneRemindersSentAt && (
            <p className="mt-2 text-xs text-ink-muted">
              Reminders last sent {formatDate(employee.milestoneRemindersSentAt)}
            </p>
          )}

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="font-display text-sm text-ink">Offboarding</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldGroup label="Resigned Status">
                <select
                  value={employee.resignedStatus || "active"}
                  disabled={!isEditing}
                  onChange={(e) =>
                    update(employee.id, {
                      resignedStatus: e.target.value as ResignedStatus,
                    })
                  }
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {(Object.keys(RESIGNED_STATUS_LABELS) as ResignedStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {RESIGNED_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </FieldGroup>
              <FieldGroup label="Last Day">
                <Input
                  type="date"
                  value={lastDayInput}
                  disabled={!isEditing}
                  onChange={(e) => handleLastDayChange(e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label="Last Pay Date (auto: Last Day + 35 days)">
                <Input
                  type="date"
                  value={lastPayDateInput}
                  disabled={!isEditing}
                  onChange={(e) => setLastPayDateInput(e.target.value)}
                />
                <Button variant="ghost" disabled={!isEditing} onClick={saveLastPayDate}>
                  Save
                </Button>
              </FieldGroup>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Checkbox
                checked={employee.coeIssued || false}
                disabled={!isEditing}
                onChange={(c) => update(employee.id, { coeIssued: c })}
                label="COE Issued"
              />
              <Checkbox
                checked={employee.form2316Issued || false}
                disabled={!isEditing}
                onChange={(c) => update(employee.id, { form2316Issued: c })}
                label="2316 Issued"
              />
            </div>
          </div>
        </Card>
        </div>

        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <h2 className="font-display text-lg text-ink">Onboarding Next Steps</h2>
            <div className="flex items-center gap-2">
              <Pill tone={onboardingChecked === onboardingTotal ? "success" : "accent"}>
                {onboardingChecked}/{onboardingTotal} done
              </Pill>
              <Button variant="ghost" onClick={() => setChecklistEditing((o) => !o)}>
                {checklistEditing ? "Done editing" : "Edit checklist"}
              </Button>
              {onboardingCategories.length === 0 && (
                <Button
                  variant="ghost"
                  onClick={() => update(employee.id, { onboardingChecklist: defaultOnboardingChecklist() })}
                >
                  Load default checklist
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => exportRequirementsListDocx(employee)}>
              Download Employee 201 File Checklist (Word)
            </Button>
            <Button variant="ghost" onClick={() => exportEndorsementLetterDocx(employee)}>
              Download Endorsement Letter (Word)
            </Button>
            <Button variant="ghost" onClick={() => exportContractOfEmploymentDocx(employee)}>
              Download Contract of Employment (Word)
            </Button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="cursor-pointer text-xs text-ink-muted underline hover:text-accent">
              Upload/replace Contract of Employment template
              <input
                type="file"
                accept=".docx"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const { error } = await uploadContractTemplate(file);
                  if (error) {
                    notify(`Template upload failed: ${error}`, "warn");
                  } else {
                    notify("Contract of Employment template updated", "updated");
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-5">
            {onboardingCategories.length === 0 && (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-ink-muted">
                Nothing added yet. Click &quot;Edit checklist&quot; to add your own sections and items.
              </p>
            )}

            {onboardingCategories.map((cat) => (
              <div key={cat.id} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
                  {checklistEditing ? (
                    <Input
                      className="flex-1"
                      value={cat.title}
                      disabled={!isEditing}
                      onChange={(e) => setCategoryTitle(cat.id, e.target.value)}
                    />
                  ) : (
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">
                      {cat.title}
                    </h3>
                  )}
                  {checklistEditing && (
                    <button
                      type="button"
                      onClick={() => removeCategory(cat.id)}
                      className="shrink-0 text-xs text-warn hover:underline"
                    >
                      Remove section
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-0.5">
                  {cat.items.length === 0 && !checklistEditing && (
                    <p className="text-xs text-ink-muted">No items yet.</p>
                  )}
                  {cat.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2">
                      {checklistEditing ? (
                        <>
                          <Checkbox
                            checked={item.checked}
                            disabled={!isEditing}
                            onChange={(c) => toggleItem(cat.id, item.id, c)}
                            label=""
                          />
                          <Input
                            className="flex-1"
                            value={item.label}
                            disabled={!isEditing}
                            onChange={(e) => setItemLabel(cat.id, item.id, e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => removeItem(cat.id, item.id)}
                            className="shrink-0 text-xs text-warn hover:underline"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <Checkbox
                          checked={item.checked}
                          disabled={!isEditing}
                          onChange={(c) => toggleItem(cat.id, item.id, c)}
                          label={item.label}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {checklistEditing && (
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      placeholder="Add item"
                      value={newItemLabels[cat.id] || ""}
                      onChange={(e) =>
                        setNewItemLabels((prev) => ({ ...prev, [cat.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addItem(cat.id);
                      }}
                    />
                    <Button variant="ghost" onClick={() => addItem(cat.id)}>
                      Add
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {checklistEditing && (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-3">
                <Input
                  placeholder="New section title, e.g. Docs & Filing"
                  value={newCategoryTitle}
                  onChange={(e) => setNewCategoryTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCategory();
                  }}
                />
                <Button variant="ghost" onClick={addCategory}>
                  + Add section
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
