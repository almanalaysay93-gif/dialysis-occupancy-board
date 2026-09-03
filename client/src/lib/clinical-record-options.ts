/**
 * Controlled vocabularies for the clinical forms: water QC, adverse
 * complications, and shift handover.
 *
 * The records themselves live in Postgres and reach the client through tRPC.
 * Only the option lists live here, because the form dropdowns and the strings
 * a nurse can pick must agree across three components.
 */

export const WATER_QC_SHIFTS = [
  "Morning (05:00-13:00)",
  "Afternoon (13:00-21:00)",
  "Night (21:00-05:00)",
] as const;
export type WaterQcShift = (typeof WATER_QC_SHIFTS)[number];

export const INSPECTOR_ROLES = ["Biomedical Tech", "Head Nurse", "Staff Nurse"] as const;
export type InspectorRole = (typeof INSPECTOR_ROLES)[number];

export const DISINFECTION_AGENTS = [
  "Citrosteril",
  "Peracetic Acid (Renalin)",
  "Sodium Hypochlorite",
  "None (Thermal Only)",
] as const;
export type DisinfectionAgent = (typeof DISINFECTION_AGENTS)[number];

export const COMPLICATION_TYPES = [
  "Hypotension (IDH)",
  "Muscle Cramps",
  "Dialyzer / Line Clotting",
  "Disequilibrium Syndrome",
  "Vascular Access Dysfunction / Infiltration",
  "Pyrogenic / Febrile Reaction",
  "Hypoglycemia",
  "Chest Pain / Arrhythmia",
  "Other Adverse Event",
] as const;
export type ComplicationType = (typeof COMPLICATION_TYPES)[number];

export const COMPLICATION_SEVERITIES = ["Mild", "Moderate", "Severe / Critical"] as const;
export type ComplicationSeverity = (typeof COMPLICATION_SEVERITIES)[number];

export const COMPLICATION_OUTCOMES = [
  "Resolved (Session Continued)",
  "UF Target Reduced",
  "Session Terminated Early",
  "Transferred to ER / Hospital Bed",
] as const;
export type ComplicationOutcome = (typeof COMPLICATION_OUTCOMES)[number];

export const ENDORSEMENT_SHIFTS = [
  "Morning (05:00-13:00)",
  "Day (07:00-15:00)",
  "Afternoon (13:00-21:00)",
  "Night (21:00-05:00)",
] as const;
export type EndorsementShift = (typeof ENDORSEMENT_SHIFTS)[number];

export const VASCULAR_ACCESS_TYPES = ["AVF", "AVG", "PermCath", "Temporary IJ"] as const;
export type VascularAccessType = (typeof VASCULAR_ACCESS_TYPES)[number];

/** One patient the outgoing nurse flags for closer watching next shift. */
export type SpecialWatchEntry = {
  patientId: string;
  machineLabel: string;
  note: string;
  accessType: VascularAccessType;
};

/** Unit headcount at the moment of handover. Stored as JSON on the endorsement. */
export type EndorsementCensus = {
  totalPatients: number;
  activeTreatments: number;
  waitingQueue: number;
  urgentCases: number;
  machinesActive: number;
  machinesRepair: number;
  adverseEventsCount: number;
};

/** Safety items the outgoing nurse confirms. Stored as JSON on the endorsement. */
export type EndorsementChecklist = {
  crashCartChecked: boolean;
  waterQcVerified: boolean;
  heparinNarcoticsCounted: boolean;
  dialyzerReprocessingLogged: boolean;
  isolationBarriersChecked: boolean;
  biomedicalWorkOrdersLogged: boolean;
};

/** Reads a JSON column written by the endorsement form, tolerating bad data. */
export function parseJsonColumn<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
