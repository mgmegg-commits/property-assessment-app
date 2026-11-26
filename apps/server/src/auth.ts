/**
 * One shared password (APP_PASSWORD) for Cecil and anyone he gives it to, as
 * in v1 (server/auth.js). Signing in sets a signed, HttpOnly session cookie,
 * valid for 30 days; the cookie is v1's, so v1's page works unchanged.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "crb_session";
const SESSION_DAYS = 30;
const MAX_ATTEMPTS_PER_MINUTE = 10;

const sign = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export interface AuthConfig {
  password: string;
  sessionSecret: string;
  secureCookies: boolean;
}

export class TooManyAttempts extends Error {}
export class WrongPassword extends Error {}

export function createAuth(config: AuthConfig) {
  const attempts = new Map<string, number[]>(); // ip -> timestamps

  function isAuthenticated(request: FastifyRequest): boolean {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return false;
    const [expires = "", signature = ""] = token.split(".");
    return Number(expires) > Date.now() && safeEqual(signature, sign(config.sessionSecret, expires));
  }

  /** Wrong passwords from this address in the last minute. (Signing in correctly doesn't count.) */
  function recentFailures(ip: string): number[] {
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter((t) => now - t < 60_000);
    attempts.set(ip, recent);
    return recent;
  }

  function login(request: FastifyRequest, reply: FastifyReply, password: unknown): void {
    const failures = recentFailures(request.ip);
    if (failures.length >= MAX_ATTEMPTS_PER_MINUTE) throw new TooManyAttempts("Too many attempts. Wait a minute and try again.");
    if (typeof password !== "string" || !safeEqual(password, config.password)) {
      failures.push(Date.now());
      throw new WrongPassword("That password isn't right.");
    }
    const expires = String(Date.now() + SESSION_DAYS * 86_400_000);
    const cookie = [`${SESSION_COOKIE}=${expires}.${sign(config.sessionSecret, expires)}`, "Path=/", "HttpOnly", "SameSite=Lax",
      `Max-Age=${SESSION_DAYS * 86_400}`, config.secureCookies ? "Secure" : ""].filter(Boolean).join("; ");
    reply.header("set-cookie", cookie);
  }

  function logout(reply: FastifyReply): void {
    reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  return { isAuthenticated, login, logout };
}

export type Auth = ReturnType<typeof createAuth>;
