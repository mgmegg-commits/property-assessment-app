/**
 * Follow-up: items created at issue, the Follow-up page's API, personal update
 * links (only their own property's open items, and nothing once turned off),
 * and the Excel export.
 */
import { readFileSync } from "node:fs";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import XLSX from "xlsx-js-style";
import { buildApp } from "../src/app.js";
import { createPool, type Pool } from "../src/db.js";
import { followUpOptions, todayIn } from "../src/followup.js";
import { migrate, readMigrations } from "../src/migrate.js";
import { createTestDatabase, type TestDatabase } from "../../../tests/setup/test-database.js";
import { PASSWORD, testConfig } from "./helpers.js";

const FIXTURES = new URL("../../../tests/fixtures/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const PUBLIC_URL = "https://reports.example.com";

let db: TestDatabase;
let pool: Pool;
let app: FastifyInstance;
let cookie: string;

/* eslint-disable @typescript-eslint/no-explicit-any -- API answers are read as JSON */
type Item = any;

beforeAll(async () => {
  db = await createTestDatabase();
  pool = createPool(db.url);
  await migrate(pool, await readMigrations());
  const config = testConfig({ publicUrl: PUBLIC_URL });
  app = await buildApp({ config, pool, version: "test", ...followUpOptions(config) });
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: PASSWORD } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
});

const call = (method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { cookie, ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) });
const anonymous = (method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as never }) });
const followUp = async () => (await call("GET", "/api/follow-up")).json();
const itemsOf = async (property: string): Promise<Item[]> => (await followUp()).items.filter((i: Item) => i.property === property);
const byFinding = (items: Item[], reportId: string, findingId: string) => {
  // Items carry their report; the finding id isn't exposed, so match on the frozen title.
  return items.filter((i) => i.reportId === reportId).find((i) => i.title === TITLES[findingId]);
};
const TITLES: Record<string, string> = { "f-tpo": "TPO repairs not per specs", "f-stains": "Replace stained ceiling tiles", "f-deck": "Repair pool deck" };

/** The schema 6 report v1 saves (tests/fixtures), as a fresh report for one property. */
function report(id: string, propertyName: string) {
  return { ...fixture("v1/documents/assessment-schema-6.json"), id, propertyName, status: "draft", revision: 0, history: [] };
}
const issue = (doc: any) => ({ ...doc, status: "issued", issuedAt: Date.now(), history: [...doc.history, { rev: doc.revision, at: Date.now() }] });

describe("issuing a report", () => {
  const draft = report("a-pine", "Pine Grove Cottages");

  it("a draft makes no items", async () => {
    await call("PUT", `/api/assessments/${draft.id}`, draft);
    expect(await itemsOf("Pine Grove Cottages")).toEqual([]);
  });

  it("issuing makes one item per action, in the report's action order, with its text frozen", async () => {
    const issued = issue(draft);
    expect((await call("PUT", `/api/assessments/${draft.id}`, issued)).statusCode).toBe(200);
    const items = await itemsOf("Pine Grove Cottages");
    // actionOrder "due": the one with a saved due date first, then by priority. The observation isn't an action.
    expect(items.map((i: Item) => [i.number, i.title, i.priorityLabel, i.status])).toEqual([
      ["A1", "TPO repairs not per specs", "Medium", "open"],
      ["A2", "Repair pool deck", "High", "open"],
      ["A3", "Replace stained ceiling tiles", "Low", "open"],
    ]);
    const tpo = items[0];
    expect(tpo).toMatchObject({
      description: "TPO repairs were not made per manufacturer specifications.",
      location: "West wing; Building C",
      recommendation: "TPO repairs should be per manufacturer specifications.",
      section: "Building Envelope",
      subsection: "Roof",
      assessmentDate: "2026-11-03",
      facilityContact: "Pat Example; pat@example.com",
      assignee: "Facility maintenance", // what Cecil filled in becomes the starting value
      dueDate: "2027-03-01",
      photoIds: ["file-p1", "file-p3"],
    });
    expect(tpo.lastUpdate).toMatchObject({ by: "Cecil Ingram", via: "report", text: "Found during the Nov 3 visit" });
    expect(items[1]).toMatchObject({ assignee: "", dueDate: null });
  });

  it("the report itself is kept exactly as issued, and served back unchanged", async () => {
    const stored = (await call("GET", `/api/assessments/${draft.id}`)).json();
    expect(stored.schema).toBe(6);
    expect(stored.sections[0].items[0].findings[0].action.assignee).toBe("Facility maintenance");
    const { rows } = await pool.query("SELECT doc FROM issued_report WHERE report_id = $1 AND revision = 0", [draft.id]);
    expect(rows[0].doc).toEqual(stored);
  });

  it("saving the issued report again makes nothing twice", async () => {
    const stored = (await call("GET", `/api/assessments/${draft.id}`)).json();
    await call("PUT", `/api/assessments/${draft.id}`, { ...stored, spellCheckedAt: Date.now() });
    expect(await itemsOf("Pine Grove Cottages")).toHaveLength(3);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM issued_report WHERE report_id = $1", [draft.id]);
    expect(rows[0].n).toBe(1);
  });

  it("a revision withdraws removed items, adds new ones, updates text, and keeps live fields", async () => {
    let items = await itemsOf("Pine Grove Cottages");
    const deck = byFinding(items, draft.id, "f-deck");
    await call("PATCH", `/api/follow-up/items/${deck.id}`, { by: "Jordan Lee", assignee: "Alex Rivera", dueDate: "2026-12-15", status: "in_progress" });

    const stored = (await call("GET", `/api/assessments/${draft.id}`)).json();
    const revised = { ...stored, status: "draft", revision: 1 };
    const site = revised.sections.find((s: any) => s.key === "site");
    const deckItem = site.items.find((i: any) => i.key === "i-deck");
    deckItem.findings[0].action.title = "Repair pool deck cracks";
    const interior = revised.sections.find((s: any) => s.key === "int");
    interior.items.find((i: any) => i.key === "ceiling").findings = []; // the stains finding is gone
    revised.sections[0].items[0].findings.push({ id: "f-new", description: "Loose flashing.", location: "North", observationOnly: false, drafted: false,
      action: { title: "Secure flashing", recommendation: "Re-secure it.", priority: "H", assignee: "", due: "" } });
    await call("PUT", `/api/assessments/${draft.id}`, revised);
    expect((await itemsOf("Pine Grove Cottages")).every((i: Item) => i.revision === 0), "a draft revision changes nothing").toBe(true);

    await call("PUT", `/api/assessments/${draft.id}`, issue(revised));
    items = await itemsOf("Pine Grove Cottages");
    expect(items).toHaveLength(4);
    const updated = items.find((i: Item) => i.id === deck.id);
    expect(updated).toMatchObject({ title: "Repair pool deck cracks", assignee: "Alex Rivera", dueDate: "2026-12-15", status: "in_progress", revision: 1 });
    expect(updated.lastUpdate.text).toBe("Updated in revision 1");
    const stains = items.find((i: Item) => i.title === "Replace stained ceiling tiles");
    expect(stains).toMatchObject({ status: "withdrawn" });
    expect(stains.lastUpdate.text).toBe("Not in revision 1");
    expect(items.find((i: Item) => i.title === "Secure flashing")).toMatchObject({ status: "open", revision: 1 });
  });
});

describe("the Follow-up page", () => {
  it("needs the password", async () => {
    for (const [method, url] of [["GET", "/api/follow-up"], ["PATCH", "/api/follow-up/items/00000000-0000-0000-0000-000000000000"], ["POST", "/api/follow-up/links"],
      ["PATCH", "/api/follow-up/links/00000000-0000-0000-0000-000000000000"], ["GET", "/api/follow-up/export.xlsx"], ["GET", "/api/follow-up/items/00000000-0000-0000-0000-000000000000/history"]] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("lists each property with its latest issued report", async () => {
    const page = await followUp();
    expect(page.properties).toContainEqual(expect.objectContaining({ name: "Pine Grove Cottages", reportDate: "2026-11-03", revision: 1 }));
    expect(page.today).toBe(todayIn("America/Chicago"));
  });

  it("each change records who and when; nothing to save is refused", async () => {
    const [item] = await itemsOf("Pine Grove Cottages");
    expect((await call("PATCH", `/api/follow-up/items/${item.id}`, { status: "done" })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/follow-up/items/${item.id}`, { by: "Jordan Lee" })).json().error).toBe("Nothing to save.");
    const saved = (await call("PATCH", `/api/follow-up/items/${item.id}`, { by: "Jordan Lee", facility: "Cottage 1", note: "Called the roofer." })).json();
    expect(saved.facility).toBe("Cottage 1");
    expect(saved.lastUpdate).toMatchObject({ by: "Jordan Lee", via: "office", text: "Facility: Cottage 1: Called the roofer." });
    const history = (await call("GET", `/api/follow-up/items/${item.id}/history`)).json();
    expect(history.map((h: any) => h.by)).toEqual(["Cecil Ingram", "Jordan Lee"]);
    expect(Date.parse(history[1].at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("statuses: Open, In progress, Done, Deferred; never Withdrawn by hand, and a withdrawn item can't be changed", async () => {
    const items = await itemsOf("Pine Grove Cottages");
    const open = items.find((i: Item) => i.status === "open");
    expect((await call("PATCH", `/api/follow-up/items/${open.id}`, { by: "J", status: "withdrawn" })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/follow-up/items/${open.id}`, { by: "J", status: "deferred", note: "Next budget year." })).json().status).toBe("deferred");
    const withdrawn = items.find((i: Item) => i.status === "withdrawn");
    expect((await call("PATCH", `/api/follow-up/items/${withdrawn.id}`, { by: "J", status: "open" })).statusCode).toBe(409);
  });

  it("an item past its due date and still open is overdue", async () => {
    const items = await itemsOf("Pine Grove Cottages");
    const item = items.find((i: Item) => i.title === "Secure flashing");
    expect((await call("PATCH", `/api/follow-up/items/${item.id}`, { by: "J", dueDate: "2020-01-01" })).json().overdue).toBe(true);
    expect((await call("PATCH", `/api/follow-up/items/${item.id}`, { by: "J", status: "done" })).json().overdue).toBe(false);
    expect((await call("PATCH", `/api/follow-up/items/${item.id}`, { by: "J", dueDate: "tomorrow" })).statusCode).toBe(400);
  });

  it("the history can't be changed, even in the database", async () => {
    await expect(pool.query("UPDATE action_update SET note = 'edited'")).rejects.toThrow(/never changed or removed/);
    await expect(pool.query("DELETE FROM action_update")).rejects.toThrow(/never changed or removed/);
  });
});

describe("personal update links", () => {
  let pineLink: any;
  let otherItem: Item;
  const token = (url: string) => url.split("/u/")[1]!;

  beforeAll(async () => {
    const other = report("a-oak", "Oak Hollow");
    await call("PUT", `/api/assessments/${other.id}`, issue(other));
    otherItem = (await itemsOf("Oak Hollow"))[0];
  });

  it("are made for one named person at one property, with the copy's public address", async () => {
    const response = await call("POST", "/api/follow-up/links", { property: "Pine Grove Cottages", personName: "Alex Rivera", role: "Maintenance lead", by: "Jordan Lee" });
    expect(response.statusCode).toBe(201);
    pineLink = response.json();
    expect(pineLink).toMatchObject({ property: "Pine Grove Cottages", personName: "Alex Rivera", role: "Maintenance lead", active: true, createdBy: "Jordan Lee" });
    expect(pineLink.url).toMatch(new RegExp(`^${PUBLIC_URL}/u/[\\w-]{43}$`));
    expect((await followUp()).links).toContainEqual(pineLink);
    expect((await call("POST", "/api/follow-up/links", { property: "Nowhere", personName: "X" })).statusCode).toBe(400);
    expect((await call("POST", "/api/follow-up/links", { property: "Pine Grove Cottages", personName: " " })).statusCode).toBe(400);
  });

  it("open without signing in, and show only that property's Open and In progress items", async () => {
    const page = (await anonymous("GET", `/api/link/${token(pineLink.url)}`)).json();
    expect(page.person).toEqual({ name: "Alex Rivera", role: "Maintenance lead" });
    expect(page.property).toBe("Pine Grove Cottages");
    const pine = await itemsOf("Pine Grove Cottages");
    const expected = pine.filter((i: Item) => i.status === "open" || i.status === "in_progress").map((i: Item) => i.id).sort();
    expect(page.items.map((i: Item) => i.id).sort()).toEqual(expected);
    expect(page.items.some((i: Item) => i.id === otherItem.id)).toBe(false);
    expect(page.items[0].history[0]).toMatchObject({ by: "Cecil Ingram", text: "Found during the Nov 3 visit" });
    // Nothing about other properties or links. (Who updated an item, office or facility, is part of its history.)
    const body = JSON.stringify(page);
    for (const secret of ["Oak Hollow", "links", "token", pineLink.url]) expect(body).not.toContain(secret);
  });

  it("can't see or update another property's item", async () => {
    const t = token(pineLink.url);
    const response = await anonymous("POST", `/api/link/${t}/items/${otherItem.id}`, { status: "done" });
    expect(response.statusCode).toBe(404);
    expect((await itemsOf("Oak Hollow"))[0].status).toBe("open");
    const done = (await itemsOf("Pine Grove Cottages")).find((i: Item) => i.status === "done");
    expect((await anonymous("POST", `/api/link/${t}/items/${done.id}`, { status: "in_progress" })).statusCode, "a Done item isn't on the link").toBe(404);
    expect((await anonymous("POST", `/api/link/${t}/items/not-a-uuid`, { status: "done" })).statusCode).toBe(404);
  });

  it("an update records the person's name and the time; Done leaves the list", async () => {
    const t = token(pineLink.url);
    const reopen = (await itemsOf("Pine Grove Cottages")).find((i: Item) => i.status === "deferred");
    await call("PATCH", `/api/follow-up/items/${reopen.id}`, { by: "Jordan Lee", status: "open" });
    const item = (await anonymous("GET", `/api/link/${t}`)).json().items.find((i: Item) => i.status === "open");
    expect((await anonymous("POST", `/api/link/${t}/items/${item.id}`, {})).statusCode, "something to save").toBe(400);
    expect((await anonymous("POST", `/api/link/${t}/items/${item.id}`, { status: "deferred" })).statusCode, "only In progress or Done").toBe(400);
    expect((await anonymous("POST", `/api/link/${t}/items/${item.id}`, { status: "in_progress", note: "Roofer booked for Dec 8." })).statusCode).toBe(200);
    let office = (await itemsOf("Pine Grove Cottages")).find((i: Item) => i.id === item.id);
    expect(office.status).toBe("in_progress");
    expect(office.lastUpdate).toMatchObject({ by: "Alex Rivera", via: "link", text: "Marked In progress: Roofer booked for Dec 8." });
    expect(Date.parse(office.lastUpdate.at)).toBeGreaterThan(Date.now() - 60_000);

    await anonymous("POST", `/api/link/${t}/items/${item.id}`, { status: "done" });
    office = (await itemsOf("Pine Grove Cottages")).find((i: Item) => i.id === item.id);
    expect(office.status).toBe("done");
    expect((await anonymous("GET", `/api/link/${t}`)).json().items.some((i: Item) => i.id === item.id)).toBe(false);
  });

  it("a photo: uploaded from the link, attached to an update, and visible only through that property's link", async () => {
    const t = token(pineLink.url);
    const item = (await anonymous("GET", `/api/link/${t}`)).json().items[0];
    const upload = await anonymous("POST", `/api/link/${t}/photos`, JPEG, { "content-type": "image/jpeg" });
    expect(upload.statusCode).toBe(201);
    const { id: photoId } = upload.json();
    expect((await anonymous("POST", `/api/link/${t}/items/${item.id}`, { photoId })).statusCode).toBe(200);
    const page = (await anonymous("GET", `/api/link/${t}`)).json();
    expect(page.items.find((i: Item) => i.id === item.id).history.at(-1)).toMatchObject({ by: "Alex Rivera", text: "Added a photo", photoId });
    const back = await anonymous("GET", `/api/link/${t}/files/${photoId}`);
    expect(back.statusCode).toBe(200);
    expect(back.rawPayload.equals(JPEG)).toBe(true);

    // Another property's link can't see it, or attach it.
    const oak = (await call("POST", "/api/follow-up/links", { property: "Oak Hollow", personName: "Sam Oak" })).json();
    expect((await anonymous("GET", `/api/link/${token(oak.url)}/files/${photoId}`)).statusCode).toBe(404);
    expect((await anonymous("POST", `/api/link/${token(oak.url)}/items/${otherItem.id}`, { photoId })).statusCode).toBe(400);
    // A photo uploaded with the password isn't reachable through a link.
    const officePhoto = (await call("POST", "/api/files", JPEG, { "content-type": "image/jpeg" })).json().id;
    expect((await anonymous("GET", `/api/link/${t}/files/${officePhoto}`)).statusCode).toBe(404);
  });

  it("stop working when turned off, and work again when turned on", async () => {
    const t = token(pineLink.url);
    const off = await call("PATCH", `/api/follow-up/links/${pineLink.id}`, { active: false });
    expect(off.json().active).toBe(false);
    const page = await anonymous("GET", `/api/link/${t}`);
    expect(page.statusCode).toBe(410);
    expect(page.json()).toMatchObject({ off: true, error: "This link has been turned off." });
    expect(JSON.stringify(page.json())).not.toContain("Pine Grove");
    const item = (await itemsOf("Pine Grove Cottages")).find((i: Item) => i.status === "open" || i.status === "in_progress");
    const blocked: LightMyRequestResponse[] = [
      await anonymous("POST", `/api/link/${t}/items/${item.id}`, { status: "done" }),
      await anonymous("POST", `/api/link/${t}/photos`, JPEG, { "content-type": "image/jpeg" }),
      await anonymous("GET", `/api/link/${t}/files/file-p1`),
    ];
    expect(blocked.map((r) => r.statusCode)).toEqual([410, 410, 410]);
    expect((await itemsOf("Pine Grove Cottages")).find((i: Item) => i.id === item.id).status).toBe(item.status);

    await call("PATCH", `/api/follow-up/links/${pineLink.id}`, { active: true });
    expect((await anonymous("GET", `/api/link/${t}`)).statusCode).toBe(200);
  });

  it("an unknown link doesn't work, and says nothing", async () => {
    for (const t of ["x", "a".repeat(43)]) {
      const response = await anonymous("GET", `/api/link/${t}`);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "This link doesn't work." });
    }
  });
});

describe("the Excel export", () => {
  it("has v1's tracker columns, then the current status", async () => {
    const response = await call("GET", "/api/follow-up/export.xlsx?property=Pine%20Grove%20Cottages");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers["content-disposition"]).toMatch(/attachment; filename="Pine Grove Cottages follow-up \d{4}-\d{2}-\d{2}\.xlsx"/);
    const book = XLSX.read(response.rawPayload, { type: "buffer" });
    const rows: string[][] = XLSX.utils.sheet_to_json(book.Sheets["Follow-up tracker"]!, { header: 1, defval: "" });
    expect(rows[0]).toEqual(["Facility Name", "Assessment Date", "Action Item Description", "Q1", "Q2", "Q3", "Q4", "Facility Contact", "Status", "Assigned To", "Due Date", "Facility", "Last Update"]);
    const items = (await itemsOf("Pine Grove Cottages")).filter((i: Item) => i.status !== "withdrawn");
    expect(rows.slice(1).map((r) => r[2])).toEqual(items.map((i: Item) => i.title));
    expect(rows.slice(1).every((r) => r[0] === "Pine Grove Cottages" && r[1] === "11/3/2026")).toBe(true);
    const deck = rows.find((r) => r[2] === "Repair pool deck cracks")!;
    expect([deck[8], deck[9], deck[10]]).toEqual(["In progress", "Alex Rivera", "12/15/2026"]);
    const quarter = Math.floor((Number(todayIn("America/Chicago").slice(5, 7)) - 1) / 3);
    const updatedByLink = rows.find((r) => String(r[12]).includes("Alex Rivera"))!;
    expect(updatedByLink[3 + quarter]).toMatch(/Alex Rivera/);
  });

  it("covers every property when none is chosen", async () => {
    const book = XLSX.read((await call("GET", "/api/follow-up/export.xlsx")).rawPayload, { type: "buffer" });
    const rows: string[][] = XLSX.utils.sheet_to_json(book.Sheets["Follow-up tracker"]!, { header: 1, defval: "" });
    expect(new Set(rows.slice(1).map((r) => r[0]))).toEqual(new Set(["Pine Grove Cottages", "Oak Hollow"]));
  });
});
