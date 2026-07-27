"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, ShieldCheck, X } from "lucide-react";
import { ACTOR_META, auditOutcomeLabel } from "@/app/actor-ui";
import { AUDIT_OUTCOMES, type AuditEntry, type AuditOutcome } from "@/lib/types";

const BrandIcon = ACTOR_META.sequencer.icon;

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

function auditOutput(entry: AuditEntry) {
  return [entry.error, entry.output].filter(Boolean).join("\n\n") || "No output";
}

export default function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [outcome, setOutcome] = useState<"all" | AuditOutcome>("all");
  const [actorId, setActorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const hydration = window.setTimeout(() => {
      setActorId(new URLSearchParams(window.location.search).get("actorId") || "");
    }, 0);
    return () => window.clearTimeout(hydration);
  }, []);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "250" });
    if (actorId) params.set("actorId", actorId);
    if (appliedQuery) params.set("query", appliedQuery);
    if (outcome !== "all") params.set("outcome", outcome);
    try {
      const payload = await apiRequest<{ entries: AuditEntry[] }>(`/api/audit?${params}`, { cache: "no-store" });
      setEntries(payload.entries);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Audit history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [actorId, appliedQuery, outcome]);

  useEffect(() => {
    const refresh = window.setTimeout(() => void loadAudit(), 0);
    return () => window.clearTimeout(refresh);
  }, [loadAudit]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  function showAll() {
    setQuery("");
    setAppliedQuery("");
    setOutcome("all");
    setActorId("");
  }

  const hasActiveFilter = Boolean(query || appliedQuery || actorId || outcome !== "all");

  return (
    <main className="console-shell audit-page">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CoralConsole topology">
          <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
          <span><strong>CoralConsole</strong><small>Admin action audit</small></span>
        </Link>
      </header>

      <section className="audit-main">
        <div className="audit-title">
          <div>
            <p className="eyebrow">Shared operations record</p>
            <h1>Admin action audit</h1>
            <p>Review who requested each manual admin action, what CoralConsole sent, and how the actor responded.</p>
          </div>
          <div className="audit-integrity-note">
            <ShieldCheck aria-hidden="true" />
            <span><strong>Protected history</strong><small>Audit records cannot be manually cleared.</small></span>
          </div>
        </div>

        <form className="audit-controls" onSubmit={search}>
          <label htmlFor="audit-search">Search audit history</label>
          <div className="audit-search-row">
            <span className="audit-search-field">
              <Search aria-hidden="true" />
              <input id="audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Actor, endpoint, requester IP, action, or output" />
            </span>
            <button className="button button-dark" type="submit">Search</button>
            <button className="button button-ghost audit-reset" type="button" onClick={showAll} disabled={!hasActiveFilter}><X aria-hidden="true" />Clear &amp; show all</button>
          </div>
          <div className="audit-filter-row">
            <span>Outcome</span>
            <div className="filters audit-filters" aria-label="Filter audit outcome">
              {(["all", ...AUDIT_OUTCOMES] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={outcome === value ? "active" : ""}
                  aria-pressed={outcome === value}
                  onClick={() => setOutcome(value)}
                >
                  {value === "all" ? "All outcomes" : auditOutcomeLabel(value)}
                </button>
              ))}
            </div>
            {actorId && <button className="actor-scope" type="button" onClick={() => setActorId("")}>Actor scope active ×</button>}
          </div>
        </form>

        {error && <p className="page-alert audit-alert" role="alert">{error}</p>}
        <section className="audit-table-wrap" aria-live="polite" aria-labelledby="audit-records-title">
          <div className="audit-table-heading">
            <div><p className="eyebrow">Recorded activity</p><h2 id="audit-records-title">{loading ? "Loading records…" : `${entries.length} ${entries.length === 1 ? "record" : "records"} shown`}</h2></div>
            <span>Newest first · Loaded on demand</span>
          </div>
          {loading ? <p className="empty-audit">Loading audit history…</p> : !entries.length ? <p className="empty-audit">No admin actions match these filters.</p> : (
            <table className="audit-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Requester IP</th><th>Admin action</th><th>Parameters</th><th>Outcome</th><th>Duration</th><th>Output</th></tr></thead>
              <tbody>{entries.map((entry) => <tr key={entry.id}>
                <td data-label="Time"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></td>
                <td data-label="Actor"><strong>{entry.actorName}</strong><small>{entry.actorEndpoint}</small></td>
                <td data-label="Requester IP"><code className="audit-source-ip">{entry.sourceIp || "N/A"}</code></td>
                <td data-label="Admin action"><code>{entry.action}</code></td>
                <td data-label="Parameters"><code>{entry.params || "—"}</code></td>
                <td data-label="Outcome"><span className={`audit-outcome ${entry.outcome}`}>{auditOutcomeLabel(entry.outcome)}</span></td>
                <td data-label="Duration">{entry.durationMs} ms</td>
                <td data-label="Output"><pre>{auditOutput(entry)}{entry.truncated ? "\n[truncated]" : ""}</pre></td>
              </tr>)}</tbody>
            </table>
          )}
        </section>
      </section>
    </main>
  );
}
