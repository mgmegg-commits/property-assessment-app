/**
 * The assessment document: the report Cecil edits, as one JSON document.
 * The shape is v1's (schema 6), described in v1 src/js/model/assessment.js.
 *
 *   assessment.sections[]                     the report's own list, copied from the standard list when it
 *                                             was made; `key` never changes (model/sections.ts)
 *   assessment.sections[].items[]             subsections: `key`, `label`, `rating`, `notes`, `hidden`,
 *                                             `suggested` (added by a draft), `drafted` (values not yet accepted)
 *   assessment.sections[].items[].findings[]  each finding has an `action` (title, recommendation,
 *                                             priority, assignee, due) unless `observationOnly`
 *   assessment.photos[]                       `item` (ref "sectionKey.itemKey"), `findings` (ids), `markup` (shapes),
 *                                             `alsoIn` (extra places: "item:<ref>" / "finding:<id>"),
 *                                             `overview` (a general property photo), `order` (position within its group)
 *   finding.sources                           transcript remarks a drafted finding came from
 */

export type RatingCode = "G" | "F" | "P" | "NA";
export type Rating = RatingCode | "";
/** A section's rating: set, or "auto" (worked out from its subsections). */
export type SectionRating = Rating | "auto";
export type PriorityScheme = "hml" | "rr";
export type ActionOrder = "report" | "priority" | "due";
export type PhotoStatus = "report" | "appendix" | "excluded";
export type ReportStatus = "draft" | "issued";

export interface Action {
  title: string;
  recommendation: string;
  /** A code in the report's scheme: H / M / L or REQ / REC. Empty until chosen. */
  priority: string;
  assignee: string;
  due: string;
}

/** A transcript remark a drafted finding came from. */
export interface Source {
  segmentId: string;
  start: number;
  end: number;
  text: string;
}

export interface Finding {
  id: string;
  description: string;
  location: string;
  observationOnly: boolean;
  action: Action;
  /** Made by a draft and not yet changed by Cecil. */
  drafted?: boolean;
  sources?: Source[];
}

export interface DraftedMarks {
  rating?: boolean;
  notes?: boolean;
  summary?: boolean;
}

export interface Item {
  key: string;
  label: string;
  hidden: boolean;
  rating: Rating;
  noMaterialIssues: boolean;
  notes: string;
  /** Regulatory Compliance: confirmed by the tenant. */
  confirmed: boolean;
  findings: Finding[];
  /** Added by Cecil (or kept from a draft), not from the template. */
  custom?: boolean;
  /** Added by a draft because nothing in the list fit; Cecil keeps, renames or merges it. */
  suggested?: boolean;
  drafted?: DraftedMarks;
}

export interface Section {
  key: string;
  title: string;
  /** Regulatory Compliance: confirmed by the tenant, never rated. */
  compliance: boolean;
  rating: SectionRating;
  summary: string;
  items: Item[];
  drafted?: DraftedMarks;
}

export type MarkupType = "arrow" | "circle" | "area" | "text";

/** A shape drawn on a photo, in fractions of its width and height (v1 photos/markup.js). */
export interface MarkupShape {
  type: MarkupType;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** A text label's words. */
  text?: string;
  /** A numbered area's close-up photo. */
  photoId?: string | null;
}

export interface Photo {
  id: string;
  /** The stored file shown in the report (the rotated one after a rotation). */
  asset?: string;
  /** The camera's original file, when kept. */
  original?: string | null;
  name?: string;
  /** name|size|lastModified, to skip a photo added twice. */
  sig?: string;
  takenAt?: number;
  lat?: number | null;
  lng?: number | null;
  w?: number;
  h?: number;
  caption: string;
  status: PhotoStatus;
  /** The subsection ref it's placed in, or null (Unsorted or overview). */
  item: string | null;
  findings: string[];
  alsoIn: string[];
  markup: MarkupShape[];
  overview?: boolean;
  order?: number;
  addedAt?: number;
  /** The walk-through it came from, and when in the recording it was taken. */
  walkId?: string;
  offsetMs?: number;
}

export interface Person {
  name: string;
  title?: string;
  org?: string;
}

export interface Parcel {
  pid: string;
  address?: string;
  desc?: string;
}

export interface IssueHistoryEntry {
  rev: number;
  at?: number;
}

export interface Assessment {
  id: string;
  kind: "assessment";
  schema: number;
  templateKey: string;
  templateName: string;
  templateVersion: number;
  propertyName: string;
  clientName: string;
  priorityScheme: PriorityScheme;
  actionOrder: ActionOrder;
  /** The day the last automatic daily version was saved. */
  versionDay: string;
  useType: string;
  operator: string;
  facilityContact: string;
  address: string;
  lat: string;
  lng: string;
  date: string;
  time: string;
  preparedBy: string;
  weather: string;
  personnel: Person[];
  parcels: Parcel[];
  generalComments: string;
  sections: Section[];
  photos: Photo[];
  coverPhoto: string | null;
  status: ReportStatus;
  revision: number;
  history: IssueHistoryEntry[];
  issuedAt?: number;
  createdAt: number;
  updatedAt: number;
  copiedFrom?: { id: string; date: string };
  spellCheckedAt?: number;
  textEditedAt?: number;
  walkthrough?: Record<string, unknown>;
}

/** A standard list as stored in settings: what new reports on a template start with. */
export interface ListSection {
  key: string;
  title: string;
  compliance: boolean;
  items: { key: string; label: string }[];
}

export interface Phrase {
  id: string;
  title: string;
  text: string;
}

/** Report settings (v1's Branding & settings); in v2, an organization's. */
export interface ReportSettings {
  company: string;
  contact: string;
  preparedBy: string;
  accent: string;
  logo: string | null;
  disclaimer: string;
  defaultPriorityScheme: PriorityScheme;
  phrases: Phrase[];
  /** How a subsection with no rating, notes or findings prints: its name only, or its name then notDiscussedText. */
  notDiscussedPrint: "name" | "text";
  notDiscussedText: string;
  /** Cecil's own standard lists, once he edits one (model/sections.ts). */
  sectionLists?: Partial<Record<string, ListSection[]>>;
}
