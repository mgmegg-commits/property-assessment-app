/**
 * v1's storage (v1 server/storage.js), in PostgreSQL, with photo files on disk.
 *
 *   report          v1's reports, exactly as v1's page sends them (schema 6)
 *   setting         Branding & settings, one document
 *   doc             transcripts, training examples, versions, version indexes
 *   file            photo and logo files; bytes under <dataDir>/files/<id>
 *   job             drafting jobs
 *
 * Nothing is ever removed: deleting a report or a file hides it.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import type { Pool } from "./db.js";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
/** Collections v1's page may read and write as plain documents. */
export const DOC_COLLECTIONS = new Set(["transcripts", "training", "versions", "versionIndex"]);

export class BadId extends Error {
  readonly statusCode = 400;
  constructor() { super("Invalid id"); }
}

/** Ids come from URLs; anything else could reach outside the data folder. */
export function assertId(id: unknown): string {
  if (typeof id !== "string" || !ID.test(id)) throw new BadId();
  return id;
}

export const newId = (): string => randomUUID().replace(/-/g, "");

/* eslint-disable @typescript-eslint/no-explicit-any -- v1's documents are opaque JSON to the server */
export type Json = any;

export interface FileMeta {
  id: string;
  contentType: string;
  bytes: number;
  sha256: string;
  hidden: boolean;
}

type Queryable = Pool | pg.PoolClient;

export class Storage {
  constructor(readonly pool: Pool, readonly dataDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.filesDir, { recursive: true });
  }

  get filesDir(): string {
    return path.join(this.dataDir, "files");
  }

  /* ---------- Reports ---------- */

  /** The number that changes whenever a report changes (v1's "version"). */
  async version(db: Queryable = this.pool): Promise<number> {
    const { rows } = await db.query<{ value: string }>("SELECT value FROM change_counter WHERE id = 1");
    return Number(rows[0]?.value ?? 0);
  }

  private async bumpVersion(db: Queryable): Promise<void> {
    await db.query("UPDATE change_counter SET value = value + 1 WHERE id = 1");
  }

  async listAssessments(): Promise<Json[]> {
    const { rows } = await this.pool.query<{ doc: Json }>("SELECT doc FROM report WHERE deleted_at IS NULL ORDER BY created_at");
    return rows.map((r) => r.doc);
  }

  async getAssessment(id: string, db: Queryable = this.pool): Promise<Json | null> {
    const { rows } = await db.query<{ doc: Json }>("SELECT doc FROM report WHERE id = $1 AND deleted_at IS NULL", [assertId(id)]);
    return rows[0]?.doc ?? null;
  }

  /** Saves a report as sent. Runs in the caller's transaction when given one. */
  async saveAssessment(doc: Json, db: Queryable = this.pool): Promise<void> {
    await db.query(
      `INSERT INTO report (id, doc) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now(), deleted_at = NULL`,
      [assertId(doc.id), JSON.stringify(doc)],
    );
    await this.bumpVersion(db);
  }

  /** "Delete": the report leaves the list and answers 404, but is kept. */
  async deleteAssessment(id: string): Promise<void> {
    await this.pool.query("UPDATE report SET deleted_at = coalesce(deleted_at, now()) WHERE id = $1", [assertId(id)]);
    await this.bumpVersion(this.pool);
  }

  /* ---------- Settings ---------- */

  async getSettings(): Promise<Json | null> {
    const { rows } = await this.pool.query<{ doc: Json }>("SELECT doc FROM setting WHERE id = 1");
    return rows[0]?.doc ?? null;
  }

  async saveSettings(doc: Json): Promise<void> {
    await this.pool.query(
      "INSERT INTO setting (id, doc) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
      [JSON.stringify(doc ?? {})],
    );
  }

  /* ---------- Documents ---------- */

  async getDoc(collection: string, id: string): Promise<Json | null> {
    const { rows } = await this.pool.query<{ doc: Json }>("SELECT doc FROM doc WHERE collection = $1 AND id = $2", [collection, assertId(id)]);
    return rows[0]?.doc ?? null;
  }

  async putDoc(collection: string, id: string, doc: Json): Promise<void> {
    await this.pool.query(
      `INSERT INTO doc (collection, id, doc) VALUES ($1, $2, $3)
       ON CONFLICT (collection, id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [collection, assertId(id), JSON.stringify(doc)],
    );
  }

  async listDocs(collection: string): Promise<Json[]> {
    const { rows } = await this.pool.query<{ doc: Json }>("SELECT doc FROM doc WHERE collection = $1 ORDER BY id", [collection]);
    return rows.map((r) => r.doc);
  }

  /* ---------- Files ---------- */

  /** Stores a file's bytes (written to a temporary file first, so a crash never leaves half a photo). */
  async putFile(buffer: Buffer, contentType: string): Promise<string> {
    const id = newId();
    const file = path.join(this.filesDir, id);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, buffer);
    await rename(temp, file);
    await this.pool.query("INSERT INTO file (id, content_type, bytes, sha256) VALUES ($1, $2, $3, $4)", [
      id, contentType, buffer.length, createHash("sha256").update(buffer).digest("hex"),
    ]);
    return id;
  }

  async getFileMeta(id: string): Promise<FileMeta | null> {
    const { rows } = await this.pool.query<{ id: string; content_type: string; bytes: number; sha256: string; hidden_at: Date | null }>(
      "SELECT id, content_type, bytes, sha256, hidden_at FROM file WHERE id = $1", [assertId(id)],
    );
    const row = rows[0];
    return row ? { id: row.id, contentType: row.content_type, bytes: row.bytes, sha256: row.sha256, hidden: Boolean(row.hidden_at) } : null;
  }

  fileStream(id: string) {
    return createReadStream(path.join(this.filesDir, assertId(id)));
  }

  /** "Delete": the file is hidden, never removed, so older versions of a report still show it. */
  async hideFile(id: string): Promise<void> {
    await this.pool.query("UPDATE file SET hidden_at = coalesce(hidden_at, now()) WHERE id = $1", [assertId(id)]);
  }

  /* ---------- Drafting jobs ---------- */

  async saveJob(job: Json): Promise<void> {
    await this.pool.query(
      `INSERT INTO job (id, assessment_id, doc) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [job.id, job.assessmentId, JSON.stringify(job)],
    );
  }

  async getJob(id: string): Promise<Json | null> {
    const { rows } = await this.pool.query<{ doc: Json }>("SELECT doc FROM job WHERE id = $1", [assertId(id)]);
    return rows[0]?.doc ?? null;
  }

  async runningJobs(): Promise<Json[]> {
    const { rows } = await this.pool.query<{ doc: Json }>("SELECT doc FROM job WHERE doc ->> 'status' = 'running'");
    return rows.map((r) => r.doc);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
