/**
 * Dates are stored as "YYYY-MM-DD" strings and shown in US formats (FR-OUT-5).
 * Ported from v1 src/js/util/format.js: the helpers the report model uses.
 * The display-only helpers (times of day, file sizes, recording offsets) come
 * across with the screens that use them.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number): string => String(n).padStart(2, "0");

export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return year ? new Date(year, (month ?? 1) - 1, day ?? 1) : null;
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export const todayIso = (): string => isoDate(new Date());

/** "Nov 3, 2026" */
export function formatDateLong(iso: string | null | undefined): string {
  const d = parseIsoDate(iso);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : "";
}

/** "11/03/2026" */
export function formatDateShort(iso: string | null | undefined): string {
  const d = parseIsoDate(iso);
  return d ? `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}` : "";
}

export const plural = (n: number, word: string, pluralWord = `${word}s`): string => `${n} ${n === 1 ? word : pluralWord}`;
