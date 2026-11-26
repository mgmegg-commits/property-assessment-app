/** Calls to the follow-up API. Shapes match apps/server/src/followup.ts. */

export type Status = "open" | "in_progress" | "done" | "deferred" | "withdrawn";

export interface Update {
  id?: string;
  at: string;
  by: string;
  via?: "report" | "office" | "link";
  text: string;
  photoId: string | null;
}

export interface Item {
  id: string;
  reportId: string;
  property: string;
  revision: number;
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
  assessmentDate: string;
  facilityContact: string;
  status: Status;
  facility: string;
  assignee: string;
  dueDate: string | null;
  overdue: boolean;
  lastUpdate: Update | null;
}

export interface Link {
  id: string;
  property: string;
  personName: string;
  role: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  url: string;
}

export interface Property {
  name: string;
  reportDate: string;
  issuedAt: string | null;
  revision: number;
}

export interface FollowUp {
  today: string;
  company: string;
  preparedBy: string;
  properties: Property[];
  items: Item[];
  links: Link[];
}

export interface LinkItem {
  id: string;
  number: string;
  title: string;
  location: string;
  section: string;
  subsection: string;
  recommendation: string;
  description: string;
  priority: string;
  priorityLabel: string;
  status: Status;
  dueDate: string | null;
  overdue: boolean;
  photoIds: string[];
  assessmentDate: string;
  history: Update[];
}

export interface LinkPage {
  person: { name: string; role: string };
  property: string;
  company: string;
  today: string;
  items: LinkItem[];
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown> = {}) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown, contentType = "application/json"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": contentType },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error || `Something went wrong (${response.status}).`, data as Record<string, unknown>);
  return data as T;
}

export const getFollowUp = () => call<FollowUp>("GET", "/api/follow-up");
export const getHistory = (itemId: string) => call<Update[]>("GET", `/api/follow-up/items/${itemId}/history`);
export const saveItem = (itemId: string, changes: { by: string; status?: Status; facility?: string; assignee?: string; dueDate?: string | null; note?: string }) =>
  call<Item>("PATCH", `/api/follow-up/items/${itemId}`, changes);
export const createLink = (link: { property: string; personName: string; role: string; by: string }) => call<Link>("POST", "/api/follow-up/links", link);
export const setLinkActive = (linkId: string, active: boolean) => call<Link>("PATCH", `/api/follow-up/links/${linkId}`, { active });
export const exportUrl = (property: string) => `/api/follow-up/export.xlsx?property=${encodeURIComponent(property)}`;

export const getLinkPage = (token: string) => call<LinkPage>("GET", `/api/link/${encodeURIComponent(token)}`);
export const sendLinkUpdate = (token: string, itemId: string, update: { status?: "in_progress" | "done"; note?: string; photoId?: string }) =>
  call<{ ok: true }>("POST", `/api/link/${encodeURIComponent(token)}/items/${itemId}`, update);
export const uploadLinkPhoto = (token: string, photo: Blob) =>
  call<{ id: string }>("POST", `/api/link/${encodeURIComponent(token)}/photos`, photo, photo.type || "image/jpeg");
export const linkFileUrl = (token: string, fileId: string) => `/api/link/${encodeURIComponent(token)}/files/${fileId}`;
