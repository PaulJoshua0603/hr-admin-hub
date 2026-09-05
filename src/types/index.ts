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
  "Print the List of Requirements",
  "Print BDO Reference Sheet",
  "Print BDO Endorsement Letter",
  "Print Job Offer",
  "Process HMO enrollment",
  "Complete ER2 Form for PhilHealth",
  "Prepare supplies for new hire (Black & Red Ballpens, Notebook, Correction Tape, ID Lace)",
  "Prepare PowerPoint presentation for Onboarding",
  "Issue Visitor Pass",
  "Collect 2x2 Pic, 1x1 Pic, NBI Clearance, Medical Exam results, Payroll Number, ID No., and Biometrics No.",
  "Remind employee to file Certificate of Attendance in Sprout (for \"Time In\" only)",
  "Create Excel schedule/tracker for employee's onboarding week",
  "Send onboarding email with Handbook, Employee Acknowledgement Form, Office Facilities Guide, and Safety Handbook",
  "Add employee profile in Sprout",
  "Upload/store files in the Shared Folder",
];

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
  // Identification & profile
  philhealthNo?: string;
  companyIdNumber?: string;
  biometricsNo?: string;
  realcognitaEmail?: string;
  homeAddress?: string;
  workingHours?: string;
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
  if (!checklist.sssId || !checklist.tinId || !checklist.philhealthId || !checklist.pagibigId) {
    missing.push("Government IDs");
  }
  if (!checklist.nbi) missing.push("NBI");
  if (e.requirements.preEmploymentMedical !== "complete") missing.push("Medical Exam");
  return missing;
}
