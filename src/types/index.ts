import { v4 as uuidV4 } from "uuid";

export type Task = {
  id: string;
  title: string;
  notes?: string;
  createdAt: string; // ISO timestamp the record was first created (system, not shown)
  inputDate: string; // ISO date, user-editable, backdatable — shown as the task's display date
  deadline?: string; // ISO date, undefined = no deadline
  dateNeeded?: string; // ISO date, undefined = not set — when the task is actually needed by
  recurrence?: RecurrenceLabel; // e.g. "Every Monday" - display only
  recurrenceAt?: string; // ISO datetime, used when recurrence === "custom"
  accomplished: boolean;
  accomplishedAt?: string;
};

export type RecurrenceLabel =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

// Reminders are a single, continuously-editable notepad rather than discrete
// items. Stored as one record (id: "note") with an in-app undo history.
export const REMINDER_NOTE_ID = "note";

export type ReminderNote = {
  id: string;
  content: string;
  updatedAt: string;
};

export type RequirementKey =
  | "listOfRequirements"
  | "preEmploymentMedical";

export type RequirementStatus = "pending" | "complete" | "lacking" | "withdrawApplication";

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  pending: "Not Yet Submitted",
  complete: "Complete",
  lacking: "Lacking",
  withdrawApplication: "Withdraw Application",
};

export type PreEmploymentChecklistKey =
  | "bdoForm"
  | "employmentContractCopy"
  | "jobOfferCopy"
  | "applicationForm"
  | "companyIdForm"
  | "philhealthForm"
  | "resume"
  | "diploma"
  | "coe"
  | "sssId"
  | "tinId"
  | "philhealthId"
  | "pagibigId"
  | "photos2x2"
  | "photos1x1"
  | "bir2316"
  | "nbi"
  | "birthCertificate"
  | "marriageCertificate";

export const PRE_EMPLOYMENT_CHECKLIST_LABELS: Record<PreEmploymentChecklistKey, string> = {
  bdoForm: "1 Copy of BDO Form",
  employmentContractCopy: "2 Copies of Employment Contract",
  jobOfferCopy: "1 Copy of Job Offer",
  applicationForm: "1 Copy of Employee Application Form (Form Attached)",
  companyIdForm: "1 Original Copy of Request for Company ID (Form Attached)",
  philhealthForm: "1 Original Copy of PhilHealth Form (Form Attached)",
  resume: "1 Copy of Updated Resume",
  diploma: "1 Photocopy of Diploma",
  coe: "Photocopy of Certificate(s) of Employment (COE from previous work)",
  sssId: "1 Copy of Colored SSS ID or E1",
  tinId: "1 Copy of Colored TIN ID",
  philhealthId: "1 Copy of Colored PhilHealth ID (PMRF Form)",
  pagibigId: "1 Copy of Colored Pag-IBIG (HMDF ID)",
  photos2x2: "2 Pcs. 2x2 Colored Pictures (White Background)",
  photos1x1: "2 Pcs. 1x1 Colored Pictures (White Background)",
  bir2316: "1 Photocopy of BIR Form 2316 (Year 2026) - Can be to follow",
  nbi: "1 Original Copy of NBI Clearance",
  birthCertificate: "2 Photocopies of Birth Certificate",
  marriageCertificate: "1 Photocopy of Marriage Certificate (if applicable)",
};

export function emptyPreEmploymentChecklist(): Record<PreEmploymentChecklistKey, boolean> {
  return {
    bdoForm: false,
    employmentContractCopy: false,
    jobOfferCopy: false,
    applicationForm: false,
    companyIdForm: false,
    philhealthForm: false,
    resume: false,
    diploma: false,
    coe: false,
    sssId: false,
    tinId: false,
    philhealthId: false,
    pagibigId: false,
    photos2x2: false,
    photos1x1: false,
    bir2316: false,
    nbi: false,
    birthCertificate: false,
    marriageCertificate: false,
  };
}

export type MedicalExamChecklistKey =
  | "urinalysis"
  | "chestXray"
  | "cbc"
  | "fecalysis"
  | "physicalExamination";

export const MEDICAL_EXAM_CHECKLIST_LABELS: Record<MedicalExamChecklistKey, string> = {
  urinalysis: "Urinalysis",
  chestXray: "Chest X-ray",
  cbc: "CBC",
  fecalysis: "Fecalysis",
  physicalExamination: "Physical Examination",
};

export function emptyMedicalExamChecklist(): Record<MedicalExamChecklistKey, boolean> {
  return {
    urinalysis: false,
    chestXray: false,
    cbc: false,
    fecalysis: false,
    physicalExamination: false,
  };
}

export type OnboardingNextStepKey =
  | "printRequirementsList"
  | "collectOriginalNbiMedical"
  | "scanSaveSharedFolder"
  | "printFolderName"
  | "fileInCabinet"
  | "prepareJobOffer"
  | "employmentContract"
  | "bdoForms"
  | "encodeInSprout"
  | "prepareHmoForm"
  | "preparePhilhealthEr2"
  | "prepareOrientationPpt"
  | "prepareVisitorPass"
  | "prepareIdWithLace"
  | "prepareOfficeSupplies";

export const ONBOARDING_NEXT_STEPS_LABELS: Record<OnboardingNextStepKey, string> = {
  printRequirementsList: "Print requirements list",
  collectOriginalNbiMedical: "Collect original NBI/Medical",
  scanSaveSharedFolder: "Scan/save to shared folder",
  printFolderName: "Print folder name",
  fileInCabinet: "File in cabinet (new employees on top, old below)",
  prepareJobOffer: "Prepare Job Offer",
  employmentContract: "Employment Contract (2 copies)",
  bdoForms: "BDO Forms (needs Finance signature)",
  encodeInSprout: "Encode in Sprout",
  prepareHmoForm: "Prepare HMO form/number",
  preparePhilhealthEr2: "Prepare PhilHealth ER2 (endorse to messenger: Dennis, Aljon, or Con)",
  prepareOrientationPpt: "Prepare Orientation PPT",
  prepareVisitorPass: "Visitor Pass",
  prepareIdWithLace: "ID with lace",
  prepareOfficeSupplies: "Office supplies (notebook, correction tape, red/blue/black pens)",
};

export const ONBOARDING_NEXT_STEPS_CATEGORIES: {
  category: string;
  keys: OnboardingNextStepKey[];
}[] = [
  {
    category: "Docs & Filing",
    keys: [
      "printRequirementsList",
      "collectOriginalNbiMedical",
      "scanSaveSharedFolder",
      "printFolderName",
      "fileInCabinet",
    ],
  },
  {
    category: "Contracts & Finance",
    keys: ["prepareJobOffer", "employmentContract", "bdoForms"],
  },
  {
    category: "Systems & Benefits",
    keys: ["encodeInSprout", "prepareHmoForm", "preparePhilhealthEr2"],
  },
  {
    category: "Orientation & Kit",
    keys: [
      "prepareOrientationPpt",
      "prepareVisitorPass",
      "prepareIdWithLace",
      "prepareOfficeSupplies",
    ],
  },
];

export function emptyOnboardingNextSteps(): Record<OnboardingNextStepKey, boolean> {
  return {
    printRequirementsList: false,
    collectOriginalNbiMedical: false,
    scanSaveSharedFolder: false,
    printFolderName: false,
    fileInCabinet: false,
    prepareJobOffer: false,
    employmentContract: false,
    bdoForms: false,
    encodeInSprout: false,
    prepareHmoForm: false,
    preparePhilhealthEr2: false,
    prepareOrientationPpt: false,
    prepareVisitorPass: false,
    prepareIdWithLace: false,
    prepareOfficeSupplies: false,
  };
}

export type CalendarEvent = {
  id: string;
  title: string;
  date: string; // ISO date (yyyy-MM-dd based)
  time?: string; // HH:mm, optional
  sourceNote?: string; // if created from a Reminders note, the note excerpt
  createdAt: string;
};

export type ActivityRow = {
  id: string;
  activity: string;
  category: string;
  hours: number;
};

export type ChallengeRow = {
  id: string;
  challenge: string;
  solution: string;
};

export type ReportImage = {
  id: string;
  path: string; // path within the "files" storage bucket
  name: string;
};

export type ActivityReport = {
  id: string;
  period: "daily" | "weekly";
  date: string; // ISO date this report covers (or week-start date)
  preparedBy: string;
  preparedByPosition?: string;
  summary: string; // rich text HTML - narrative summary
  activities: ActivityRow[];
  challenges: ChallengeRow[];
  actionPlan: string; // rich text HTML - next week's tasks / planned implementations
  images: ReportImage[];
  createdAt: string;
};


export type ResignedStatus = "active" | "resigned";

export const RESIGNED_STATUS_LABELS: Record<ResignedStatus, string> = {
  active: "Active",
  resigned: "Resigned",
};

export type MilestoneNote = {
  id: string; // `${employeeId}-${milestoneType}` composite key
  employeeId: string;
  milestoneType: "birthday" | "relieverEnd" | "third" | "sixth" | "oneYear";
  note: string;
};

export type ER2ReportRow = {
  id: string;
  employeeName: string;
  position: string;
  department: string;
  dateCreated: string;
};

export type RegularizationReportRow = {
  id: string;
  employeeName: string;
  position: string;
  department: string;
  dateOfRegularization: string;
  dateCreated: string;
};

export type EventReportRow = {
  id: string;
  eventName: string;
  date: string;
  /** Start time — still called `time` because rows were saved under that name before end times existed. */
  time: string;
  endTime?: string;
  location: string;
};

export type PlanReportRow = {
  id: string;
  plan: string;
  startDate: string;
  endDate: string;
};

export type CustomReportTable = {
  id: string;
  title: string;
  columns: string[];
  rows: Record<string, string>[];
};

export type COECategory = "withPurpose" | "endOfEmployment";



export type COERequest = {
  id: string;
  category: COECategory;
  employeeName: string;
  position: string;
  department: string;
  /** Falls back to the employee record's email when this is empty. */
  email?: string;
  purpose: string;
  dateRequested: string; // ISO date
  dateGiven?: string; // ISO date
};

export type OnboardingChecklistItem = {
  id: string;
  label: string;
  checked: boolean;
};

export type OnboardingChecklistCategory = {
  id: string;
  title: string;
  items: OnboardingChecklistItem[];
};

export const DEFAULT_NOTES_TASK_LIST_ITEMS: string[] = [
  "Print Employee Name and Attach to White Long Folder",
  "Attach the 1x1 & 2x2 Picture in the Folder",
  "Print Employee 201 Checklist",
  "Print List of Requirements",
  "Attach Waiver Form",
  "Print Employment Contract",
  "Print Job Offer",
  "Print BDO Reference Sheet",
  "Print BDO Endorsement Letter",
  "Attach BDO signing notes (Name, Position, Department, Supervisor, New/Replacement)",
  "Prepare desk supplies (Black & Red Ballpens, Notebook, Correction Tape, Bottled Water)",
  "Issue Visitor Pass",
  "Collect 2x2 and 1x1 pictures",
  "Collect NBI Clearance",
  "Collect Medical Exam results",
  "Collect medical receipt",
  "Email Payroll regarding the Medical Receipt",
  "Email the 2316 Waiver form",
  "Email the HMO PhilCare number",
  "Send onboarding email (Handbook, Acknowledgement Form, Office Facilities Guide, Safety Handbook)",
  "Add employee profile in Sprout",
  "Get ID No. and Biometrics",
  "Process ER2 PhilHealth Form",
  "Upload files to the Shared Folder",
  "Remind employee to file Certificate of Attendance in Sprout (for \"Time In\" only)",
];

/**
 * Items added to the default task list after employees already existed, and the item each
 * one belongs after (null meaning first).
 *
 * A new employee gets the whole list above, but the hundreds already on file each carry
 * their own copy of it, with their own ticks and their own additions. This is what lets
 * those be brought up to date without disturbing any of that: it says where each new item
 * goes rather than replacing the list wholesale.
 */
export const NOTES_TASK_LIST_ADDITIONS: { label: string; after: string | null }[] = [
  { label: "Print Employee Name and Attach to White Long Folder", after: null },
  {
    label: "Attach the 1x1 & 2x2 Picture in the Folder",
    after: "Print Employee Name and Attach to White Long Folder",
  },
  { label: "Attach Waiver Form", after: "Print List of Requirements" },
];

/**
 * Adds any missing standard item to an employee's task list, in its proper place.
 *
 * Everything already on the list stays exactly as it is, ticks included, and an item the
 * list already has is left alone — so this is safe to run over the same record twice.
 * Where the item it should follow is not on that list, it goes on the end rather than
 * somewhere arbitrary.
 */
export function withNotesTaskListAdditions(
  categories: OnboardingChecklistCategory[]
): OnboardingChecklistCategory[] {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return categories.map((category) => {
    if (!/notes/i.test(category.title || "")) return category;
    const items = [...category.items];
    for (const { label, after } of NOTES_TASK_LIST_ADDITIONS) {
      if (items.some((it) => same(it.label, label))) continue;
      const anchor = after === null ? -1 : items.findIndex((it) => same(it.label, after));
      const at = after === null ? 0 : anchor === -1 ? items.length : anchor + 1;
      items.splice(at, 0, { id: uuidV4(), label, checked: false });
    }
    return { ...category, items };
  });
}

export function defaultOnboardingChecklist(): OnboardingChecklistCategory[] {
  return [
    {
      id: uuidV4(),
      title: "Notes / Task List",
      items: DEFAULT_NOTES_TASK_LIST_ITEMS.map((label) => ({
        id: uuidV4(),
        label,
        checked: false,
      })),
    },
  ];
}

/**
 * The non-basic part of the monthly gross: rice subsidy 2,500, uniform and clothing
 * 666.67, medical cash allowance 333.33, laundry 400.
 *
 * These are de minimis benefits and are fixed amounts, not a share of pay, so a raise
 * lands entirely on the basic salary. That is why the new basic is the new gross less this
 * figure rather than the old basic plus a percentage.
 */
export const FIXED_MONTHLY_ALLOWANCES = 3900;

/** One raise, kept so the record shows where a salary came from. */
export type SalaryChange = {
  id: string;
  /** ISO date the raise was applied. */
  appliedAt: string;
  /** What prompted it — "6th Month Appraisal / Regularization". */
  reason: string;
  /** The percentage used, as typed, when the figures came from one. */
  increasePercent?: string;
  previousBasicSalary?: string;
  previousTotalMonthlyGrossCompensation?: string;
  newBasicSalary?: string;
  newTotalMonthlyGrossCompensation?: string;
};

/** Reads a typed amount: "₱30,000.00", "30000" and "30,000" all give 30000. */
export function parseAmount(raw?: string): number | null {
  const text = (raw || "").trim();
  if (!text || !/\d/.test(text)) return null;
  const value = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** "31,200.00" — how every amount is written on a contract or a letter. */
export function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * What a regularization raise comes to.
 *
 * The percentage applies to the whole monthly gross, and the allowances inside that gross
 * are fixed sums — so the increase is taken on the gross and the new basic salary is
 * whatever is left of it once the allowances are set aside.
 *
 *   gross 30,000 at 17%  ->  +5,100  ->  gross 35,100, basic 31,200
 *
 * Returns null when there is nothing to work from, so a caller can tell the difference
 * between "no raise on file" and "a raise of nothing".
 */
export function regularizationIncrease(e: {
  basicSalary?: string;
  totalMonthlyGrossCompensation?: string;
  regularizationIncreasePercent?: string;
}): {
  percent: number;
  currentGross: number;
  increaseAmount: number;
  newGross: number;
  newBasic: number;
} | null {
  const percent = parseAmount(e.regularizationIncreasePercent);
  const currentGross = parseAmount(e.totalMonthlyGrossCompensation);
  if (percent === null || currentGross === null) return null;

  const increaseAmount = currentGross * (percent / 100);
  const newGross = currentGross + increaseAmount;
  return {
    percent,
    currentGross,
    increaseAmount,
    newGross,
    // A gross below the allowances would make this negative, which is not a salary.
    newBasic: Math.max(0, newGross - FIXED_MONTHLY_ALLOWANCES),
  };
}

/** The office address offered as the ready-made choice on a reliever contract. */
export const DEFAULT_WORK_LOCATION =
  "15F Four/Neo 4th Avenue corner 30th and 31st Streets, Bonifacio Global City, Taguig City";

export type Employee = {
  id: string;
  name: string;
  position?: string;
  department?: string;
  birthday?: string; // ISO date
  dateAdded: string; // ISO - when name was input, drives 2-week deadline
  dateRequirementsSent?: string; // ISO - date requirements were sent, drives deadline
  dateHired?: string; // ISO - hire / onboarding date, drives milestone auto-calc
  requirementsDeadline: string; // computed: dateRequirementsSent (or dateAdded) + 14 days
  requirements: Record<RequirementKey, RequirementStatus>;
  requirementNotes?: Partial<Record<RequirementKey, string>>;
  preEmploymentChecklist?: Record<PreEmploymentChecklistKey, boolean>;
  medicalExamChecklist?: Record<MedicalExamChecklistKey, boolean>;
  onboardingNextSteps?: Record<OnboardingNextStepKey, boolean>;
  onboardingStepLabelOverrides?: Partial<Record<OnboardingNextStepKey, string>>;
  customOnboardingSteps?: OnboardingChecklistItem[]; // deprecated - replaced by onboardingChecklist
  onboardingChecklist?: OnboardingChecklistCategory[]; // fully user-editable checklist (titles + items)
  sharedFolderNote?: string; // notes/link for the employee's shared folder
  isRegular: boolean; // stays Regular until manually changed
  resignedStatus?: ResignedStatus;
  reasonForLeaving?: string;
  coeIssued?: boolean;
  form2316Issued?: boolean;
  lastDay?: string; // ISO date - offboarding last day
  lastPayDate?: string; // ISO date - auto-calculated as lastDay + 35 days (editable)
  milestoneRemindersSentAt?: string; // ISO - last time milestone reminders were generated
  requirementsCompletedAt?: string; // ISO - auto-set the moment requirements status becomes complete
  // Compensation
  basicSalary?: string;
  totalMonthlyGrossCompensation?: string;
  basicGrossSalary?: string;
  /** Regularization increase promised by the contract, as a percentage, e.g. "17". */
  regularizationIncreasePercent?: string;
  /** Every raise applied to this record, newest last. */
  salaryHistory?: SalaryChange[];
  // Identification & profile
  philhealthNo?: string;
  /** Captured on import so forms needing "SURNAME, FIRST MIDDLE" can rebuild it. */
  firstName?: string;
  middleName?: string;
  lastName?: string;
  companyIdNumber?: string;
  biometricsNo?: string;
  realcognitaEmail?: string;
  homeAddress?: string;
  homeCity?: string; // city/municipality, filled separately for docx templates like "City, Philippines"
  gender?: string;
  immediateSupervisor?: string;
  workingHours?: string;
  // Reliever engagement. Only meaningful when isReliever is true; the temporary contract
  // and the end-of-contract milestone are both driven from these.
  isReliever?: boolean;
  /** Last day of the reliever assignment. */
  relieverEndDate?: string; // ISO date
  /** Who this employee is standing in for. */
  replacedEmployeeName?: string;
  /** Why the cover is needed, printed as "Reason for Coverage". */
  relieverReason?: string;
  /** Position being covered, which need not match the reliever's own title. */
  replacedPosition?: string;
  /** Duties of the position being covered, printed under Scope of Work. */
  replacedJobDuties?: string;
  /** Where the reliever works — the office address by default, or anything typed in. */
  workLocation?: string;
};

export const REQUIREMENT_LABELS: Record<RequirementKey, string> = {
  listOfRequirements: "Pre-Employment Requirements",
  preEmploymentMedical: "Pre-Employment Medical Exam",
};

export function emptyRequirements(): Record<RequirementKey, RequirementStatus> {
  return {
    listOfRequirements: "lacking",
    preEmploymentMedical: "lacking",
  };
}

// Requirements considered "critical" for onboarding readiness.
export function getLackingRequirements(e: Employee): string[] {
  const missing: string[] = [];

  // Employee Details
  if (!e.birthday) missing.push("Birthday");
  if (!e.dateHired) missing.push("Hired/Onboarding Date");

  // Compensation
  if (!e.basicSalary) missing.push("Basic Salary");
  if (!e.totalMonthlyGrossCompensation) missing.push("Total Monthly Gross Compensation Income");

  // Identification & Profile
  if (!e.companyIdNumber) missing.push("ID Number");
  if (!e.biometricsNo) missing.push("Biometrics No.");
  if (!e.philhealthNo) missing.push("PhilHealth No.");
  if (!e.realcognitaEmail) missing.push("Realcognita Issued Email");
  if (!e.homeAddress) missing.push("Home Address");

  // Pre-Employment Requirements checklist
  const checklist = e.preEmploymentChecklist || emptyPreEmploymentChecklist();
  (Object.keys(PRE_EMPLOYMENT_CHECKLIST_LABELS) as PreEmploymentChecklistKey[]).forEach((k) => {
    if (!checklist[k]) missing.push(PRE_EMPLOYMENT_CHECKLIST_LABELS[k]);
  });

  // Pre-Employment Medical Exam
  const medical = e.medicalExamChecklist || emptyMedicalExamChecklist();
  const missingMedical = (Object.keys(MEDICAL_EXAM_CHECKLIST_LABELS) as MedicalExamChecklistKey[]).filter(
    (k) => !medical[k]
  );
  if (missingMedical.length > 0) {
    missing.push(
      `Pre-Employment Medical Exam (Original Copies): ${missingMedical
        .map((k) => MEDICAL_EXAM_CHECKLIST_LABELS[k])
        .join(", ")}`
    );
  }

  return missing;
}

export type EmploymentMilestoneKey = "thirdMonth" | "sixthMonth" | "oneYear";

export const EMPLOYMENT_MILESTONE_LABELS: Record<EmploymentMilestoneKey, string> = {
  thirdMonth: "3rd Month Assessment",
  sixthMonth: "6th Month Appraisal / Regularization",
  oneYear: "1-Year Anniversary",
};

// Calendar months from dateHired for each milestone (e.g. hired Sep 7 -> 3rd month = Dec 7).
export const EMPLOYMENT_MILESTONE_MONTHS: Record<EmploymentMilestoneKey, number> = {
  thirdMonth: 3,
  sixthMonth: 6,
  oneYear: 12,
};

// HR notification offsets relative to each milestone date (negative = before, 0 = on the date, positive = after).
export type MilestoneReminderOffset = { label: string; offsetDays: number };

export const EMPLOYMENT_MILESTONE_REMINDER_OFFSETS: Record<
  EmploymentMilestoneKey,
  MilestoneReminderOffset[]
> = {
  thirdMonth: [{ label: "3 weeks before", offsetDays: -21 }],
  sixthMonth: [{ label: "4 months before", offsetDays: -122 }],
  oneYear: [{ label: "1 week before", offsetDays: -7 }],
};

export function getMissingCriticalItems(e: Employee): string[] {
  return getLackingRequirements(e);
}

/* ------------------------------ ER2 PhilHealth form ------------------------------ */

/** One employee line on the ER2 sheet. */
export type ER2Entry = {
  id: string;
  /** Employee this line was prefilled from, when it came from the employee list. */
  employeeId?: string;
  philhealthNo: string;
  name: string;
  position: string;
  salary: string;
  dateOfEmployment: string;
};

/**
 * The only single-value fields this app writes. The employer block, the list-type
 * checkbox and the signature line are already printed on the uploaded template, so
 * stamping them again would print over what is there.
 */
export type ER2SingleField = "totalListed" | "pageNo" | "sheets";

/** Previous Employer is on the sheet but is not one of the fields we fill in. */
export type ER2Column =
  | "philhealthNo"
  | "name"
  | "position"
  | "salary"
  | "dateOfEmployment";

/**
 * Where each value sits on the uploaded template, as a fraction of page width/height
 * (0,0 = top-left). Fractions rather than points so the same calibration holds for any
 * page size, and so a template scanned at a different resolution still lines up.
 */
export type ER2Layout = {
  fields: Record<ER2SingleField, { x: number; y: number }>;
  table: {
    firstRowY: number;
    rowHeight: number;
    maxRows: number;
    columns: Record<ER2Column, number>;
  };
  fontSize: number;
};

export type ER2Form = {
  id: string;
  title: string;
  coverageStart: string;
  coverageEnd: string;
  entries: ER2Entry[];
  pageNo: string;
  sheets: string;
  /** Per-form calibration; falls back to the default layout when unset. */
  layout?: ER2Layout;
  updatedAt: string;
};

/** The uploaded blank ER2 template, held as a data URL so it works with or without Supabase. */
export type ER2Template = {
  id: string;
  fileName: string;
  dataUrl: string;
  uploadedAt: string;
  /** /Rotate on page 1. A landscape ER2 is often a portrait page rotated 90. */
  pageRotation?: number;
  /** Fillable AcroForm fields found on the template, if any. */
  fieldCount?: number;
};
