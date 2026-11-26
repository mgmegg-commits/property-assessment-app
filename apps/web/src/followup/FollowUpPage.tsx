/**
 * The Follow-up page (signed in): one property's action items, with counts,
 * filters, overdue flags, editing on the client's behalf, personal update
 * links and the Excel export. Layout and wording follow docs/prototype.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, createLink, exportUrl, getFollowUp, getHistory, saveItem, setLinkActive,
  type FollowUp, type Item, type Link, type Status, type Update,
} from "./api.js";
import { STATUS_LABELS, companyShort, initials, usDate, usDay, where } from "./format.js";

type Filter = "all" | Status | "overdue";
const NAME_KEY = "crb.followUpName";
const OFFICE_STATUSES: Status[] = ["open", "in_progress", "done", "deferred"];

const readName = (): string => {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
};
const writeName = (name: string) => {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private window: asked again next time */ }
};

function propertyFromUrl(): string {
  return new URLSearchParams(location.search).get("property") || "";
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityPill({ code, label }: { code: string; label: string }) {
  if (!label) return <span className="muted">—</span>;
  const urgent = code === "H" || code === "REQ";
  return <span className={`pill ${urgent ? "pill-urgent" : "pill-soon"}`}>{label}</span>;
}

export function Brand({ company }: { company: string }) {
  return (
    <>
      <span className="mark" aria-hidden="true">{initials(company || "Cecil Ingram Properties")}</span>
      <span className="brand">Cecil's Report Builder</span>
    </>
  );
}

export function FollowUpPage() {
  const [data, setData] = useState<FollowUp | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [property, setProperty] = useState(propertyFromUrl);
  const [filter, setFilter] = useState<Filter>("all");
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [name, setName] = useState(readName);

  const load = useCallback(() => getFollowUp().then(
    (next) => {
      setData(next);
      setError(null);
      if (!readName() && next.preparedBy) setName(next.preparedBy);
    },
    (e: unknown) => setError({ status: e instanceof ApiError ? e.status : 0, message: (e as Error).message }),
  ), []);
  useEffect(() => { void load(); }, [load]);

  const properties = useMemo(() => {
    if (!data) return [];
    return data.properties.filter((p) => data.items.some((i) => i.property === p.name));
  }, [data]);
  const chosen = properties.find((p) => p.name === property) ?? properties[0];
  useEffect(() => {
    if (!chosen) return;
    const url = new URL(location.href);
    url.searchParams.set("property", chosen.name);
    history.replaceState(null, "", url);
  }, [chosen]);

  const items = useMemo(() => (data && chosen ? data.items.filter((i) => i.property === chosen.name) : []), [data, chosen]);
  const counts = useMemo(() => {
    const c = { all: items.length, open: 0, in_progress: 0, done: 0, deferred: 0, withdrawn: 0, overdue: 0 };
    for (const item of items) {
      c[item.status]++;
      if (item.overdue) c.overdue++;
    }
    return c;
  }, [items]);
  const shown = items.filter((i) => filter === "all" || (filter === "overdue" ? i.overdue : i.status === filter));
  const links = data && chosen ? data.links.filter((l) => l.property === chosen.name) : [];
  const actionCount = items.filter((i) => i.status !== "withdrawn").length;

  const replaceItem = (item: Item) => setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === item.id ? item : i)) } : d));
  const replaceLink = (link: Link) => setData((d) => (d ? { ...d, links: d.links.some((l) => l.id === link.id) ? d.links.map((l) => (l.id === link.id ? link : l)) : [...d.links, link] } : d));

  const filters: [Filter, string][] = [["all", "All"], ["open", "Open"], ["in_progress", "In progress"], ["done", "Done"], ["overdue", "Overdue"]];
  if (counts.deferred) filters.push(["deferred", "Deferred"]);
  if (counts.withdrawn) filters.push(["withdrawn", "Withdrawn"]);

  return (
    <div className="fu">
      <header className="fu-top">
        <div className="fu-wrap fu-top-row">
          <Brand company={data?.company ?? ""} />
          <nav aria-label="Main" className="fu-nav">
            <a href="/">Reports</a>
            <a href="/follow-up" aria-current="page">Follow-up</a>
          </nav>
        </div>
      </header>

      <main className="fu-wrap fu-main">
        {error?.status === 401 && (
          <section className="fu-card fu-empty">
            <h1>Sign in first</h1>
            <p className="muted">Follow-up uses the same password as the reports.</p>
            <a className="fu-btn fu-btn-primary" href="/">Go to sign-in</a>
          </section>
        )}
        {error && error.status !== 401 && (
          <section className="fu-card fu-empty" role="alert">
            <h1>Follow-up couldn't load</h1>
            <p className="muted">{error.message}</p>
            <button type="button" className="fu-btn" onClick={() => void load()}>Try again</button>
          </section>
        )}
        {!data && !error && <p className="muted">Loading…</p>}

        {data && !chosen && (
          <section className="fu-card fu-empty">
            <h1>Follow-up</h1>
            <p className="muted">No issued reports yet. When a report is issued, each of its action items appears here, ready to assign and track.</p>
            <a className="fu-btn" href="/">Go to Reports</a>
          </section>
        )}

        {data && chosen && (
          <>
            <NameBar key={name} name={name} onChange={(n) => { setName(n); writeName(n); }} />

            {properties.length > 1 && (
              <div role="group" aria-label="Property" className="fu-chips">
                {properties.map((p) => (
                  <button key={p.name} type="button" className="fu-chip" aria-pressed={p.name === chosen.name}
                    onClick={() => { setProperty(p.name); setFilter("all"); setOpenItem(null); }}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            <div className="fu-head">
              <div className="fu-head-text">
                <h1>Follow-up</h1>
                <p className="muted">
                  {chosen.name} · report issued {chosen.issuedAt ? usDay(chosen.issuedAt) : usDate(chosen.reportDate, "")}{chosen.revision ? ` (revision ${chosen.revision})` : ""} · {actionCount} action item{actionCount === 1 ? "" : "s"}
                </p>
              </div>
              <a className="fu-btn" href={exportUrl(chosen.name)} download>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
                Export to Excel
              </a>
            </div>

            <div className="fu-counts">
              <div className="fu-count"><b>{counts.open}</b><span>Open</span></div>
              <div className="fu-count"><b className="c-progress">{counts.in_progress}</b><span>In progress</span></div>
              <div className="fu-count"><b className="c-done">{counts.done}</b><span>Done</span></div>
              <div className="fu-count fu-count-overdue"><b>{counts.overdue}</b><span>Overdue</span></div>
            </div>

            <div role="group" aria-label="Show" className="fu-chips">
              {filters.map(([key, label]) => (
                <button key={key} type="button" className="fu-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label} · {key === "all" ? counts.all : counts[key]}
                </button>
              ))}
            </div>

            <div className="fu-table" role="table" aria-label="Action items">
              <div className="fu-tr fu-th" role="row">
                <span role="columnheader">No.</span><span role="columnheader">Action item</span><span role="columnheader">Priority</span>
                <span role="columnheader">Assigned to</span><span role="columnheader">Due</span><span role="columnheader">Status</span><span role="columnheader">Last update</span>
              </div>
              {shown.map((item) => (
                <ItemRow key={item.id} item={item} open={openItem === item.id} by={name}
                  onToggle={() => setOpenItem(openItem === item.id ? null : item.id)}
                  onSaved={(saved) => { replaceItem(saved); setOpenItem(null); }} />
              ))}
              {!shown.length && <p className="fu-none">No items in this view.</p>}
            </div>

            <LinksPanel property={chosen.name} links={links} by={name} onChange={replaceLink} />
          </>
        )}
      </main>
    </div>
  );
}

function NameBar({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(!readName());
  const [draft, setDraft] = useState(name);
  if (!editing) {
    return (
      <p className="fu-name muted">
        Changes are recorded as <b>{name}</b> · <button type="button" className="fu-link" onClick={() => setEditing(true)}>Change</button>
      </p>
    );
  }
  return (
    <form className="fu-name fu-card" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onChange(draft.trim()); setEditing(false); } }}>
      <label htmlFor="fuName">Your name, so every change shows who made it</label>
      <div className="fu-row">
        <input id="fuName" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="name" />
        <button type="submit" className="fu-btn fu-btn-primary" disabled={!draft.trim()}>Save</button>
      </div>
    </form>
  );
}

function ItemRow({ item, open, by, onToggle, onSaved }: { item: Item; open: boolean; by: string; onToggle: () => void; onSaved: (item: Item) => void }) {
  return (
    <div className={`fu-item${open ? " is-open" : ""}`} role="rowgroup">
      <button type="button" className="fu-tr fu-row-btn" role="row" aria-expanded={open} onClick={onToggle}>
        <span className="fu-no" role="cell">{item.number}</span>
        <span className="fu-title" role="cell"><b>{item.title}</b><span className="muted small">{where(item)}</span></span>
        <span role="cell"><PriorityPill code={item.priority} label={item.priorityLabel} /></span>
        <span role="cell" className="fu-assignee"><span className="fu-assignee-name">{item.assignee || "TBD"}</span>{item.facility && <span className="muted small">{item.facility}</span>}</span>
        <span role="cell" className="fu-due"><span className="fu-due-date">{usDate(item.dueDate)}</span>{item.overdue && <span className="fu-overdue">Overdue</span>}</span>
        <span role="cell"><StatusPill status={item.status} /></span>
        <span role="cell" className="muted small">{item.lastUpdate ? `${item.lastUpdate.by} · ${usDay(item.lastUpdate.at)}` : ""}</span>
      </button>
      {open && <ItemEditor item={item} by={by} onSaved={onSaved} />}
    </div>
  );
}

function ItemEditor({ item, by, onSaved }: { item: Item; by: string; onSaved: (item: Item) => void }) {
  const [facility, setFacility] = useState(item.facility);
  const [assignee, setAssignee] = useState(item.assignee);
  const [due, setDue] = useState(item.dueDate ?? "");
  const [status, setStatus] = useState<Status>(item.status);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<Update[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { getHistory(item.id).then(setHistory).catch(() => setHistory([])); }, [item.id]);

  const changed = facility.trim() !== item.facility || assignee.trim() !== item.assignee || (due || null) !== item.dueDate || status !== item.status || Boolean(note.trim());
  const withdrawn = item.status === "withdrawn";

  async function save() {
    if (!by) { setMessage("Add your name above first, so the change shows who made it."); return; }
    setSaving(true);
    setMessage("");
    try {
      onSaved(await saveItem(item.id, { by, facility, assignee, dueDate: due || null, status, note }));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fu-editor">
      <div className="fu-editor-text">
        {item.recommendation && <p>{item.recommendation}</p>}
        {item.description && item.description !== item.recommendation && <p className="muted small">{item.description}</p>}
        {item.photoIds.length > 0 && (
          <div className="fu-photos">{item.photoIds.slice(0, 4).map((id) => <img key={id} src={`/files/${id}`} alt="Photo from the visit" loading="lazy" />)}</div>
        )}
      </div>
      {withdrawn ? (
        <p className="muted">Withdrawn: this finding isn't in the latest revision of the report.</p>
      ) : (
        <form className="fu-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="fu-fields">
            <label>Facility<input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="e.g. Cottage 1" /></label>
            <label>Assigned to<input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="TBD" /></label>
            <label>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </div>
          <div role="group" aria-label="Status" className="fu-status-buttons">
            {OFFICE_STATUSES.map((s) => (
              <button key={s} type="button" className="fu-big" aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS_LABELS[s]}</button>
            ))}
          </div>
          <label>Note (optional)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was agreed, or what's still needed" /></label>
          {message && <p className="fu-error" role="alert">{message}</p>}
          <div className="fu-row">
            <button type="submit" className="fu-btn fu-btn-primary" disabled={!changed || saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}
      <div className="fu-history">
        <b>Updates</b>
        {history === null ? <p className="muted small">Loading…</p> : history.slice().reverse().map((h, i) => (
          <div key={h.id ?? i} className="fu-update"><span className="muted small">{h.by} · {usDay(h.at)}</span><span>{h.text}</span></div>
        ))}
      </div>
    </div>
  );
}

function LinksPanel({ property, links, by, onChange }: { property: string; links: Link[]; by: string; onChange: (link: Link) => void }) {
  const [adding, setAdding] = useState(false);
  const [personName, setPersonName] = useState("");
  const [role, setRole] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function copy(link: Link) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.id);
      setTimeout(() => setCopied((c) => (c === link.id ? null : c)), 1500);
    } catch {
      window.prompt("Copy this link:", link.url);
    }
  }

  async function add() {
    setMessage("");
    try {
      const link = await createLink({ property, personName, role, by });
      onChange(link);
      setAdding(false);
      setPersonName("");
      setRole("");
      await copy(link);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <section className="fu-card fu-links" aria-labelledby="linksTitle">
      <div className="fu-links-head">
        <div>
          <h2 id="linksTitle">Update links</h2>
          <p className="muted small">Each person gets their own link. They see only this property's items, and every update shows their name and the time.</p>
        </div>
        {!adding && <button type="button" className="fu-btn fu-btn-dashed" onClick={() => setAdding(true)}>+ New link</button>}
      </div>
      {adding && (
        <form className="fu-link-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label>Name<input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="e.g. Alex Rivera" autoFocus /></label>
          <label>Role (optional)<input value={role} onChange={(e) => setRole(e.target.value)} placeholder={`e.g. Maintenance lead, ${property}`} /></label>
          {message && <p className="fu-error" role="alert">{message}</p>}
          <div className="fu-row">
            <button type="submit" className="fu-btn fu-btn-primary" disabled={!personName.trim()}>Make link and copy it</button>
            <button type="button" className="fu-btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
      {links.map((link) => (
        <div key={link.id} className="fu-linkrow">
          <div className="fu-link-who"><b>{link.personName}</b>{link.role && <span className="muted"> · {link.role}</span>}</div>
          <span className={`pill ${link.active ? "pill-done" : "pill-off"}`}>{link.active ? "Active" : "Turned off"}</span>
          <button type="button" className="fu-btn" onClick={() => void copy(link)} disabled={!link.active}>{copied === link.id ? "Copied" : "Copy link"}</button>
          <button type="button" className="fu-btn fu-btn-danger" onClick={async () => onChange(await setLinkActive(link.id, !link.active))}>{link.active ? "Turn off" : "Turn on"}</button>
        </div>
      ))}
      {!links.length && !adding && <p className="muted small">No links yet for {companyShort(property)}.</p>}
    </section>
  );
}
