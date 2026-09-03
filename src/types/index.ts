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
  | "resume"
  | "govIds"
  | "photos"
  | "bir2316"
  | "diploma"
  | "nbi"
  | "birthMarriageCerts"
  | "coe"
  | "applicationForm"
  | "companyIdForm"
  | "philhealthForm";

export const PRE_EMPLOYMENT_CHECKLIST_LABELS: Record<PreEmploymentChecklistKey, string> = {
  resume: "Resume",
  govIds: "Photocopies of Gov IDs (SSS/TIN/PhilHealth/Pag-IBIG)",
  photos: "1x1 & 2x2 photos (2pcs each)",
  bir2316: "BIR 2316 (2026)",
  diploma: "Diploma",
  nbi: "NBI",
  birthMarriageCerts: "Birth & Marriage Certificates",
  coe: "COE",
  applicationForm: "Attached Form: Application Form",
  companyIdForm: "Attached Form: Request Company ID",
  philhealthForm: "Attached Form: Philhealth Form",
};

export function emptyPreEmploymentChecklist(): Record<PreEmploymentChecklistKey, boolean> {
  return {
    resume: false,
    govIds: false,
    photos: false,
    bir2316: false,
    diploma: false,
    nbi: false,
    birthMarriageCerts: false,
    coe: false,
    applicationForm: false,
    companyIdForm: false,
    philhealthForm: false,
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

export type CustomOnboardingItem = {
  id: string;
  label: string;
  checked: boolean;
};

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
  customOnboardingSteps?: CustomOnboardingItem[]; // user-added checklist items
  sharedFolderNote?: string; // notes/link for the employee's shared folder
  isRegular: boolean; // stays Regular until manually changed
  resignedStatus?: ResignedStatus;
  coeIssued?: boolean;
  form2316Issued?: boolean;
  lastDay?: string; // ISO date - offboarding last day
  lastPayDate?: string; // ISO date - auto-calculated as lastDay + 35 days (editable)
  milestoneRemindersSentAt?: string; // ISO - last time milestone reminders were generated
};

export const REQUIREMENT_LABELS: Record<RequirementKey, string> = {
  listOfRequirements: "Pre-Employment Requirements",
  preEmploymentMedical: "Pre-Employment Medical Exam",
};

export function emptyRequirements(): Record<RequirementKey, RequirementStatus> {
  return {
    listOfRequirements: "pending",
    preEmploymentMedical: "pending",
  };
}

// Requirements considered "critical" for onboarding readiness.
export function getLackingRequirements(e: Employee): string[] {
  return (Object.keys(e.requirements) as RequirementKey[])
    .filter((k) => e.requirements[k] !== "complete")
    .map((k) => {
      const note = e.requirementNotes?.[k]?.trim();
      return note ? `${REQUIREMENT_LABELS[k]} (${note})` : REQUIREMENT_LABELS[k];
    });
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
  thirdMonth: [
    { label: "3 weeks before", offsetDays: -21 },
    { label: "1 day after", offsetDays: 1 },
  ],
  sixthMonth: [
    { label: "4 weeks before", offsetDays: -28 },
    { label: "on due date", offsetDays: 0 },
  ],
  oneYear: [{ label: "1 week before", offsetDays: -7 }],
};

export function getMissingCriticalItems(e: Employee): string[] {
  const checklist = e.preEmploymentChecklist || emptyPreEmploymentChecklist();
  const missing: string[] = [];
  if (!checklist.govIds) missing.push("Government IDs");
  if (!checklist.nbi) missing.push("NBI");
  if (e.requirements.preEmploymentMedical !== "complete") missing.push("Medical Exam");
  return missing;
}
