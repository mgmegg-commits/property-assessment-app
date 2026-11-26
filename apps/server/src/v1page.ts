/**
 * v1's front end (apps/v1-web/index.html), built from a pinned v1 commit and
 * served unchanged at "/". VERSION.json next to it names the commit and the
 * file's SHA-256; the server refuses to start if they don't match.
 *
 * v1's page is one file with its script and styles inline, and loads its PDF,
 * Excel and photo libraries from cdnjs and jsDelivr and its fonts from Google
 * Fonts, so its content security policy allows exactly those: the inline
 * script by hash, inline styles, and those hosts.
 *
 * The one addition: a script tag before </body> for /app/v1-home-link.js,
 * which puts a Follow-up button on v1's home page. The file itself is never
 * changed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface V1Version {
  repo: string;
  commit: string;
  committedAt: string;
  subject: string;
  file: string;
  sha256: string;
  bytes: number;
}

/** The script tag added to v1's page: the Follow-up button on its home page. */
export const HOME_LINK_TAG = '<script src="/app/v1-home-link.js" defer></script>';

export interface V1Page {
  /** v1's page as served: the built file, plus HOME_LINK_TAG before </body>. */
  html: Buffer;
  /** The built file, byte for byte. */
  original: Buffer;
  version: V1Version;
  contentSecurityPolicy: string;
}

const sha256 = (data: Buffer | string, encoding: "hex" | "base64") => createHash("sha256").update(data).digest(encoding);

/** Hashes of the page's inline <script> blocks, for its content security policy. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    hashes.push(`'sha256-${sha256(match[1] ?? "", "base64")}'`);
  }
  return hashes;
}

export function v1ContentSecurityPolicy(html: string, extraScripts: string[] = []): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inlineScriptHashes(html), ...extraScripts, "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"].join(" "),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function loadV1Page(dir: string): V1Page {
  const original = readFileSync(path.join(dir, "index.html"));
  const version = JSON.parse(readFileSync(path.join(dir, "VERSION.json"), "utf8")) as V1Version;
  const actual = sha256(original, "hex");
  if (actual !== version.sha256) {
    throw new Error(`apps/v1-web/index.html doesn't match its VERSION.json (sha256 ${actual}, expected ${version.sha256}). Rebuild it with scripts/refresh-v1.sh.`);
  }
  const text = original.toString("utf8");
  const end = text.lastIndexOf("</body>");
  if (end < 0) throw new Error("apps/v1-web/index.html has no </body>.");
  const html = Buffer.from(`${text.slice(0, end)}${HOME_LINK_TAG}\n${text.slice(end)}`, "utf8");
  return { html, original, version, contentSecurityPolicy: v1ContentSecurityPolicy(text) };
}
