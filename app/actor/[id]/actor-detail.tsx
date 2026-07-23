"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ACTOR_META, statusLabel, type Actor, type AdminReply } from "../../actor-ui";
import type { AuditEntry } from "@/lib/types";

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

export default function ActorDetail({ actorId }: { actorId: string }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const [command, setCommand] = useState("status");
  const [params, setParams] = useState("");
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<AdminReply | null>(null);

  const loadAudit = useCallback(async () => {
    const payload = await apiRequest<{ entries: AuditEntry[] }>(`/api/audit?actorId=${encodeURIComponent(actorId)}&limit=20`, { cache: "no-store" });
    setAudit(payload.entries);
  }, [actorId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actorId)}`, { cache: "no-store" }),
      apiRequest<{ entries: AuditEntry[] }>(`/api/audit?actorId=${encodeURIComponent(actorId)}&limit=20`, { cache: "no-store" }),
    ]).then(([actorPayload, auditPayload]) => {
      if (!active) return;
      setActor(actorPayload.actor);
      setCommand(actorPayload.actor.commands[0] || "list");
      setAudit(auditPayload.entries);
    }).catch((requestError) => {
      if (active) setError(requestError instanceof Error ? requestError.message : "Actor details could not be loaded.");
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, [actorId]);

  async function runCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actor) return;
    setRunning(true);
    setReply(null);
    try {
      const result = await apiRequest<AdminReply>(`/api/actors/${encodeURIComponent(actor.id)}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, params }),
      });
      setReply(result);
    } catch (requestError) {
      setReply({ result: false, error: requestError instanceof Error ? requestError.message : "Command failed." });
    } finally {
      setRunning(false);
      void loadAudit().catch(() => undefined);
    }
  }

  async function removeActor() {
    if (!actor || actor.demo || !window.confirm(`Remove ${actor.name} from the shared topology?`)) return;
    try {
      await apiRequest<{ removed: boolean }>(`/api/actors/${encodeURIComponent(actor.id)}`, { method: "DELETE" });
      setActor(null);
      setRemoved(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Actor could not be removed.");
    }
  }

  const Icon = actor ? ACTOR_META[actor.kind].icon : null;

  return (
    <main className="console-shell actor-detail-page">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CoralConsole topology">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>CoralConsole</strong><small>Actor detail</small></span>
        </Link>
        <div className="topbar-actions"><Link className="intro-toggle nav-link" href="/audit">Audit</Link><Link className="button button-ghost detail-back" href="/">← Back to topology</Link></div>
      </header>

      <section className="actor-detail-main" aria-live="polite">
        {!ready ? (
          <div className="actor-detail-empty"><p className="eyebrow">Actor detail</p><h1>Loading actor…</h1></div>
        ) : !actor ? (
          <div className="actor-detail-empty">
            <p className="eyebrow">Actor detail</p>
            <h1>{removed ? "Actor removed" : "Actor details unavailable"}</h1>
            <p>{removed ? "The actor was removed from the shared topology." : error || "This actor no longer exists in the shared topology."}</p>
            <Link className="button button-primary" href="/">Return to topology</Link>
          </div>
        ) : (
          <div className="actor-detail-layout">
            <section className={`inspector actor-detail-panel actor-${actor.kind}`} aria-label={`${actor.name} details`}>
              <div className="inspector-accent" />
              <div className="inspector-head">
                <span className="actor-avatar large" aria-hidden="true">{Icon && <Icon />}</span>
                <div><p>{ACTOR_META[actor.kind].label}{actor.sequencerRole ? ` · ${actor.sequencerRole}` : ""}</p><h1>{actor.name}</h1></div>
                <span className={`status-badge status-${actor.status}`}><i />{statusLabel(actor.status)}</span>
              </div>
              <dl className="detail-grid">
                <div><dt>REST endpoint</dt><dd>{actor.host}:{actor.port}</dd></div>
                <div><dt>Class</dt><dd>{actor.className}</dd></div>
                <div><dt>Account</dt><dd>{actor.account}</dd></div>
                <div><dt>Last response</dt><dd>{actor.lastSeen}</dd></div>
              </dl>
              <div className="admin-block">
                <div className="admin-heading"><div><p className="eyebrow">REST admin</p><h2>Run an action</h2></div><span>{actor.commands.length} available</span></div>
                <form onSubmit={runCommand}>
                  <label htmlFor="command">Admin command</label>
                  <div className="select-wrap"><select id="command" value={command} onChange={(event) => setCommand(event.target.value)}>{actor.commands.map((available) => <option value={available} key={available}>{available}</option>)}</select></div>
                  <label htmlFor="params">Parameters <span>optional</span></label><input id="params" value={params} onChange={(event) => setParams(event.target.value)} placeholder="e.g. 10 16" />
                  <button className="button button-dark" type="submit" disabled={running || actor.status === "offline" || !actor.commands.length}>{running ? "Running…" : "Run action"}<span aria-hidden="true">→</span></button>
                </form>
                {reply && <div className={`command-result ${reply.result ? "success" : "failure"}`} role="status"><div><strong>{reply.result ? "Command complete" : "Command failed"}</strong><span>{reply.adminCommand || command}</span></div><pre>{reply.error || reply.results || "No output returned."}</pre></div>}
              </div>
              {error && <p className="page-alert embedded" role="alert">{error}</p>}
              {actor.demo ? <p className="demo-note"><i /> Sample actor — actions are safely simulated.</p> : <button className="remove-button" type="button" onClick={() => void removeActor()}>Remove actor from shared topology</button>}
            </section>

            <section className="actor-audit-panel" aria-labelledby="actor-audit-title">
              <div className="section-heading"><div><p className="eyebrow">Command history</p><h2 id="actor-audit-title">Recent activity</h2></div><Link className="button button-ghost" href={`/audit?actorId=${encodeURIComponent(actor.id)}`}>Open full audit</Link></div>
              {audit.length ? <div className="actor-audit-list">{audit.map((entry) => <article key={entry.id}><span className={`audit-outcome ${entry.success ? "success" : "failure"}`}>{entry.success ? "Success" : "Failed"}</span><div><strong>{entry.command}</strong><small>{new Date(entry.createdAt).toLocaleString()} · {entry.durationMs} ms</small></div><pre>{entry.error || entry.output || "No output"}</pre></article>)}</div> : <p className="empty-audit">No commands have been run on this actor yet.</p>}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
