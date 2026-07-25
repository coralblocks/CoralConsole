"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AuditEntry } from "@/lib/types";

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
  const [outcome, setOutcome] = useState<"all" | "success" | "failure">("all");
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

  async function clearHistory() {
    if (!window.confirm("Permanently clear the admin action audit history for this installation?")) return;
    try {
      await apiRequest<{ removed: number }>("/api/audit", { method: "DELETE" });
      await loadAudit();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Audit history could not be cleared.");
    }
  }

  return (
    <main className="console-shell audit-page">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CoralConsole topology"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span><strong>CoralConsole</strong><small>Admin action audit</small></span></Link>
        <Link className="button button-ghost detail-back" href="/">← Back to topology</Link>
      </header>
      <section className="audit-main">
        <div className="audit-title"><div><p className="eyebrow">Shared operations record</p><h1>Admin action audit</h1><p>Inputs, outputs, outcomes, and timing for admin actions run through this CoralConsole installation.</p></div><button className="remove-button standalone" type="button" onClick={() => void clearHistory()} disabled={!entries.length}>Clear audit history</button></div>

        <form className="audit-controls" onSubmit={search}>
          <label htmlFor="audit-search">Search audit history</label>
          <div><input id="audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Actor, endpoint, action, or output" /><button className="button button-dark" type="submit">Search</button></div>
          <div className="filters" aria-label="Filter audit outcome">{(["all", "success", "failure"] as const).map((value) => <button key={value} type="button" className={outcome === value ? "active" : ""} onClick={() => setOutcome(value)}>{value}</button>)}</div>
          {actorId && <button className="actor-scope" type="button" onClick={() => setActorId("")}>Actor filter active ×</button>}
        </form>

        {error && <p className="page-alert" role="alert">{error}</p>}
        <section className="audit-table-wrap" aria-live="polite">
          {loading ? <p className="empty-audit">Loading audit history…</p> : !entries.length ? <p className="empty-audit">No admin actions match these filters.</p> : (
            <table className="audit-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Admin action</th><th>Parameters</th><th>Outcome</th><th>Duration</th><th>Output</th></tr></thead>
              <tbody>{entries.map((entry) => <tr key={entry.id}>
                <td><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></td>
                <td><strong>{entry.actorName}</strong><small>{entry.actorEndpoint}</small></td>
                <td><code>{entry.action}</code></td>
                <td><code>{entry.params || "—"}</code></td>
                <td><span className={`audit-outcome ${entry.success ? "success" : "failure"}`}>{entry.success ? "Success" : "Failed"}</span></td>
                <td>{entry.durationMs} ms</td>
                <td><pre>{auditOutput(entry)}{entry.truncated ? "\n[truncated]" : ""}</pre></td>
              </tr>)}</tbody>
            </table>
          )}
        </section>
      </section>
    </main>
  );
}
