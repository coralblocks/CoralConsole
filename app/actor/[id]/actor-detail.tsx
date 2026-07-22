"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ACTOR_META,
  actorSnapshotKey,
  callActor,
  parseActorSnapshot,
  statusLabel,
  type Actor,
  type AdminReply,
} from "../../actor-ui";

export default function ActorDetail({ actorId }: { actorId: string }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [command, setCommand] = useState("status");
  const [params, setParams] = useState("");
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<AdminReply | null>(null);

  useEffect(() => {
    const hydration = window.setTimeout(() => {
      const stored = parseActorSnapshot(window.localStorage.getItem(actorSnapshotKey(actorId)));
      setActor(stored);
      setCommand(stored?.commands[0] || "list");
      setReady(true);
    }, 0);

    return () => window.clearTimeout(hydration);
  }, [actorId]);

  async function runCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actor) return;
    setRunning(true);
    setReply(null);

    if (actor.demo) {
      window.setTimeout(() => {
        setReply({
          result: true,
          adminCommand: `${actor.name} ${command}`,
          params,
          results: command === "status"
            ? `${actor.name} is ${statusLabel(actor.status)}\nSession: ${actor.session}${actor.sessionStarted ? `\nSession started: ${actor.sessionStarted}` : ""}\nLast seen: ${actor.lastSeen}`
            : `${command} executed successfully on ${actor.name}`,
        });
        setRunning(false);
      }, 420);
      return;
    }

    try {
      const scopedCommand = command === "list" ? "list" : `${actor.name} ${command}`;
      setReply(await callActor(actor, scopedCommand, params));
    } catch (error) {
      setReply({ result: false, error: error instanceof Error ? error.message : "Command failed." });
    } finally {
      setRunning(false);
    }
  }

  function removeActor() {
    if (!actor || actor.demo) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem("coral-console-actors") || "[]") as Actor[];
      window.localStorage.setItem("coral-console-actors", JSON.stringify(saved.filter((entry) => entry.id !== actor.id)));
    } catch {
      window.localStorage.removeItem("coral-console-actors");
    }
    window.localStorage.removeItem(actorSnapshotKey(actor.id));
    setActor(null);
    setRemoved(true);
  }

  const Icon = actor ? ACTOR_META[actor.kind].icon : null;

  return (
    <main className="console-shell actor-detail-page">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CoralConsole topology">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>CoralConsole</strong><small>Actor detail</small></span>
        </Link>
        <Link className="button button-ghost detail-back" href="/">← Back to topology</Link>
      </header>

      <section className="actor-detail-main" aria-live="polite">
        {!ready ? (
          <div className="actor-detail-empty"><p className="eyebrow">Actor detail</p><h1>Loading actor…</h1></div>
        ) : !actor ? (
          <div className="actor-detail-empty">
            <p className="eyebrow">Actor detail</p>
            <h1>{removed ? "Actor removed" : "Actor details unavailable"}</h1>
            <p>{removed ? "The actor was removed from this local workspace." : "Open this view by clicking an actor on the topology map."}</p>
            <Link className="button button-primary" href="/">Return to topology</Link>
          </div>
        ) : (
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
                <div className="select-wrap">
                  <select id="command" value={command} onChange={(event) => setCommand(event.target.value)}>
                    {actor.commands.map((available) => <option value={available} key={available}>{available}</option>)}
                  </select>
                </div>
                <label htmlFor="params">Parameters <span>optional</span></label>
                <input id="params" value={params} onChange={(event) => setParams(event.target.value)} placeholder="e.g. 10 16" />
                <button className="button button-dark" type="submit" disabled={running || actor.status === "offline"}>
                  {running ? "Running…" : "Run action"}<span aria-hidden="true">→</span>
                </button>
              </form>
              {reply && (
                <div className={`command-result ${reply.result ? "success" : "failure"}`} role="status">
                  <div><strong>{reply.result ? "Command complete" : "Command failed"}</strong><span>{reply.adminCommand || command}</span></div>
                  <pre>{reply.error || reply.results || "No output returned."}</pre>
                </div>
              )}
            </div>

            {actor.demo ? (
              <p className="demo-note"><i /> Sample actor — actions are safely simulated.</p>
            ) : (
              <button className="remove-button" type="button" onClick={removeActor}>Remove actor from workspace</button>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
