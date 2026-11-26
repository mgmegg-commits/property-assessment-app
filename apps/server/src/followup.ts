/**
 * Follow-up: action items from issued reports, and personal update links.
 *
 * At issue (onReportSaved, inside the save's transaction):
 *   - the report exactly as issued is kept in issued_report;
 *   - each action in it (packages/core listActions, in the report's action
 *     order) becomes an action_item with a frozen copy of its text;
 *   - a revision updates that text, withdraws items whose finding is gone,
 *     and adds new ones; facility, person, due date and status carry over.
 * The report itself is never changed.
 *
 * Signed in (the Follow-up page):
 *   GET   /api/follow-up                       properties, items, links, today
 *   GET   /api/follow-up/items/:id/history
 *   PATCH /api/follow-up/items/:id             facility, assignee, due date, status, note (by name)
 *   POST  /api/follow-up/links                 a personal link for one person at one property
 *   PATCH /api/follow-up/links/:id             turn it off or on
 *   GET   /api/follow-up/export.xlsx           v1's tracker columns plus current status
 *
 * No sign-in, the link's token is the access (the phone page):
 *   GET   /api/link/:token                     that property's open items, with history
 *   POST  /api/link/:token/items/:id           In progress or Done, a note, a photo
 *   POST  /api/link/:token/photos              upload a photo for an update
 *   GET   /api/link/:token/files/:id           a photo of one of those items
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import XLSX from "xlsx-js-style";
import { TRACKER_COLUMNS, TRACKER_COLUMN_WIDTHS, deepClone, listActions, migrateAssessment, photosOfFinding, priorityLabel, type Assessment } from "@crb/core";
import type { AppOptions, AppParts } from "./app.js";
import type { Config } from "./config.js";
import { HttpError, IMAGE_TYPES, LIMITS, type OnReportSaved } from "./v1api.js";
import { assertId, type Json, type Storage } from "./storage.js";

export const STATUSES = ["open", "in_progress", "done", "deferred", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = { open: "Open", in_progress: "In progress", done: "Done", deferred: "Deferred", withdrawn: "Withdrawn" };
/** What the Follow-up page may set. Withdrawn comes only from a revision. */
export const OFFICE_STATUSES: Status[] = ["open", "in_progress", "done", "deferred"];
/** What a facility contact may set from a personal link. */
export const LINK_STATUSES: Status[] = ["in_progress", "done"];
/** The items a personal link shows and can update. */
export const LINK_VISIBLE: Status[] = ["open", "in_progress"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usDate = (iso: string | null | undefined, withYear = true): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}${withYear ? `, ${m[1]}` : ""}` : "";
};

/** Today ("YYYY-MM-DD") where the copy is. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const isOverdue = (item: { status: string; due_date: string | null }, today: string): boolean =>
  Boolean(item.due_date) && item.due_date! < today && (item.status === "open" || item.status === "in_progress");

/* ---------- Issuing a report ---------- */

interface FrozenItem {
  findingId: string;
  number: string;
  position: number;
  title: string;
  description: string;
  location: string;
  recommendation: string;
  priority: string;
  priorityLabel: string;
  section: string;
  subsection: string;
  photoIds: string[];
  assignee: string;
  due: string;
}

/** The report's action items, as packages/core lists them (the stored report is never changed). */
export function frozenItems(doc: Json): FrozenItem[] {
  // listActions works on today's shape (schema 7): upgrade a copy in memory only.
  const a = migrateAssessment(deepClone(doc)) as Assessment;
  return listActions(a).map((x, index) => ({
    findingId: x.finding.id,
    number: x.actionNumber,
    // Place in the report's action list (A1 is 0), which is how the Follow-up page and the export order items.
    position: index,
    title: x.finding.action.title || x.finding.description || "Untitled action",
    description: x.finding.description || "",
    location: x.finding.location || "",
    recommendation: x.finding.action.recommendation || "",
    priority: x.finding.action.priority || "",
    priorityLabel: priorityLabel(x.finding.action.priority),
    section: x.section.title,
    subsection: x.item.label,
    photoIds: photosOfFinding(a, x.finding.id).filter((p) => p.status !== "excluded" && p.asset).map((p) => p.asset!),
    assignee: x.finding.v1FollowUp?.assignee || "",
    due: /^\d{4}-\d{2}-\d{2}$/.test(x.finding.v1FollowUp?.due || "") ? x.finding.v1FollowUp!.due! : "",
  }));
}

const propertyOf = (doc: Json): string => String(doc.propertyName || "").trim() || "Untitled property";

const FROZEN_COLUMNS = ["number", "position", "title", "description", "location", "recommendation", "priority", "priority_label", "section", "subsection", "photo_ids", "assessment_date", "facility_contact", "property"] as const;

/** Called inside the transaction that saves a report. */
export const createItemsAtIssue: OnReportSaved = async (doc, previous, db) => {
  if (doc.status !== "issued") return;
  const revision = Number(doc.revision) || 0;
  if (previous?.status === "issued" && (Number(previous.revision) || 0) === revision) return; // already issued; a later save
  const kept = await db.query("INSERT INTO issued_report (report_id, revision, doc) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING report_id", [doc.id, revision, JSON.stringify(doc)]);
  if (!kept.rowCount) return; // this revision's items were made already

  const by = String(doc.preparedBy || "").trim() || "The assessor";
  const visit = usDate(doc.date, false);
  const property = propertyOf(doc);
  const items = frozenItems(doc);
  const { rows: existing } = await db.query<{ id: string; finding_id: string; status: string } & Record<string, unknown>>("SELECT * FROM action_item WHERE report_id = $1", [doc.id]);
  const byFinding = new Map(existing.map((row) => [row.finding_id, row]));
  const frozenValues = (item: FrozenItem) => [item.number, item.position, item.title, item.description, item.location, item.recommendation, item.priority, item.priorityLabel,
    item.section, item.subsection, JSON.stringify(item.photoIds), String(doc.date || ""), String(doc.facilityContact || ""), property];

  for (const item of items) {
    const row = byFinding.get(item.findingId);
    if (!row) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO action_item (report_id, finding_id, revision, ${FROZEN_COLUMNS.join(", ")}, assignee, due_date)
         VALUES ($1, $2, $3, ${FROZEN_COLUMNS.map((_, i) => `$${i + 4}`).join(", ")}, $${FROZEN_COLUMNS.length + 4}, $${FROZEN_COLUMNS.length + 5}) RETURNING id`,
        [doc.id, item.findingId, revision, ...frozenValues(item), item.assignee, item.due || null],
      );
      await db.query("INSERT INTO action_update (item_id, by_name, via, changes, note) VALUES ($1, $2, 'report', $3, $4)",
        [rows[0]!.id, by, JSON.stringify({ event: revision ? "added" : "issued", revision }), visit ? `Found during the ${visit} visit` : "Found during the visit"]);
      continue;
    }
    const restored = row.status === "withdrawn";
    await db.query(
      `UPDATE action_item SET revision = $2, ${FROZEN_COLUMNS.map((c, i) => `${c} = $${i + 3}`).join(", ")}${restored ? ", status = 'open'" : ""}, updated_at = now() WHERE id = $1`,
      [row.id, revision, ...frozenValues(item)],
    );
    const changed = FROZEN_COLUMNS.some((c, i) => JSON.stringify(c === "photo_ids" ? row[c] : String(row[c] ?? "")) !== JSON.stringify(c === "photo_ids" ? item.photoIds : String(frozenValues(item)[i])));
    if (restored || changed) {
      await db.query("INSERT INTO action_update (item_id, by_name, via, changes, note) VALUES ($1, $2, 'report', $3, $4)",
        [row.id, by, JSON.stringify(restored ? { event: "restored", revision, status: { from: "withdrawn", to: "open" } } : { event: "revised", revision }), restored ? `Back in revision ${revision}` : `Updated in revision ${revision}`]);
    }
  }
  const current = new Set(items.map((i) => i.findingId));
  for (const row of existing) {
    if (current.has(row.finding_id) || row.status === "withdrawn") continue;
    await db.query("UPDATE action_item SET status = 'withdrawn', revision = $2, updated_at = now() WHERE id = $1", [row.id, revision]);
    await db.query("INSERT INTO action_update (item_id, by_name, via, changes, note) VALUES ($1, $2, 'report', $3, $4)",
      [row.id, by, JSON.stringify({ event: "withdrawn", revision, status: { from: row.status, to: "withdrawn" } }), `Not in revision ${revision}`]);
  }
};

/* ---------- Reading items ---------- */

interface ItemRow {
  id: string; report_id: string; finding_id: string; property: string; revision: number; number: string; position: number;
  title: string; description: string; location: string; recommendation: string; priority: string; priority_label: string;
  section: string; subsection: string; photo_ids: string[]; assessment_date: string; facility_contact: string;
  status: Status; facility: string; assignee: string; due_date: string | null; created_at: Date; updated_at: Date;
}

interface UpdateRow {
  id: string; item_id: string; at: Date; by_name: string; via: "report" | "office" | "link"; changes: Json; note: string; photo_id: string | null;
}

const ITEM_SELECT = "SELECT *, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM action_item";

/** One line for an update: "Marked Done: panel cleared", "Assigned to Alex Rivera; due Dec 15, 2026". */
export function updateText(update: Pick<UpdateRow, "changes" | "note" | "photo_id" | "via">): string {
  const c = update.changes || {};
  if (update.via === "report") return update.note;
  const parts: string[] = [];
  if (c.status) parts.push(`Marked ${STATUS_LABELS[c.status.to as Status] ?? c.status.to}`);
  if (c.assignee) parts.push(c.assignee.to ? `Assigned to ${c.assignee.to}` : "Assignee cleared");
  if (c.facility) parts.push(c.facility.to ? `Facility: ${c.facility.to}` : "Facility cleared");
  if (c.due_date) parts.push(c.due_date.to ? `Due ${usDate(c.due_date.to)}` : "Due date cleared");
  let text = parts.join("; ");
  if (update.note) text = text ? `${text}: ${update.note}` : update.note;
  if (update.photo_id) text = text ? `${text} (1 photo)` : "Added a photo";
  return text;
}

const presentUpdate = (u: UpdateRow) => ({ id: u.id, at: u.at.toISOString(), by: u.by_name, via: u.via, text: updateText(u), note: u.note, photoId: u.photo_id });

function presentItem(row: ItemRow, today: string, last?: UpdateRow) {
  return {
    id: row.id,
    reportId: row.report_id,
    property: row.property,
    revision: row.revision,
    number: row.number,
    position: row.position,
    title: row.title,
    description: row.description,
    location: row.location,
    recommendation: row.recommendation,
    priority: row.priority,
    priorityLabel: row.priority_label,
    section: row.section,
    subsection: row.subsection,
    photoIds: row.photo_ids,
    assessmentDate: row.assessment_date,
    facilityContact: row.facility_contact,
    status: row.status,
    facility: row.facility,
    assignee: row.assignee,
    dueDate: row.due_date,
    overdue: isOverdue(row, today),
    lastUpdate: last ? presentUpdate(last) : null,
  };
}

export type PresentedItem = ReturnType<typeof presentItem>;

async function lastUpdates(db: pg.Pool | pg.PoolClient, itemIds: string[]): Promise<Map<string, UpdateRow>> {
  if (!itemIds.length) return new Map();
  const { rows } = await db.query<UpdateRow>(
    "SELECT DISTINCT ON (item_id) * FROM action_update WHERE item_id = ANY($1::uuid[]) ORDER BY item_id, at DESC, id DESC", [itemIds]);
  return new Map(rows.map((r) => [r.item_id, r]));
}

async function history(db: pg.Pool, itemId: string) {
  const { rows } = await db.query<UpdateRow>("SELECT * FROM action_update WHERE item_id = $1 ORDER BY at, id", [itemId]);
  return rows.map(presentUpdate);
}

/* ---------- Validation ---------- */

const text = (value: unknown, max: number, what: string): string => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, `${what} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${what} is too long (at most ${max} characters).`);
  return trimmed;
};

const isoDate = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new HttpError(400, "The due date must be a date (YYYY-MM-DD).");
  return value;
};

const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new HttpError(404, "Not found.");
  return value;
};

/* ---------- Links ---------- */

const newToken = (): string => randomBytes(32).toString("base64url");

function origin(request: FastifyRequest, publicUrl: string): string {
  if (publicUrl) return publicUrl;
  return `${request.protocol}://${request.headers.host}`;
}

interface LinkRow { id: string; token: string; property: string; person_name: string; role: string; created_at: Date; created_by: string; active: boolean; changed_at: Date }

const presentLink = (row: LinkRow, base: string) => ({
  id: row.id, property: row.property, personName: row.person_name, role: row.role, active: row.active,
  createdAt: row.created_at.toISOString(), createdBy: row.created_by, url: `${base}/u/${row.token}`,
});

/** v1's default company name, used until Branding & settings is saved (as v1's own page does). */
export const V1_DEFAULT_COMPANY = "Cecil Ingram Properties LLC";
const companyName = (settings: Json): string => String(settings?.company || "").trim() || V1_DEFAULT_COMPANY;

/* ---------- Excel export ---------- */

const trackerDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
};
const quarterOf = (date: Date, timeZone: string) => Math.floor((Number(todayIn(timeZone, date).slice(5, 7)) - 1) / 3);

export const EXPORT_COLUMNS = [...TRACKER_COLUMNS, "Status", "Assigned To", "Due Date", "Facility", "Last Update"];

/** Rows for the Excel tracker: v1's columns, then the live ones. The quarter of the latest update gets its text. */
export function exportRows(items: PresentedItem[], timeZone: string, now = new Date()): string[][] {
  const year = todayIn(timeZone, now).slice(0, 4);
  return [EXPORT_COLUMNS, ...items.map((item) => {
    const quarters = ["", "", "", ""];
    const last = item.lastUpdate;
    if (last && last.via !== "report" && todayIn(timeZone, new Date(last.at)).startsWith(year)) {
      quarters[quarterOf(new Date(last.at), timeZone)] = `${STATUS_LABELS[item.status]} ${trackerDate(todayIn(timeZone, new Date(last.at)))} (${last.by}): ${last.text}`;
    }
    const lastText = last ? `${usDate(todayIn(timeZone, new Date(last.at)))}, ${last.by}: ${last.text}` : "";
    return [item.property, trackerDate(item.assessmentDate), item.title, ...quarters, item.facilityContact,
      STATUS_LABELS[item.status], item.assignee || "TBD", item.dueDate ? trackerDate(item.dueDate) : "TBD", item.facility, lastText];
  })];
}

export function exportWorkbook(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [...TRACKER_COLUMN_WIDTHS, 14, 22, 12, 22, 48].map((wch) => ({ wch }));
  for (const ref of Object.keys(sheet).filter((k) => !k.startsWith("!"))) {
    const header = XLSX.utils.decode_cell(ref).r === 0;
    sheet[ref].s = { alignment: { wrapText: true, vertical: "top" }, ...(header ? { font: { bold: true } } : {}) };
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Follow-up tracker");
  return XLSX.write(book, { bookType: "xlsx", type: "buffer", cellStyles: true }) as Buffer;
}

/* ---------- Routes ---------- */

export function registerFollowUp(app: FastifyInstance, { storage }: AppParts, config: Pick<Config, "publicUrl" | "timeZone">): void {
  const pool = storage.pool;
  const today = () => todayIn(config.timeZone);

  async function allItems(where = "", params: unknown[] = []) {
    const { rows } = await pool.query<ItemRow>(`${ITEM_SELECT} ${where} ORDER BY property, report_id, position`, params);
    const last = await lastUpdates(pool, rows.map((r) => r.id));
    const t = today();
    return rows.map((row) => presentItem(row, t, last.get(row.id)));
  }

  /* ----- The Follow-up page (signed in) ----- */

  app.get("/api/follow-up", async (request) => {
    const items = await allItems();
    const { rows: links } = await pool.query<LinkRow>("SELECT * FROM update_link ORDER BY created_at");
    const { rows: reports } = await pool.query<{ report_id: string; revision: number; issued_at: Date; date: string; property: string }>(
      "SELECT report_id, revision, issued_at, doc ->> 'date' AS date, coalesce(nullif(trim(doc ->> 'propertyName'), ''), 'Untitled property') AS property FROM issued_report ORDER BY issued_at");
    const settings = await storage.getSettings();
    const base = origin(request, config.publicUrl);
    const names = [...new Set([...reports.map((r) => r.property), ...items.map((i) => i.property)])];
    const properties = names.map((name) => {
      const issued = reports.filter((r) => r.property === name);
      const latest = issued.at(-1);
      return { name, reportDate: latest?.date ?? "", issuedAt: latest?.issued_at.toISOString() ?? null, revision: latest?.revision ?? 0 };
    });
    const { rows: latest } = await pool.query<{ prepared_by: string | null }>("SELECT doc ->> 'preparedBy' AS prepared_by FROM issued_report ORDER BY issued_at DESC LIMIT 1");
    return {
      today: today(),
      company: companyName(settings),
      // Who's using this device is asked once; this is only the suggestion.
      preparedBy: String(settings?.preparedBy || latest[0]?.prepared_by || "").trim(),
      properties,
      items,
      links: links.map((l) => presentLink(l, base)),
    };
  });

  app.get<{ Params: { id: string } }>("/api/follow-up/items/:id/history", async (request) => history(pool, uuid(request.params.id)));

  app.patch<{ Params: { id: string } }>("/api/follow-up/items/:id", async (request) => {
    const id = uuid(request.params.id);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const by = text(body.by, 80, "Your name");
    if (!by) throw new HttpError(400, "Say who you are first (your name).");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<ItemRow>(`${ITEM_SELECT} WHERE id = $1 FOR UPDATE`, [id]);
      const row = rows[0];
      if (!row) throw new HttpError(404, "Not found.");
      if (row.status === "withdrawn") throw new HttpError(409, "This item was withdrawn when the report was revised.");
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (body.status !== undefined) {
        if (!OFFICE_STATUSES.includes(body.status as Status)) throw new HttpError(400, "Choose Open, In progress, Done or Deferred.");
        if (body.status !== row.status) changes.status = { from: row.status, to: body.status };
      }
      for (const [field, max, label] of [["facility", 120, "Facility"], ["assignee", 120, "Assigned to"]] as const) {
        if (body[field] === undefined) continue;
        const value = text(body[field], max, label);
        if (value !== row[field]) changes[field] = { from: row[field], to: value };
      }
      if (body.dueDate !== undefined) {
        const due = isoDate(body.dueDate);
        if (due !== row.due_date) changes.due_date = { from: row.due_date, to: due };
      }
      const note = text(body.note, 2000, "The note");
      if (!Object.keys(changes).length && !note) throw new HttpError(400, "Nothing to save.");
      await client.query(
        `UPDATE action_item SET status = $2, facility = $3, assignee = $4, due_date = $5, updated_at = now() WHERE id = $1`,
        [id, changes.status?.to ?? row.status, changes.facility?.to ?? row.facility, changes.assignee?.to ?? row.assignee, "due_date" in changes ? changes.due_date!.to : row.due_date],
      );
      await client.query("INSERT INTO action_update (item_id, by_name, via, changes, note) VALUES ($1, $2, 'office', $3, $4)", [id, by, JSON.stringify(changes), note]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return (await allItems("WHERE id = $1", [id]))[0];
  });

  app.post("/api/follow-up/links", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const property = text(body.property, 200, "The property");
    const personName = text(body.personName, 80, "The name");
    const role = text(body.role, 120, "The role");
    const by = text(body.by, 80, "Your name") || "Office";
    if (!personName) throw new HttpError(400, "Give the person's name.");
    const { rowCount } = await pool.query("SELECT 1 FROM action_item WHERE property = $1 LIMIT 1", [property]);
    if (!rowCount) throw new HttpError(400, "There are no follow-up items for that property yet.");
    const { rows } = await pool.query<LinkRow>("INSERT INTO update_link (token, property, person_name, role, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [newToken(), property, personName, role, by]);
    reply.code(201);
    return presentLink(rows[0]!, origin(request, config.publicUrl));
  });

  app.patch<{ Params: { id: string } }>("/api/follow-up/links/:id", async (request) => {
    const active = (request.body as { active?: unknown } | null)?.active;
    if (typeof active !== "boolean") throw new HttpError(400, "Say whether the link is on or off.");
    const { rows } = await pool.query<LinkRow>("UPDATE update_link SET active = $2, changed_at = now() WHERE id = $1 RETURNING *", [uuid(request.params.id), active]);
    if (!rows[0]) throw new HttpError(404, "Not found.");
    return presentLink(rows[0], origin(request, config.publicUrl));
  });

  app.get<{ Querystring: { property?: string } }>("/api/follow-up/export.xlsx", async (request, reply) => {
    const property = request.query.property;
    const items = (await allItems(property ? "WHERE property = $1 AND status <> 'withdrawn'" : "WHERE status <> 'withdrawn'", property ? [property] : []));
    const name = `${(property || "All properties").replace(/[^\w\- ]+/g, "").trim() || "Follow-up"} follow-up ${today()}.xlsx`;
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${name}"`)
      .send(exportWorkbook(exportRows(items, config.timeZone)));
  });

  /* ----- Personal update links (no sign-in; the token is the access) ----- */

  const open = { config: { public: true } };

  async function linkFor(token: string): Promise<LinkRow> {
    if (typeof token !== "string" || token.length < 32 || token.length > 100) throw new HttpError(404, "This link doesn't work.");
    const { rows } = await pool.query<LinkRow>("SELECT * FROM update_link WHERE token = $1", [token]);
    const link = rows[0];
    if (!link) throw new HttpError(404, "This link doesn't work.");
    if (!link.active) throw new HttpError(410, "This link has been turned off.");
    return link;
  }

  /** An item this link may see: at its property, Open or In progress. */
  async function linkItem(link: LinkRow, itemId: string, db: pg.Pool | pg.PoolClient = pool, lock = false): Promise<ItemRow> {
    const { rows } = await db.query<ItemRow>(`${ITEM_SELECT} WHERE id = $1 AND property = $2 AND status = ANY($3)${lock ? " FOR UPDATE" : ""}`,
      [uuid(itemId), link.property, LINK_VISIBLE]);
    if (!rows[0]) throw new HttpError(404, "That item isn't on this link.");
    return rows[0];
  }

  app.get<{ Params: { token: string } }>("/api/link/:token", open, async (request, reply) => {
    const settings = await storage.getSettings();
    let link: LinkRow;
    try {
      link = await linkFor(request.params.token);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 410) return reply.code(410).send({ error: error.message, off: true, company: companyName(settings) });
      throw error;
    }
    const items = await allItems("WHERE property = $1 AND status = ANY($2)", [link.property, LINK_VISIBLE]);
    const histories = new Map<string, Awaited<ReturnType<typeof history>>>();
    for (const item of items) histories.set(item.id, await history(pool, item.id));
    return {
      person: { name: link.person_name, role: link.role },
      property: link.property,
      company: companyName(settings),
      today: today(),
      items: items.map((item) => ({
        id: item.id, number: item.number, title: item.title, location: item.location, section: item.section, subsection: item.subsection,
        recommendation: item.recommendation, description: item.description, priority: item.priority, priorityLabel: item.priorityLabel,
        status: item.status, dueDate: item.dueDate, overdue: item.overdue, photoIds: item.photoIds, assessmentDate: item.assessmentDate,
        history: histories.get(item.id)!.map(({ at, by, text: t, photoId }) => ({ at, by, text: t, photoId })),
      })),
    };
  });

  app.post<{ Params: { token: string } }>("/api/link/:token/photos", { ...open, bodyLimit: LIMITS.file }, async (request, reply) => {
    const link = await linkFor(request.params.token);
    const type = String(request.headers["content-type"] || "").split(";")[0]!.trim();
    if (!IMAGE_TYPES.includes(type) || !Buffer.isBuffer(request.body)) throw new HttpError(415, "Only JPEG, PNG and WebP images can be stored.");
    const id = await storage.putFile(request.body, type);
    await pool.query("UPDATE file SET link_id = $2 WHERE id = $1", [id, link.id]);
    reply.code(201);
    return { id };
  });

  app.post<{ Params: { token: string; id: string } }>("/api/link/:token/items/:id", open, async (request) => {
    const link = await linkFor(request.params.token);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const status = body.status === undefined || body.status === null || body.status === "" ? null : body.status;
    if (status !== null && !LINK_STATUSES.includes(status as Status)) throw new HttpError(400, "Choose In progress or Done.");
    const note = text(body.note, 2000, "The note");
    let photoId: string | null = null;
    if (body.photoId) {
      photoId = assertId(body.photoId);
      const { rowCount } = await pool.query("SELECT 1 FROM file WHERE id = $1 AND link_id = $2", [photoId, link.id]);
      if (!rowCount) throw new HttpError(400, "That photo wasn't added from this link.");
    }
    if (!status && !note && !photoId) throw new HttpError(400, "Choose In progress or Done, or add a note or a photo.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await linkItem(link, request.params.id, client, true);
      const changes: { status?: { from: string; to: unknown } } = status && status !== row.status ? { status: { from: row.status, to: status } } : {};
      if (changes.status) await client.query("UPDATE action_item SET status = $2, updated_at = now() WHERE id = $1", [row.id, status]);
      await client.query("INSERT INTO action_update (item_id, by_name, via, link_id, changes, note, photo_id) VALUES ($1, $2, 'link', $3, $4, $5, $6)",
        [row.id, link.person_name, link.id, JSON.stringify(changes), note, photoId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  app.get<{ Params: { token: string; id: string } }>("/api/link/:token/files/:id", open, async (request, reply) => {
    const link = await linkFor(request.params.token);
    const fileId = assertId(request.params.id);
    const { rowCount } = await pool.query(
      `SELECT 1 FROM action_item i WHERE i.property = $1 AND i.status = ANY($2) AND (i.photo_ids ? $3
         OR EXISTS (SELECT 1 FROM action_update u WHERE u.item_id = i.id AND u.photo_id = $3))`,
      [link.property, LINK_VISIBLE, fileId]);
    const meta = rowCount ? await storage.getFileMeta(fileId) : null;
    if (!meta) throw new HttpError(404, "Not found.");
    return reply.header("content-type", meta.contentType).header("content-length", meta.bytes).header("cache-control", "private, max-age=86400").send(storage.fileStream(meta.id));
  });
}

/** What main.ts gives buildApp to switch follow-up on. */
export function followUpOptions(config: Pick<Config, "publicUrl" | "timeZone">): Pick<AppOptions, "onReportSaved" | "extend"> {
  return {
    onReportSaved: createItemsAtIssue,
    extend: (app, parts) => registerFollowUp(app, parts, config),
  };
}

/** For tests: storage's pool, typed. */
export type { Storage };
