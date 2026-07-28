"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { ConsoleBrand } from "../../console-chrome";
import { ACTOR_META, auditOutcomeLabel, operationalStateForDisplay, operationalStateLabel, statusLabel, type Actor, type AdminActionReply } from "../../actor-ui";
import type { AuditEntry, TopologySettings } from "@/lib/types";

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

function auditOutput(entry: AuditEntry) {
  return [entry.error, entry.output].filter(Boolean).join("\n\n") || "No output";
}

function formatLastActorStatusResponse(value?: string) {
  if (!value) return "Not received";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "Not received" : timestamp.toLocaleString();
}

export default function ActorDetail({ actorId }: { actorId: string }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState("actorStatus");
  const [params, setParams] = useState("");
  const [running, setRunning] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [reply, setReply] = useState<AdminActionReply | null>(null);
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(5);

  const loadAudit = useCallback(async () => {
    const payload = await apiRequest<{ entries: AuditEntry[] }>(`/api/audit?actorId=${encodeURIComponent(actorId)}&limit=20`, { cache: "no-store" });
    setAudit(payload.entries);
  }, [actorId]);

  const refreshActor = useCallback(async (force = false) => {
    await apiRequest<{ actors: Actor[] }>("/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const payload = await apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actorId)}`, { cache: "no-store" });
    return payload.actor;
  }, [actorId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      refreshActor(true),
      apiRequest<{ entries: AuditEntry[] }>(`/api/audit?actorId=${encodeURIComponent(actorId)}&limit=20`, { cache: "no-store" }),
      apiRequest<{ settings: TopologySettings }>("/api/settings", { cache: "no-store" }),
    ]).then(([actorPayload, auditPayload, settingsPayload]) => {
      if (!active) return;
      setActor(actorPayload);
      setAction(actorPayload.actions[0] || "list");
      setAudit(auditPayload.entries);
      setPollIntervalSeconds(settingsPayload.settings.pollIntervalSeconds);
    }).catch((requestError) => {
      if (active) setError(requestError instanceof Error ? requestError.message : "Actor details could not be loaded.");
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, [actorId, refreshActor]);

  useEffect(() => {
    if (!ready || removed) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshActor(false).then((updatedActor) => {
        setActor(updatedActor);
        setAction((current) => updatedActor.actions.includes(current) ? current : updatedActor.actions[0] || "list");
        setError("");
      }).catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Actor details could not be refreshed.");
      });
    }, pollIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [pollIntervalSeconds, ready, refreshActor, removed]);

  async function runAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actor) return;
    setRunning(true);
    setReply(null);
    try {
      const result = await apiRequest<AdminActionReply>(`/api/actors/${encodeURIComponent(actor.id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params }),
      });
      setReply(result);
    } catch (requestError) {
      setReply({ result: false, error: requestError instanceof Error ? requestError.message : "Action failed." });
    } finally {
      setRunning(false);
      void Promise.all([
        loadAudit(),
        apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actor.id)}`, { cache: "no-store" }),
      ]).then(([, actorPayload]) => {
        setActor(actorPayload.actor);
        setAction((current) => actorPayload.actor.actions.includes(current) ? current : actorPayload.actor.actions[0] || "list");
      }).catch(() => undefined);
    }
  }

  async function refreshActorStatus() {
    if (!actor || refreshingStatus) return;
    setRefreshingStatus(true);
    setError("");
    try {
      const payload = await apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actor.id)}/refresh`, {
        method: "POST",
      });
      setActor(payload.actor);
      setAction((current) => payload.actor.actions.includes(current) ? current : payload.actor.actions[0] || "list");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Actor status could not be refreshed.");
    } finally {
      setRefreshingStatus(false);
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
  const displayedState = actor ? operationalStateForDisplay(actor.status, actor.operationalState) : "unknown";

  return (
    <main className="console-shell actor-detail-page">
      <header className="topbar">
        <ConsoleBrand href="/" ariaLabel="CoralConsole topology" subtitle="Actor detail" />
        <div className="topbar-actions">
          <Link className="intro-toggle nav-link" href="/actors" target="_blank" rel="noopener noreferrer">List Actors</Link>
          <Link className="intro-toggle nav-link" href={`/audit?actorId=${encodeURIComponent(actorId)}`} target="_blank" rel="noopener noreferrer">Audit Actor</Link>
        </div>
      </header>

      <section className="actor-detail-main" aria-live="polite">
        {!ready ? (
          <div className="actor-detail-empty"><p className="eyebrow">Actor detail</p><h1>Loading actor…</h1></div>
        ) : !actor ? (
          <div className="actor-detail-empty">
            <p className="eyebrow">Actor detail</p>
            <h1>{removed ? "Actor removed" : "Actor details unavailable"}</h1>
            <p>{removed ? "The actor was removed from the shared topology." : error || "This actor no longer exists in the shared topology."}</p>
          </div>
        ) : (
          <div className="actor-detail-layout">
            <section className={`inspector actor-detail-panel actor-${actor.kind}${actor.status === "offline" ? " actor-detail-offline" : ""}`} aria-label={`${actor.name} details`}>
              <div className="inspector-accent" />
              <div className="inspector-head">
                <span className="actor-avatar large" aria-hidden="true">{Icon && <Icon />}</span>
                <div className="actor-detail-identity">
                  <p>{ACTOR_META[actor.kind].label}{actor.sequencerRole ? ` · ${actor.sequencerRole}` : ""}</p>
                  <div className="actor-title-row">
                    <h1>{actor.name}</h1>
                    <button className="status-refresh-button" type="button" onClick={() => void refreshActorStatus()} disabled={refreshingStatus} aria-label={`Refresh ${actor.name} actor status`}>
                      <RefreshCw aria-hidden="true" />
                      {refreshingStatus ? "Refreshing…" : "Refresh actor status"}
                    </button>
                  </div>
                </div>
                <div className="actor-status-badges">
                  <span className={`actor-state-badge state-${displayedState}`}>{operationalStateLabel(displayedState)}</span>
                  <span className={`status-badge status-${actor.status}`}><i />{statusLabel(actor.status)}</span>
                </div>
              </div>
              <dl className="detail-grid">
                <div><dt>REST endpoint</dt><dd>{actor.host}:{actor.port}</dd></div>
                <div><dt>Last response</dt><dd>{formatLastActorStatusResponse(actor.actorStatusRespondedAt)}</dd></div>
                {actor.actorStatusFields.map((field, index) => (
                  <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>
                ))}
              </dl>
              <div className="admin-block">
                <div className="admin-heading"><div><p className="eyebrow">REST admin</p><h2>Run an action</h2></div><span>{actor.actions.length} available</span></div>
                <form onSubmit={runAction}>
                  <label htmlFor="action">Admin action</label>
                  <div className="select-wrap"><select id="action" value={action} onChange={(event) => setAction(event.target.value)}>{actor.actions.map((available) => <option value={available} key={available}>{available}</option>)}</select></div>
                  <label htmlFor="params">Parameters <span>optional</span></label><input id="params" value={params} onChange={(event) => setParams(event.target.value)} placeholder="e.g. 10 16" />
                  <button className="button button-dark" type="submit" disabled={running || !actor.actions.length}>{running ? "Running…" : "Run action"}<span aria-hidden="true">→</span></button>
                </form>
                {reply && <div className={`action-result ${reply.result ? "success" : "failure"}`} role="status"><div><strong>{reply.result ? "Action complete" : "Action failed"}</strong><span>{reply.adminCommand || action}</span></div><pre>{reply.error || reply.results || "No output returned."}</pre></div>}
              </div>
              {error && <p className="page-alert embedded" role="alert">{error}</p>}
              {actor.demo ? <p className="demo-note"><i /> Sample actor — actions are safely simulated.</p> : <button className="remove-button" type="button" onClick={() => void removeActor()}>Remove actor from shared topology</button>}
            </section>

            <section className="actor-audit-panel" aria-labelledby="actor-audit-title">
              <div className="section-heading"><div><p className="eyebrow">Admin action history</p><h2 id="actor-audit-title">Recent activity</h2></div><Link className="button button-ghost" href={`/audit?actorId=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer">Open Actor Full Audit</Link></div>
              {audit.length ? <div className="actor-audit-list">{audit.map((entry) => <article key={entry.id}><span className={`audit-outcome ${entry.outcome}`}>{auditOutcomeLabel(entry.outcome)}</span><div><strong>{entry.action}</strong><small>{new Date(entry.createdAt).toLocaleString()} · {entry.durationMs} ms</small></div><pre>{auditOutput(entry)}</pre></article>)}</div> : <p className="empty-audit">No admin actions have been run on this actor yet.</p>}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
