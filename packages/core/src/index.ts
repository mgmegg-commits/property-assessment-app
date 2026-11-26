/**
 * @crb/core: pure code shared by the server and the web app. No database,
 * no web page, no network: the report model ported from v1 (assessment
 * document, templates, sections, priorities, checks, phrases, versions,
 * migrations). See packages/core/README.md.
 */

export const APP_ID = "cecils-report-builder";
export const APP_NAME = "Cecil's Report Builder";

/** The kinds of organization a copy holds; the boundary for keeping data separate. */
export const ORGANIZATION_TYPES = ["assessor_firm", "client", "facility_operator"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  assessor_firm: "Assessor firm",
  client: "Client",
  facility_operator: "Facility operator",
};

export const organizationTypeLabel = (type: OrganizationType): string => ORGANIZATION_TYPE_LABELS[type];

export const isOrganizationType = (value: unknown): value is OrganizationType =>
  typeof value === "string" && (ORGANIZATION_TYPES as readonly string[]).includes(value);

/* ---------- The report model (ported from v1; see packages/core/README.md) ---------- */
export type * from "./model/types.js";
export * from "./model/templates.js";
export * from "./model/assessment.js";
export * from "./model/sections.js";
export * from "./model/checks.js";
export * from "./model/phrases.js";
export * from "./model/versions.js";
export * from "./model/settings.js";
export * from "./util/format.js";
export { uid, deepClone } from "./util/ids.js";
