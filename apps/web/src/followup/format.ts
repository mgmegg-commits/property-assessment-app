/** Words and dates the follow-up pages share, as the prototype shows them. */
import type { Status } from "./api.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-12-15" → "Dec 15, 2026"; empty → "TBD". */
export function usDate(iso: string | null | undefined, empty = "TBD"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : empty;
}

/** A moment ("2026-11-20T15:04:05Z") as the day it was, here: "Nov 20, 2026". */
export function usDay(isoMoment: string): string {
  const d = new Date(isoMoment);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export const STATUS_LABELS: Record<Status, string> = { open: "Open", in_progress: "In progress", done: "Done", deferred: "Deferred", withdrawn: "Withdrawn" };

/** "Cecil Ingram Properties LLC" → "Cecil Ingram Properties". */
export const companyShort = (company: string): string => company.replace(/[,\s]+(LLC|L\.L\.C\.|Inc\.?|Co\.?|Corp\.?)$/i, "").trim();

/** "Cecil Ingram Properties LLC" → "CIP". */
export function initials(company: string): string {
  const words = companyShort(company).split(/\s+/).filter(Boolean);
  return (words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 3)) || "CR";
}

/** "Due Dec 15, 2026", "Overdue · was due Nov 20, 2026", or "No due date" (nothing once Done). */
export function dueText(item: { status: Status; dueDate: string | null; overdue: boolean }): string {
  if (item.status === "done") return "";
  if (!item.dueDate) return "No due date";
  return item.overdue ? `Overdue · was due ${usDate(item.dueDate)}` : `Due ${usDate(item.dueDate)}`;
}

/** "Cottage 1 · Building Envelope / Roof" */
export const where = (item: { location: string; section: string; subsection: string }): string =>
  [item.location, `${item.section} / ${item.subsection}`].filter(Boolean).join(" · ");
