/**
 * The phone page a personal update link opens (/u/<token>): that property's
 * open items, one tap each for In progress and Done, a note and a photo.
 * No sign-in: the link is the access. Layout and wording follow docs/prototype.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, getLinkPage, linkFileUrl, sendLinkUpdate, uploadLinkPhoto, type LinkItem, type LinkPage as Page } from "./api.js";
import { companyShort, dueText, initials, usDay, where } from "./format.js";
import { PriorityPill, StatusPill } from "./FollowUpPage.js";

type State =
  | { kind: "loading" }
  | { kind: "ready"; page: Page }
  | { kind: "off"; company: string }
  | { kind: "broken"; message: string };

/** Shrinks a photo on the phone before it's sent: a JPEG at most 1600 px on its long side. */
async function shrink(file: File): Promise<Blob> {
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob) return blob;
  } catch { /* fall back to the file as it is */ }
  return file;
}

export function LinkPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => getLinkPage(token).then(
    (page) => setState({ kind: "ready", page }),
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 410) setState({ kind: "off", company: String(e.body.company || "") });
      else setState({ kind: "broken", message: (e as Error).message });
    },
  ), [token]);
  useEffect(() => { void load(); }, [load]);

  const company = state.kind === "ready" ? state.page.company : state.kind === "off" ? state.company : "";
  const item = state.kind === "ready" ? state.page.items.find((i) => i.id === selected) : undefined;

  return (
    <div className="ph">
      <header className="ph-top">
        <span className="mark" aria-hidden="true">{initials(company || "Cecil Ingram Properties")}</span>
        <span className="ph-company">{companyShort(company) || "Cecil's Report Builder"}</span>
      </header>
      <main className="ph-main">
        {state.kind === "loading" && <p className="muted">Loading…</p>}
        {state.kind === "off" && (
          <div className="ph-card ph-message">
            <h2>This link has been turned off</h2>
            <p className="muted">Ask {companyShort(company) || "the person who sent it"} for a new link if you still need to send updates.</p>
          </div>
        )}
        {state.kind === "broken" && (
          <div className="ph-card ph-message">
            <h2>This link doesn't work</h2>
            <p className="muted">Check that the whole link was copied, or ask for a new one.</p>
          </div>
        )}
        {state.kind === "ready" && !item && (
          <ItemList page={state.page} saved={saved} onOpen={(id) => { setSelected(id); setSaved(false); window.scrollTo(0, 0); }} />
        )}
        {state.kind === "ready" && item && (
          <ItemDetail token={token} item={item} onBack={() => setSelected(null)}
            onSaved={async () => { setSelected(null); setSaved(true); await load(); window.scrollTo(0, 0); }} />
        )}
      </main>
    </div>
  );
}

const ORDER: Record<string, number> = { open: 0, in_progress: 1 };

function ItemList({ page, saved, onOpen }: { page: Page; saved: boolean; onOpen: (id: string) => void }) {
  const first = page.person.name.split(/\s+/)[0];
  const items = page.items.slice().sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  return (
    <>
      <div className="ph-hello">
        <span className="muted small">{page.property}</span>
        <h1>Hi {first}</h1>
        <span className="muted">{items.length ? `${items.length} item${items.length === 1 ? "" : "s"} still need${items.length === 1 ? "s" : ""} an update` : "Nothing needs an update right now. Thank you!"}</span>
      </div>
      {saved && <p role="status" className="ph-saved">Thanks, your update was saved.</p>}
      {items.map((item) => (
        <button key={item.id} type="button" className="ph-card ph-item" onClick={() => onOpen(item.id)}>
          <span className="ph-item-title">{item.title}</span>
          <span className="muted small">{where(item)}</span>
          <span className="ph-tags"><StatusPill status={item.status} /><span className={item.overdue ? "ph-overdue" : "muted small"}>{dueText(item)}</span></span>
        </button>
      ))}
    </>
  );
}

function ItemDetail({ token, item, onBack, onSaved }: { token: string; item: LinkItem; onBack: () => void; onSaved: () => Promise<void> }) {
  const [pick, setPick] = useState<"in_progress" | "done" | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const cantSave = !pick && !note.trim() && !photo;

  async function save() {
    if (cantSave) return;
    setSaving(true);
    setMessage("");
    try {
      const photoId = photo ? (await uploadLinkPhoto(token, await shrink(photo))).id : undefined;
      await sendLinkUpdate(token, item.id, { ...(pick ? { status: pick } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(photoId ? { photoId } : {}) });
      await onSaved();
    } catch (e) {
      setMessage(`${(e as Error).message} Your update wasn't saved; try again.`);
      setSaving(false);
    }
  }

  return (
    <div className="ph-detail">
      <button type="button" className="ph-back" onClick={onBack}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        All items
      </button>
      <div className="ph-detail-head">
        <h2>{item.title}</h2>
        <span className="muted">{where(item)}</span>
        <span className="ph-tags"><PriorityPill code={item.priority} label={item.priorityLabel} /><StatusPill status={item.status} /><span className={item.overdue ? "ph-overdue" : "muted small"}>{dueText(item)}</span></span>
      </div>
      {item.photoIds[0] && <img className="ph-photo" src={linkFileUrl(token, item.photoIds[0])} alt={`Photo from the ${item.assessmentDate ? usDay(`${item.assessmentDate}T12:00:00`) : ""} visit`} />}
      {item.recommendation && <p>{item.recommendation}</p>}

      <form className="ph-card ph-update" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <span className="ph-update-title">Your update</span>
        <div className="ph-two">
          <button type="button" className="fu-big" aria-pressed={pick === "in_progress"} onClick={() => setPick(pick === "in_progress" ? null : "in_progress")}>In progress</button>
          <button type="button" className="fu-big" aria-pressed={pick === "done"} onClick={() => setPick(pick === "done" ? null : "done")}>Done</button>
        </div>
        <label htmlFor="note" className="ph-label">Note (optional)</label>
        <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, or what's still needed" />
        <label className="ph-photo-button">
          {photo ? "1 photo attached · tap to change" : "Add a photo"}
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        {photo && <button type="button" className="fu-link" onClick={() => setPhoto(null)}>Remove the photo</button>}
        {message && <p className="fu-error" role="alert">{message}</p>}
        <button type="submit" className="ph-save" disabled={cantSave || saving}>{saving ? "Saving…" : "Save update"}</button>
      </form>

      <div className="ph-history">
        <span className="ph-update-title">Updates</span>
        {item.history.slice().reverse().map((h, i) => (
          <div key={i} className="ph-card ph-update-entry">
            <span className="muted small">{h.by} · {usDay(h.at)}</span>
            <span>{h.text}</span>
            {h.photoId && <img src={linkFileUrl(token, h.photoId)} alt="Photo sent with this update" loading="lazy" />}
          </div>
        ))}
      </div>
    </div>
  );
}
