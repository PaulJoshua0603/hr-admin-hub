"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { buildRelieverContractPdf, relieverContractFileName } from "@/lib/relieverContractPdf";
import { buildEmployeeNamePdf, employeeNameFileName } from "@/lib/employeeNamePdf";
import { useNotifications } from "@/lib/notificationContext";
import { addDaysISO, addMonthsISO, daysSince, formatDate, isOverdue, nextMondayISO, todayISO } from "@/lib/dates";
import {
  exportContractOfEmploymentDocx,
  exportEndorsementLetterDocx,
  exportRelieverContractDocx,
  exportRequirementsListDocx,
  exportCOEWithPurposeDocx,
  exportCOEResignedDocx,
  exportRegularizationWithIncreaseDocx,
  exportRegularizationNoIncreaseDocx,
  listEmployeeCOEFiles,
  downloadEmployeeCOEFile,
  deleteEmployeeCOEFile,
} from "@/lib/docExport";
import { Button, Card, Checkbox, FieldGroup, FileButton, Input, Pill, SectionHeading, StatusSelect, Textarea } from "@/components/ui";
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
  type COERequest,
  type COECategory,
  FIXED_MONTHLY_ALLOWANCES,
  formatAmount,
  regularizationIncrease,
  type SalaryChange,
} from "@/types";

const LAST_PAY_DAYS_AFTER_LAST_DAY = 35;

/** The one reason string that identifies the 6th-month raise in an employee's history. */
const REGULARIZATION_REASON = "6th Month Appraisal / Regularization";

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
  const { items: coeRequests, add: addCoeRequest, update: updateCoeRequest, remove: removeCoeRequest } =
    useSupabaseStore<COERequest>("hr_coe_requests", []);
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
  const [coeFiles, setCoeFiles] = useState<{ name: string; updated_at?: string | null }[]>([]);
  const [purposeForm, setPurposeForm] = useState({
    purpose: "",
    dateRequested: todayISO().slice(0, 10),
    dateIssued: "",
  });
  const [resignedForm, setResignedForm] = useState({
    dateRequested: todayISO().slice(0, 10),
    separationDate: "",
  });
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  /** The blank Reliever Contract, uploaded once as PDF and reused for everyone. */
  const { items: relieverTemplates, setItems: setRelieverTemplates } = useSupabaseStore<{
    id: string;
    dataUrl: string;
    fileName: string;
    uploadedAt: string;
  }>("hr_reliever_template", []);
  const relieverTemplate = relieverTemplates[0];
  const [buildingContract, setBuildingContract] = useState(false);
  const { notify } = useNotifications();
  const router = useRouter();

  // The useState initial values above run once, before the record has loaded, so the
  // date inputs are re-seeded when a different employee's record arrives. Adjusting
  // state during render (rather than in an effect) means the inputs are already correct
  // on the first paint instead of flashing empty and being corrected afterwards.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (hydrated && employee && seededFor !== employee.id) {
    setSeededFor(employee.id);
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
  }

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

  const refreshCoeFiles = async () => {
    if (!employee) return;
    const files = await listEmployeeCOEFiles(employee.id);
    setCoeFiles(files);
  };

  useEffect(() => {
    if (!hydrated || !employee) return;
    // Fetching this employee's stored COE files — synchronising with an external system,
    // which is what an effect is for. The lint rule can't tell that apart from deriving
    // state from props, so it's suppressed here rather than the code contorted.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
    refreshCoeFiles();
  }, [hydrated, employee?.id]);

  async function generateCOEWithPurpose() {
    if (!employee || !purposeForm.purpose.trim()) return;
    addCoeRequest({
      id: uuid(),
      category: "withPurpose",
      employeeName: employee!.name,
      position: employee!.position || "",
      department: employee!.department || "",
      email: employee!.realcognitaEmail || "",
      purpose: purposeForm.purpose.trim(),
      dateRequested: new Date(purposeForm.dateRequested).toISOString(),
      dateGiven: purposeForm.dateIssued ? new Date(purposeForm.dateIssued).toISOString() : undefined,
    });
    await exportCOEWithPurposeDocx(employee!.name, purposeForm.purpose.trim(), employee!);
    notify(`COE with Purpose generated for "${employee!.name}"`, "created");
    setPurposeForm({ purpose: "", dateRequested: todayISO().slice(0, 10), dateIssued: "" });
    refreshCoeFiles();
  }

  async function generateCOEResigned() {
    if (!employee) return;
    const sepISO = resignedForm.separationDate
      ? new Date(resignedForm.separationDate).toISOString()
      : employee!.lastDay;
    if (sepISO && sepISO !== employee!.lastDay) {
      update(employee!.id, { lastDay: sepISO, resignedStatus: "resigned" });
    }
    addCoeRequest({
      id: uuid(),
      category: "endOfEmployment",
      employeeName: employee!.name,
      position: employee!.position || "",
      department: employee!.department || "",
      email: employee!.realcognitaEmail || "",
      purpose: "",
      dateRequested: new Date(resignedForm.dateRequested).toISOString(),
    });
    await exportCOEResignedDocx(employee!.name, { ...employee!, lastDay: sepISO || employee!.lastDay });
    notify(`COE for Resigned generated for "${employee!.name}"`, "created");
    setResignedForm({ dateRequested: todayISO().slice(0, 10), separationDate: "" });
    refreshCoeFiles();
  }

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

  function moveItem(catId: string, itemId: string, direction: -1 | 1) {
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.map((c) => {
        if (c.id !== catId) return c;
        const idx = c.items.findIndex((it) => it.id === itemId);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= c.items.length) return c;
        const items = [...c.items];
        [items[idx], items[target]] = [items[target], items[idx]];
        return { ...c, items };
      }),
    });
  }

  function reorderItem(catId: string, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const current = employee!.onboardingChecklist || [];
    update(employee!.id, {
      onboardingChecklist: current.map((c) => {
        if (c.id !== catId) return c;
        const items = [...c.items];
        const fromIdx = items.findIndex((it) => it.id === draggedId);
        const toIdx = items.findIndex((it) => it.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return c;
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        return { ...c, items };
      }),
    });
  }

  /** The raise this record already carries, if one has been applied. */
  function appliedRaise(e: Employee) {
    return (e.salaryHistory || []).find((h) => h.reason === REGULARIZATION_REASON) || null;
  }

  /**
   * Writes the calculated figures onto the record and keeps a note of what they replaced.
   *
   * The previous amounts live in the history entry rather than in a separate field, which
   * is what lets the raise be taken back later and is also the record HR needs when
   * someone asks what an employee used to earn.
   */
  function applyRegularizationRaise() {
    const raise = regularizationIncrease(employee!);
    if (!raise) {
      notify("Set the Total Monthly Gross Compensation and the contract increase % first", "warn");
      return;
    }
    if (appliedRaise(employee!)) return;

    const entry: SalaryChange = {
      id: uuid(),
      appliedAt: todayISO(),
      reason: REGULARIZATION_REASON,
      increasePercent: employee!.regularizationIncreasePercent,
      previousBasicSalary: employee!.basicSalary,
      previousTotalMonthlyGrossCompensation: employee!.totalMonthlyGrossCompensation,
      newBasicSalary: formatAmount(raise.newBasic),
      newTotalMonthlyGrossCompensation: formatAmount(raise.newGross),
    };
    update(employee!.id, {
      basicSalary: entry.newBasicSalary,
      totalMonthlyGrossCompensation: entry.newTotalMonthlyGrossCompensation,
      salaryHistory: [...(employee!.salaryHistory || []), entry],
    });
    notify(
      `${employee!.name} — regularization increase applied (₱${entry.newTotalMonthlyGrossCompensation} gross)`,
      "updated"
    );
  }

  /**
   * Puts back what the raise replaced.
   *
   * The entry is dropped from the history too: it is being undone, not recorded as having
   * happened and then reversed, and leaving it would have the next apply refuse to run.
   */
  function revertRegularizationRaise() {
    const entry = appliedRaise(employee!);
    if (!entry) return;
    update(employee!.id, {
      basicSalary: entry.previousBasicSalary || "",
      totalMonthlyGrossCompensation: entry.previousTotalMonthlyGrossCompensation || "",
      salaryHistory: (employee!.salaryHistory || []).filter((h) => h.id !== entry.id),
    });
    notify(`${employee!.name} — regularization increase reverted`, "updated");
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

  const milestones = employee.dateHired && !employee.lastDay
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
                // Client-side navigation keeps the app shell mounted instead of a full reload.
                router.push("/employees");
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
          <FieldGroup label="Gender">
            <select
              value={employee.gender || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { gender: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Select…</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Working Hours">
            <select
              value={employee.workingHours || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { workingHours: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Select shift…</option>
              <option value="6:30 am – 3:30 pm">6:30 am – 3:30 pm</option>
              <option value="6:30am – 3:00pm">6:30am – 3:00pm</option>
              <option value="7:00am – 4:00pm">7:00am – 4:00pm</option>
              <option value="7:30am – 4:30pm">7:30am – 4:30pm</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Immediate Supervisor">
            <Input
              placeholder="e.g. Paula J. Paguntalan"
              value={employee.immediateSupervisor || ""}
              disabled={!isEditing}
              onChange={(e) => update(employee.id, { immediateSupervisor: e.target.value })}
            />
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
          <h2 className="font-display text-lg text-ink">Employment milestones</h2>
          <p className="mt-1 text-xs text-ink-muted">
            {employee.lastDay
              ? "Milestone tracking is hidden — a COE for Resigned has been generated for this employee."
              : "Milestone alerts trigger automatically on the Dashboard — no action needed here."}
          </p>

          {milestones.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {milestones.map((m) => (
                <li
                  key={m.key}
                  className="flex flex-col gap-2 rounded-md bg-background px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center justify-between gap-3 sm:justify-start">
                    <span className="text-ink">{m.label}</span>
                    <span className="text-ink-muted">{formatDate(m.date)}</span>
                  </div>
                  {m.key === "sixthMonth" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {/* The percentage sits with the button that spends it: the letter
                          cannot be written without it, and this is where it is written. */}
                      <label className="flex items-center gap-2 whitespace-nowrap text-xs text-ink-muted">
                        Increase
                        <span className="relative">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="w-20 pr-6 text-sm"
                            placeholder="17"
                            value={employee.regularizationIncreasePercent || ""}
                            disabled={!isEditing}
                            title={
                              isEditing
                                ? "The regularization increase promised by the contract"
                                : "Use Edit above to set the contractual increase"
                            }
                            onChange={(e) =>
                              update(employee.id, { regularizationIncreasePercent: e.target.value })
                            }
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">
                            %
                          </span>
                        </span>
                      </label>
                      <Button
                        variant="ghost"
                        onClick={() => exportRegularizationWithIncreaseDocx(employee)}
                      >
                        Regularization W/Increase
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => exportRegularizationNoIncreaseDocx(employee)}
                      >
                        Regularization No Increase
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {milestones.some((m) => m.key === "sixthMonth") && (
            <RegularizationSalary
              employee={employee}
              isEditing={isEditing}
              onApply={applyRegularizationRaise}
              onRevert={revertRegularizationRaise}
            />
          )}
          {milestones.length === 0 && !employee.lastDay && (
            <p className="mt-4 text-xs text-ink-muted">
              Set the onboarding date above to auto-calculate milestones.
            </p>
          )}

          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-ink">Generated COE Files</h3>
            {coeFiles.length === 0 ? (
              <p className="mt-1 text-xs text-ink-muted">
                No COE documents generated yet — use the Offboarding section below.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {coeFiles.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center justify-between gap-2 rounded-md bg-background px-3 py-2 text-sm"
                  >
                    <button
                      onClick={() => downloadEmployeeCOEFile(employee.id, f.name)}
                      className="min-w-0 truncate text-left text-ink hover:text-accent"
                      title={f.name}
                    >
                      {f.name.replace(/^\d+-/, "")}
                    </button>
                    <button
                      onClick={async () => {
                        await deleteEmployeeCOEFile(employee.id, f.name);
                        notify(`COE file deleted: "${f.name.replace(/^\d+-/, "")}"`, "deleted");
                        refreshCoeFiles();
                      }}
                      className="shrink-0 text-xs text-ink-muted hover:text-warn"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="font-display text-sm text-ink">Offboarding — Certificate of Employment (COE) Tracking</h3>

            <div className="mt-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-ink">COE with Purpose</p>
              <p className="text-xs text-ink-muted">For employees still actively employed.</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input
                  placeholder="Purpose (e.g. Bank loan)"
                  value={purposeForm.purpose}
                  disabled={!isEditing}
                  onChange={(e) => setPurposeForm((f) => ({ ...f, purpose: e.target.value }))}
                  className="sm:col-span-3"
                />
                <label className="flex flex-col gap-1 text-xs text-ink-muted">
                  Date requested
                  <Input
                    type="date"
                    value={purposeForm.dateRequested}
                    disabled={!isEditing}
                    onChange={(e) => setPurposeForm((f) => ({ ...f, dateRequested: e.target.value }))}
                  />
                  {purposeForm.dateRequested && (
                    <span className="text-[11px] text-ink-muted">
                      {formatDate(new Date(purposeForm.dateRequested).toISOString(), "MMMM d, yyyy")}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-muted">
                  Date issued
                  <Input
                    type="date"
                    value={purposeForm.dateIssued}
                    disabled={!isEditing}
                    onChange={(e) => setPurposeForm((f) => ({ ...f, dateIssued: e.target.value }))}
                  />
                  {purposeForm.dateIssued && (
                    <span className="text-[11px] text-ink-muted">
                      {formatDate(new Date(purposeForm.dateIssued).toISOString(), "MMMM d, yyyy")}
                    </span>
                  )}
                </label>
              </div>
              <Button
                className="mt-2"
                disabled={!isEditing || !purposeForm.purpose.trim()}
                onClick={generateCOEWithPurpose}
              >
                Generate & Log COE
              </Button>
            </div>

            <div className="mt-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-ink">COE for Resigned</p>
              <p className="text-xs text-ink-muted">
                Generating this sets the employee&apos;s Last Day and hides milestone tracking.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-ink-muted">
                  Date requested
                  <Input
                    type="date"
                    value={resignedForm.dateRequested}
                    disabled={!isEditing}
                    onChange={(e) => setResignedForm((f) => ({ ...f, dateRequested: e.target.value }))}
                  />
                  {resignedForm.dateRequested && (
                    <span className="text-[11px] text-ink-muted">
                      {formatDate(new Date(resignedForm.dateRequested).toISOString(), "MMMM d, yyyy")}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-muted">
                  Separation / Last Day
                  <Input
                    type="date"
                    value={resignedForm.separationDate || (employee.lastDay ? employee.lastDay.slice(0, 10) : "")}
                    disabled={!isEditing}
                    onChange={(e) => setResignedForm((f) => ({ ...f, separationDate: e.target.value }))}
                  />
                  {(resignedForm.separationDate || employee.lastDay) && (
                    <span className="text-[11px] text-ink-muted">
                      {formatDate(
                        resignedForm.separationDate
                          ? new Date(resignedForm.separationDate).toISOString()
                          : employee.lastDay!,
                        "MMMM d, yyyy"
                      )}
                    </span>
                  )}
                </label>
              </div>
              <Button className="mt-2" variant="danger" disabled={!isEditing} onClick={generateCOEResigned}>
                Generate & Log COE
              </Button>
            </div>

            <EmployeeCOERequestsList
              requests={coeRequests.filter(
                (r) => r.employeeName.trim().toLowerCase() === employee.name.trim().toLowerCase()
              )}
              onDateGiven={(req, value) =>
                updateCoeRequest(req.id, { dateGiven: value ? new Date(value).toISOString() : undefined })
              }
              onDateRequested={(req, value) =>
                updateCoeRequest(req.id, { dateRequested: new Date(value).toISOString() })
              }
              onRemove={(id) => {
                const removed = coeRequests.find((r) => r.id === id);
                removeCoeRequest(id);
                if (removed?.category === "endOfEmployment") {
                  const stillHasResignedCOE = coeRequests.some(
                    (r) =>
                      r.id !== id &&
                      r.category === "endOfEmployment" &&
                      r.employeeName.trim().toLowerCase() === employee.name.trim().toLowerCase()
                  );
                  if (!stillHasResignedCOE) {
                    update(employee.id, { lastDay: undefined, resignedStatus: "active" });
                    notify(
                      `${employee.name} — milestone tracking restored (Last Day cleared)`,
                      "updated"
                    );
                  }
                }
              }}
            />
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

          {/* Four equal columns rather than three, so the set fills one tidy row instead of
              leaving an orphan on a second line. Buttons wrap their label and grow in height
              rather than stretching their column, which is what made the widths uneven. */}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Button
              variant="ghost"
              className="w-full min-w-0 justify-center whitespace-normal text-center leading-snug h-auto py-2"
              onClick={() => exportRequirementsListDocx(employee)}
            >
              Employee 201 Checklist (Word)
            </Button>
            <Button
              variant="ghost"
              className="w-full min-w-0 justify-center whitespace-normal text-center leading-snug h-auto py-2"
              title="The name label for the white long folder — SURNAME, FIRST M. in Arial Bold 28"
              onClick={async () => {
                const bytes = await buildEmployeeNamePdf(employee);
                const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = employeeNameFileName(employee.name);
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                notify(`Employee Name label ready for ${employee.name}`, "created");
              }}
            >
              Employee Name
            </Button>
            <Button
              variant="ghost"
              className="w-full min-w-0 justify-center whitespace-normal text-center leading-snug h-auto py-2"
              onClick={() => exportEndorsementLetterDocx(employee)}
            >
              BDO Endorsement Letter (Word)
            </Button>
            <Button
              variant="ghost"
              className="w-full min-w-0 justify-center whitespace-normal text-center leading-snug h-auto py-2"
              disabled={!employee.isReliever || buildingContract}
              title={
                employee.isReliever
                  ? "Fills the Temporary Employment Contract from this reliever engagement"
                  : "Only for employees marked as a reliever"
              }
              onClick={async () => {
                setBuildingContract(true);
                try {
                  // A PDF template is filled here and downloaded as PDF; with no PDF on
                  // file it falls back to the Word template, which produces a .docx.
                  if (relieverTemplate) {
                    const result = await buildRelieverContractPdf(relieverTemplate.dataUrl, employee);
                    const blob = new Blob([new Uint8Array(result.bytes)], { type: "application/pdf" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = relieverContractFileName(employee.name);
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    notify(
                      result.missing.length
                        ? `Downloaded, but these placeholders were not found in the template: ${result.missing.join(", ")}`
                        : `Temporary Contract ready for ${employee.name}`,
                      result.missing.length ? "warn" : "created"
                    );
                  } else {
                    const result = await exportRelieverContractDocx(employee);
                    if (result.found !== result.expected) {
                      notify(
                        `Downloaded, but the template has ${result.found} highlighted fields and this contract expects ${result.expected}.`,
                        "warn"
                      );
                    } else {
                      notify(`Temporary Contract ready for ${employee.name}`, "created");
                    }
                  }
                } catch (err) {
                  notify(
                    `Could not build the contract: ${err instanceof Error ? err.message : "Unknown error"}`,
                    "warn"
                  );
                } finally {
                  setBuildingContract(false);
                }
              }}
            >
              {buildingContract ? "Building…" : "Temporary Contract"}
            </Button>
            <Button
              variant="ghost"
              className="w-full min-w-0 justify-center whitespace-normal text-center leading-snug h-auto py-2"
              onClick={() => exportContractOfEmploymentDocx(employee)}
            >
              Contract of Employment (Word)
            </Button>
          </div>

          {employee.isReliever && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-background px-3 py-2">
              {/* The label takes the room that is left and the button keeps its size, so
                  the two sit on one line and the button lines up with the row's edge. */}
              <span className="min-w-0 flex-1 text-xs leading-snug text-ink-muted">
                {relieverTemplate
                  ? `Reliever Contract template: ${relieverTemplate.fileName}`
                  : "No Reliever Contract template uploaded yet — upload the blank PDF form."}
              </span>
              <FileButton
                accept=".pdf"
                onFile={async (file) => {
                  if (file.size > 8 * 1024 * 1024) {
                    notify("That file is over 8MB — save a lighter PDF and try again.", "warn");
                    return;
                  }
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(new Error("read failed"));
                    reader.readAsDataURL(file);
                  });
                  setRelieverTemplates([
                    { id: "template", dataUrl, fileName: file.name, uploadedAt: todayISO() },
                  ]);
                  notify(`Reliever Contract template saved (${file.name})`, "created");
                }}
              >
                {relieverTemplate ? "Replace template" : "Upload template"}
              </FileButton>
            </div>
          )}

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
                    <div
                      key={item.id}
                      draggable={checklistEditing && isEditing}
                      onDragStart={() => setDraggedItemId(item.id)}
                      onDragOver={(e) => {
                        if (!checklistEditing) return;
                        e.preventDefault();
                        setDragOverItemId(item.id);
                      }}
                      onDragLeave={() => setDragOverItemId((cur) => (cur === item.id ? null : cur))}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedItemId) reorderItem(cat.id, draggedItemId, item.id);
                        setDraggedItemId(null);
                        setDragOverItemId(null);
                      }}
                      onDragEnd={() => {
                        setDraggedItemId(null);
                        setDragOverItemId(null);
                      }}
                      className={`flex items-center justify-between gap-2 rounded-md transition-colors ${
                        checklistEditing ? "cursor-move" : ""
                      } ${
                        dragOverItemId === item.id && draggedItemId && draggedItemId !== item.id
                          ? "bg-accent-soft"
                          : ""
                      } ${draggedItemId === item.id ? "opacity-40" : ""}`}
                    >
                      {checklistEditing ? (
                        <>
                          <span className="shrink-0 select-none text-ink-muted" aria-hidden="true">
                            ⠿
                          </span>
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

function EmployeeCOERequestsList({
  requests,
  onDateGiven,
  onDateRequested,
  onRemove,
}: {
  requests: COERequest[];
  onDateGiven: (req: COERequest, value: string) => void;
  onDateRequested: (req: COERequest, value: string) => void;
  onRemove: (id: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <p className="mt-3 text-xs text-ink-muted">No COE requests logged for this employee yet.</p>
    );
  }
  const sorted = [...requests].sort((a, b) => (a.dateRequested < b.dateRequested ? 1 : -1));
  return (
    <>
    <p className="mt-3 text-sm font-medium text-ink">Total COE Requests: {requests.length}</p>
    <div className="mt-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead>
          <tr className="bg-background text-xs uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Purpose</th>
            <th className="px-3 py-2">Date Requested</th>
            <th className="px-3 py-2">Date COE Given</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((req) => (
            <tr key={req.id} className="border-t border-border">
              <td className="px-3 py-2 text-ink">
                {req.category === "endOfEmployment" ? "COE for Resigned" : "COE with Purpose"}
              </td>
              <td className="px-3 py-2 text-ink-muted">{req.purpose || "—"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <Input
                    type="date"
                    value={req.dateRequested.slice(0, 10)}
                    onChange={(e) => onDateRequested(req, e.target.value)}
                    className="min-w-[150px]"
                  />
                  <span className="text-[11px] text-ink-muted">
                    {formatDate(req.dateRequested, "MMMM d, yyyy")}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <Input
                    type="date"
                    value={req.dateGiven ? req.dateGiven.slice(0, 10) : ""}
                    onChange={(e) => onDateGiven(req, e.target.value)}
                    className="min-w-[150px]"
                  />
                  {req.dateGiven && (
                    <span className="text-[11px] text-ink-muted">
                      {formatDate(req.dateGiven, "MMMM d, yyyy")}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                <button onClick={() => onRemove(req.id)} className="text-xs text-ink-muted hover:text-warn">
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/**
 * The salary the 6th-month regularization produces, and what it replaced.
 *
 * The figures are computed from the contract's increase percentage rather than typed, so
 * the letter and the record cannot disagree — but applying them to the record stays a
 * deliberate act, because a raise has a date and someone has to decide it has arrived.
 * Ticking the box writes them and files what they replaced; clearing it puts the old ones
 * back. Either way both amounts are still editable by hand up in Compensation, for the
 * case the calculation is not what was actually agreed.
 */
function RegularizationSalary({
  employee,
  isEditing,
  onApply,
  onRevert,
}: {
  employee: Employee;
  isEditing: boolean;
  onApply: () => void;
  onRevert: () => void;
}) {
  const history = employee.salaryHistory || [];
  const applied = history.find((h) => h.reason === REGULARIZATION_REASON) || null;
  // Once applied, the record already holds the new figures, so recomputing from them would
  // compound the raise. The entry is the source of truth from then on.
  const raise = applied ? null : regularizationIncrease(employee);
  const peso = (value?: string) => `₱${value || "0.00"}`;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-ink">Regularization salary increase</h3>

      {!raise && !applied && (
        <p className="mt-2 text-xs text-ink-muted">
          Set the <span className="text-ink">Increase %</span> on the 6th Month row above, with the{" "}
          <span className="text-ink">Total Monthly Gross Compensation</span> filled in under
          Compensation, and the new salary is worked out here.
        </p>
      )}

      {(raise || applied) && (
        <div className="mt-3 overflow-x-auto rounded-md bg-background">
          <table className="w-full min-w-[420px] text-sm">
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-3 py-2 text-ink-muted">Contractual increase</td>
                <td className="px-3 py-2 text-right font-medium text-ink">
                  {applied?.increasePercent ?? raise?.percent}%
                  {raise && (
                    <span className="ml-2 font-normal text-ink-muted">
                      (+₱{formatAmount(raise.increaseAmount)})
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-ink-muted">Previous Basic Salary</td>
                <td className="px-3 py-2 text-right text-ink">
                  {peso(applied ? applied.previousBasicSalary : employee.basicSalary)}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-ink-muted">Previous Total Monthly Gross</td>
                <td className="px-3 py-2 text-right text-ink">
                  {peso(
                    applied
                      ? applied.previousTotalMonthlyGrossCompensation
                      : employee.totalMonthlyGrossCompensation
                  )}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-ink-muted">New Basic Salary</td>
                <td className="px-3 py-2 text-right font-semibold text-ink">
                  {peso(applied ? applied.newBasicSalary : formatAmount(raise!.newBasic))}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-ink-muted">New Total Monthly Gross</td>
                <td className="px-3 py-2 text-right font-semibold text-ink">
                  {peso(
                    applied ? applied.newTotalMonthlyGrossCompensation : formatAmount(raise!.newGross)
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {(raise || applied) && (
        <div className="mt-3">
          <Checkbox
            checked={!!applied}
            disabled={!isEditing}
            onChange={(next) => (next ? onApply() : onRevert())}
            label="Apply this to the employee's salary on record"
          />
          <p className="mt-1 pl-6 text-[11px] text-ink-muted">
            {applied
              ? `Applied ${formatDate(applied.appliedAt, "MMMM d, yyyy")}. Clearing this restores ${peso(
                  applied.previousBasicSalary
                )} / ${peso(applied.previousTotalMonthlyGrossCompensation)}.`
              : `The letter prints these figures either way — this replaces the amounts under Compensation as well. Basic is the new gross less the ₱${formatAmount(
                  FIXED_MONTHLY_ALLOWANCES
                )} of fixed allowances.`}
          </p>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Salary history
          </h4>
          <ul className="mt-2 flex flex-col gap-2">
            {[...history].reverse().map((h) => (
              <li key={h.id} className="rounded-md bg-background px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink">{h.reason}</span>
                  <span className="text-ink-muted">{formatDate(h.appliedAt, "MMMM d, yyyy")}</span>
                </div>
                <p className="mt-1 text-ink-muted">
                  Basic {peso(h.previousBasicSalary)} → <span className="text-ink">{peso(h.newBasicSalary)}</span>
                  {" · "}
                  Gross {peso(h.previousTotalMonthlyGrossCompensation)} →{" "}
                  <span className="text-ink">{peso(h.newTotalMonthlyGrossCompensation)}</span>
                  {h.increasePercent ? ` · ${h.increasePercent}%` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
