"use client";

import { FormEvent, type UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { ConsoleBrand } from "../../console-chrome";
import { ACTOR_META, auditOutcomeLabel, operationalStateForDisplay, operationalStateLabel, statusLabel, type Actor, type AdminActionReply } from "../../actor-ui";
import { useServerHealth } from "../../use-server-health";
import type { AuditEntry, TopologySettings } from "@/lib/types";

type ActorLogSnapshot = {
  messages: string[];
  updatedAt?: string;
};

const EMPTY_ACTOR_LOG_SNAPSHOT: ActorLogSnapshot = { messages: [] };
const LOG_NEAR_BOTTOM_THRESHOLD = 36;

function sameLogMessages(left: ActorLogSnapshot, right: ActorLogSnapshot) {
  return left.messages.length === right.messages.length
    && left.messages.every((message, index) => message === right.messages[index]);
}

const SGR_COLORS: Record<number, string> = {
  30: "#91a09c",
  31: "#ff8b82",
  32: "#9fdb83",
  33: "#f5cd73",
  34: "#82b9ff",
  35: "#d7a1ef",
  36: "#76d9d1",
  37: "#e8f4f0",
  90: "#9aa9a5",
  91: "#ffaaa3",
  92: "#b9eb9c",
  93: "#ffe09b",
  94: "#a8cfff",
  95: "#e5b9f5",
  96: "#9ae8e1",
  97: "#ffffff",
};

function formatSgrLogMessage(message: string) {
  const sgrPattern = /(?:\u001b\[|\u009b)([0-9;]*)m/g;
  const leadingSgr = message.match(/^(?:(?:\u001b\[|\u009b)[0-9;]*m)+/)?.[0] ?? "";
  let bold = false;
  let color: string | undefined;

  for (const sequence of leadingSgr.matchAll(sgrPattern)) {
    const codes = sequence[1] === ""
      ? [0]
      : sequence[1].split(";").map((code) => Number(code));

    for (const code of codes) {
      if (code === 0) {
        bold = false;
        color = undefined;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = undefined;
      } else if (SGR_COLORS[code]) {
        color = SGR_COLORS[code];
      }
    }
  }

  return {
    bold,
    color,
    text: message.replace(sgrPattern, ""),
  };
}

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

function actionsForAdminAccount(actor: Actor, account: string) {
  return account === "VM" ? actor.vmActions : actor.actions;
}

function actionReplyLabel(reply: AdminActionReply, account: string, action: string) {
  if (reply.adminCommand === "list" && reply.params) return `list ${reply.params}`;
  return reply.adminCommand || `${account} ${action}`;
}

export default function ActorDetail({ actorId }: { actorId: string }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [logs, setLogs] = useState<ActorLogSnapshot>(EMPTY_ACTOR_LOG_SNAPSHOT);
  const [pendingLogs, setPendingLogs] = useState<ActorLogSnapshot | null>(null);
  const [logsUpdated, setLogsUpdated] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const [adminAccount, setAdminAccount] = useState("");
  const [action, setAction] = useState("actorStatus");
  const [params, setParams] = useState("");
  const [running, setRunning] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [reply, setReply] = useState<AdminActionReply | null>(null);
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(5);
  const displayedLogsRef = useRef<ActorLogSnapshot>(EMPTY_ACTOR_LOG_SNAPSHOT);
  const pendingLogsRef = useRef<ActorLogSnapshot | null>(null);
  const followingLogsRef = useRef(true);
  const scrollLogsToBottomRef = useRef(false);
  const logsPulseTimerRef = useRef<number | null>(null);
  const logOutputRef = useRef<HTMLPreElement | null>(null);
  const serverConnected = useServerHealth();

  const pulseLogPanel = useCallback(() => {
    if (logsPulseTimerRef.current !== null) {
      window.clearTimeout(logsPulseTimerRef.current);
    }
    setLogsUpdated(true);
    logsPulseTimerRef.current = window.setTimeout(() => {
      setLogsUpdated(false);
      logsPulseTimerRef.current = null;
    }, 1400);
  }, []);

  const displayLogSnapshot = useCallback((snapshot: ActorLogSnapshot, drawAttention: boolean) => {
    if (sameLogMessages(displayedLogsRef.current, snapshot)) return;
    displayedLogsRef.current = snapshot;
    pendingLogsRef.current = null;
    followingLogsRef.current = true;
    scrollLogsToBottomRef.current = true;
    setPendingLogs(null);
    setLogs(snapshot);
    if (drawAttention) pulseLogPanel();
  }, [pulseLogPanel]);

  const receiveLogSnapshot = useCallback((snapshot: ActorLogSnapshot, initial = false) => {
    if (sameLogMessages(displayedLogsRef.current, snapshot)) {
      return;
    }
    if (pendingLogsRef.current && sameLogMessages(pendingLogsRef.current, snapshot)) {
      return;
    }
    if (initial || followingLogsRef.current) {
      displayLogSnapshot(snapshot, !initial);
      return;
    }
    pendingLogsRef.current = snapshot;
    setPendingLogs(snapshot);
    pulseLogPanel();
  }, [displayLogSnapshot, pulseLogPanel]);

  const revealLatestLogs = useCallback(() => {
    followingLogsRef.current = true;
    const snapshot = pendingLogsRef.current;
    if (snapshot) {
      displayLogSnapshot(snapshot, false);
      return;
    }
    const output = logOutputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [displayLogSnapshot]);

  const handleLogScroll = useCallback((event: UIEvent<HTMLPreElement>) => {
    const output = event.currentTarget;
    const nearBottom = output.scrollHeight - output.scrollTop - output.clientHeight <= LOG_NEAR_BOTTOM_THRESHOLD;
    followingLogsRef.current = nearBottom;
    if (nearBottom && pendingLogsRef.current) revealLatestLogs();
  }, [revealLatestLogs]);

  useLayoutEffect(() => {
    if (!scrollLogsToBottomRef.current) return;
    const scrollToBottom = () => {
      const output = logOutputRef.current;
      if (output) output.scrollTop = output.scrollHeight;
    };
    scrollToBottom();
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
      scrollLogsToBottomRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [logs]);

  useEffect(() => () => {
    if (logsPulseTimerRef.current !== null) {
      window.clearTimeout(logsPulseTimerRef.current);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    const payload = await apiRequest<{ entries: AuditEntry[] }>(`/api/audit?actorId=${encodeURIComponent(actorId)}&limit=20`, { cache: "no-store" });
    setAudit(payload.entries);
  }, [actorId]);

  const loadActorLogs = useCallback(async () => {
    const payload = await apiRequest<{ logs: ActorLogSnapshot }>(`/api/actors/${encodeURIComponent(actorId)}/logs`, { cache: "no-store" });
    return payload.logs;
  }, [actorId]);

  const refreshActor = useCallback(async (force = false) => {
    await apiRequest<{ actors: Actor[] }>("/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const [actorPayload, logPayload] = await Promise.all([
      apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actorId)}`, { cache: "no-store" }),
      loadActorLogs(),
    ]);
    return { actor: actorPayload.actor, logs: logPayload };
  }, [actorId, loadActorLogs]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      refreshActor(true),
      apiRequest<{ entries: AuditEntry[] }>(`/api/audit?actorId=${encodeURIComponent(actorId)}&limit=20`, { cache: "no-store" }),
      apiRequest<{ settings: TopologySettings }>("/api/settings", { cache: "no-store" }),
    ]).then(([snapshot, auditPayload, settingsPayload]) => {
      if (!active) return;
      setActor(snapshot.actor);
      receiveLogSnapshot(snapshot.logs, true);
      setAdminAccount(snapshot.actor.account);
      setAction(snapshot.actor.actions[0] || "list");
      setAudit(auditPayload.entries);
      setPollIntervalSeconds(settingsPayload.settings.pollIntervalSeconds);
    }).catch((requestError) => {
      if (active) setError(requestError instanceof Error ? requestError.message : "Actor details could not be loaded.");
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, [actorId, receiveLogSnapshot, refreshActor]);

  useEffect(() => {
    if (!ready || removed) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshActor(false).then((snapshot) => {
        setActor(snapshot.actor);
        receiveLogSnapshot(snapshot.logs);
        const availableActions = actionsForAdminAccount(snapshot.actor, adminAccount);
        setAction((current) => availableActions.includes(current) ? current : availableActions[0] || "");
        setError("");
      }).catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Actor details could not be refreshed.");
      });
    }, pollIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [adminAccount, pollIntervalSeconds, ready, receiveLogSnapshot, refreshActor, removed]);

  function changeAdminAccount(nextAccount: string) {
    if (!actor || (nextAccount !== actor.account && nextAccount !== "VM")) return;
    const availableActions = actionsForAdminAccount(actor, nextAccount);
    setAdminAccount(nextAccount);
    setAction(availableActions[0] || "");
    setParams("");
    setReply(null);
  }

  function changeAdminAction(nextAction: string) {
    setAction(nextAction);
    if (nextAction === "list") setParams("");
    setReply(null);
  }

  async function runAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actor) return;
    setRunning(true);
    setReply(null);
    try {
      const result = await apiRequest<AdminActionReply>(`/api/actors/${encodeURIComponent(actor.id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: adminAccount, action, params }),
      });
      setReply(result);
    } catch (requestError) {
      setReply({ result: false, error: requestError instanceof Error ? requestError.message : "Action failed." });
    } finally {
      setRunning(false);
      void Promise.all([
        loadAudit(),
        apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actor.id)}`, { cache: "no-store" }),
        loadActorLogs(),
      ]).then(([, actorPayload, logPayload]) => {
        setActor(actorPayload.actor);
        receiveLogSnapshot(logPayload);
        const availableActions = actionsForAdminAccount(actorPayload.actor, adminAccount);
        setAction((current) => availableActions.includes(current) ? current : availableActions[0] || "");
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
      receiveLogSnapshot(await loadActorLogs());
      const availableActions = actionsForAdminAccount(payload.actor, adminAccount);
      setAction((current) => availableActions.includes(current) ? current : availableActions[0] || "");
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
  const availableActions = actor ? actionsForAdminAccount(actor, adminAccount) : [];

  return (
    <main className="console-shell actor-detail-page">
      <header className="topbar">
        <ConsoleBrand href="/" ariaLabel="CoralConsole topology" subtitle="Actor detail" />
        <div className="topbar-actions">
          <Link className="intro-toggle nav-link" href="/actors" target="_blank" rel="noopener noreferrer">List Actors</Link>
          <Link className="intro-toggle nav-link" href={`/audit?actorId=${encodeURIComponent(actorId)}`} target="_blank" rel="noopener noreferrer">Audit Actor</Link>
        </div>
      </header>

      <section className={`actor-detail-main${serverConnected === false ? " actor-detail-server-unreachable" : ""}`} aria-live="polite">
        {serverConnected === false && (
          <div className="actor-detail-connectivity-alert" role="alert">
            <span aria-hidden="true" />
            <div>
              <strong>CoralConsole server unavailable</strong>
              <p>Actor details may be stale until the connection is restored.</p>
            </div>
          </div>
        )}
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
            </section>

            <section className={`actor-logs-panel actor-${actor.kind}${actor.status === "offline" ? " actor-logs-offline" : ""}${logsUpdated ? " actor-logs-updated" : ""}`} aria-labelledby="actor-logs-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Actor logs</p>
                  <h2 id="actor-logs-title">Recent log messages</h2>
                </div>
                <div className="actor-logs-heading-actions">
                  <div className="actor-status-badges">
                    <span className={`actor-state-badge state-${displayedState}`}>{operationalStateLabel(displayedState)}</span>
                    <span className={`status-badge status-${actor.status}`}><i />{statusLabel(actor.status)}</span>
                  </div>
                </div>
              </div>
              <div className="actor-logs-body">
                {logs.messages.length
                  ? (
                      <pre
                        className={`actor-log-output${pendingLogs ? " actor-log-output-pending" : ""}`}
                        ref={logOutputRef}
                        onScroll={handleLogScroll}
                        tabIndex={0}
                        aria-label="Recent actor log messages"
                      >
                        {logs.messages.map((message, index) => {
                          const formatted = formatSgrLogMessage(message);
                          return (
                            <span
                              className="actor-log-line"
                              key={`${index}-${message}`}
                              style={{
                                color: formatted.color,
                                fontWeight: formatted.bold ? 700 : undefined,
                              }}
                            >
                              {formatted.text}
                            </span>
                          );
                        })}
                      </pre>
                    )
                  : <p className="actor-logs-empty">No log messages have been received from this actor.</p>}
                {pendingLogs && (
                  <div className="actor-logs-new-row">
                    <button
                      className="actor-logs-new-button"
                      type="button"
                      onClick={revealLatestLogs}
                      aria-label="Show new log messages and resume following"
                    >
                      New logs <span aria-hidden="true">↓</span>
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className={`actor-admin-panel actor-${actor.kind}`} aria-labelledby="actor-admin-title">
              <div className="admin-block">
                <div className="admin-heading"><div><p className="eyebrow">REST admin</p><h2 id="actor-admin-title">Run an action</h2></div><span>{availableActions.length} available</span></div>
                <form onSubmit={runAction}>
                  <label htmlFor="admin-account">Admin account</label>
                  <div className="select-wrap"><select id="admin-account" value={adminAccount} onChange={(event) => changeAdminAccount(event.target.value)} disabled={running}><option value={actor.account}>{actor.account}</option><option value="VM">VM</option></select></div>
                  <label htmlFor="action">Admin action</label>
                  <div className="select-wrap"><select id="action" value={action} onChange={(event) => changeAdminAction(event.target.value)} disabled={running}>{availableActions.map((available) => <option value={available} key={available}>{available}</option>)}</select></div>
                  <label htmlFor="params">Parameters <span>optional</span></label><input id="params" value={params} onChange={(event) => setParams(event.target.value)} placeholder={action === "list" ? "Selected account is used" : "e.g. 10 16"} disabled={running || action === "list"} />
                  <button className="button button-dark" type="submit" disabled={running || !availableActions.length}>{running ? "Running…" : "Run action"}<span aria-hidden="true">→</span></button>
                </form>
                {reply && <div className={`action-result ${reply.result ? "success" : "failure"}`} role="status"><div><strong>{reply.result ? "Action complete" : "Action failed"}</strong><span>{actionReplyLabel(reply, adminAccount, action)}</span></div><pre>{reply.error || reply.results || "No output returned."}</pre></div>}
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
