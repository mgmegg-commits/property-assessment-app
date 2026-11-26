/**
 * The start page. For now it shows whether the app and its database are
 * working and, in a test copy, the test data that was loaded. Sign-in and
 * the assessment screens replace it from step 2.3 on.
 */
import { useEffect, useState } from "react";
import { APP_NAME, organizationTypeLabel } from "@crb/core";
import { getDevSummary, getHealth, type DevSummary, type Health } from "./api.js";

type Loaded<T> = { state: "loading" } | { state: "done"; value: T } | { state: "failed" };

function StatusRow({ label, ok, okText, badText }: { label: string; ok: boolean | null; okText: string; badText: string }) {
  const state = ok === null ? "wait" : ok ? "ok" : "bad";
  return (
    <li className="status-row" data-state={state}>
      <span className="dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
      <span className="status-value">{ok === null ? "Checking…" : ok ? okText : badText}</span>
    </li>
  );
}

export function App() {
  const [health, setHealth] = useState<Loaded<Health>>({ state: "loading" });
  const [summary, setSummary] = useState<DevSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((value) => setHealth({ state: "done", value }))
      .catch(() => {
        if (!controller.signal.aborted) setHealth({ state: "failed" });
      });
    getDevSummary(controller.signal)
      .then(setSummary)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const appOk = health.state === "loading" ? null : health.state === "done";
  const databaseOk = health.state === "loading" ? null : health.state === "done" && health.value.database === "ok";
  const version = health.state === "done" ? health.value.version : null;

  return (
    <>
      <header className="top">
        <div className="wrap top-row">
          <span className="brand">{APP_NAME}</span>
          {summary && <span className="badge">Test copy</span>}
        </div>
      </header>
      <main className="wrap page">
        <section className="card" aria-labelledby="status-title">
          <p className="eyebrow">{version ? `Version ${version}` : "Version …"}</p>
          <h1 id="status-title">Status</h1>
          <ul className="status-list">
            <StatusRow label="App" ok={appOk} okText="Working" badText="Not answering" />
            <StatusRow label="Database" ok={databaseOk} okText="Connected" badText="Can't be reached" />
            {summary && <StatusRow label="Test data" ok okText={`${summary.organizations.length} organizations loaded`} badText="" />}
          </ul>
        </section>

        {summary && (
          <section className="card" aria-labelledby="orgs-title">
            <h2 id="orgs-title">Test organizations</h2>
            <ul className="org-list">
              {summary.organizations.map((org) => (
                <li key={org.name}>
                  <span className="org-name">{org.name}</span>
                  <span className="org-type">{organizationTypeLabel(org.type)}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">This copy runs on this computer and holds test data only, never real reports.</p>
          </section>
        )}
      </main>
    </>
  );
}
