/** Dates are stored as "YYYY-MM-DD" strings and shown in US formats (FR-OUT-5). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

export function parseIsoDate(iso) {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return year ? new Date(year, month - 1, day) : null;
}

export function isoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export const todayIso = () => isoDate(new Date());

export function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** "Nov 3, 2026" */
export function formatDateLong(iso) {
  const d = parseIsoDate(iso);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : "";
}

/** "11/03/2026" */
export function formatDateShort(iso) {
  const d = parseIsoDate(iso);
  return d ? `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}` : "";
}

/** "14:05" -> "2:05 PM" */
export function formatTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${pad2(m)} ${h < 12 ? "AM" : "PM"}`;
}

const timeOf = (d) => formatTime(`${d.getHours()}:${d.getMinutes()}`);

/** Epoch ms -> "Nov 3, 2026 2:05 PM" */
export function formatTimestamp(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${formatDateLong(isoDate(d))} ${timeOf(d)}`;
}

/** Epoch ms -> "Nov 3 · 2:05 PM" */
export function formatClock(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${timeOf(d)}`;
}

export const plural = (n, word, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

export function truncate(text, max) {
  const s = String(text || "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const bytesToMb = (bytes) => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0);


/** Epoch ms -> "9:02:11 AM" */
export function formatTimeOfDay(ms) {
  const d = new Date(ms);
  return `${((d.getHours() + 11) % 12) + 1}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** Epoch ms <-> the value of an <input type="datetime-local" step="1">, in local time. */
export function toLocalInputValue(ms) {
  const d = new Date(ms);
  return `${isoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
export function fromLocalInputValue(value) {
  const ms = new Date(value).getTime(); // a value without a time zone is read as local time
  return Number.isNaN(ms) ? null : ms;
}

/** Milliseconds -> "3:41" (or "1:02:05" past an hour), for times within a recording. */
export function formatOffset(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
