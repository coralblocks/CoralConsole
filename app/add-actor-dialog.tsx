"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ACTOR_KINDS, ACTOR_META, type ActorKind } from "./actor-ui";
import type { ActorDiscoveryResult } from "@/lib/types";

type AddActorDialogProps = {
  open: boolean;
  onClose: () => void;
  onDiscovered: (result: ActorDiscoveryResult) => void;
  preferredKind?: ActorKind | null;
};

async function discoverActors(host: string, port: number) {
  const response = await fetch("/api/actors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, port }),
  });
  const payload = await response.json() as ActorDiscoveryResult & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Actor discovery failed.");
  return payload;
}

function groupLabel(kind: ActorKind) {
  return kind === "sequencer" ? "Sequencers" : ACTOR_META[kind].summaryLabel;
}

export function AddActorDialog({ open, onClose, onDiscovered, preferredKind = null }: AddActorDialogProps) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("30001");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || connecting) return;
      setError("");
      onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [connecting, onClose, open]);

  function closeDialog() {
    if (connecting) return;
    setError("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericPort = Number(port);
    if (!host.trim() || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setError("Enter a host and a valid REST admin port.");
      return;
    }
    setError("");
    setConnecting(true);
    try {
      const result = await discoverActors(host.trim(), numericPort);
      onDiscovered(result);
      setHost("");
      setPort("30001");
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reach this REST admin server.");
    } finally {
      setConnecting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section className={`add-modal${preferredKind ? ` actor-${preferredKind}` : ""}`} role="dialog" aria-modal="true" aria-labelledby="add-actor-title">
        <button className="modal-close" type="button" onClick={closeDialog} disabled={connecting} aria-label="Close add actor dialog">×</button>
        <p className="eyebrow">{preferredKind ? `Add to ${groupLabel(preferredKind)}` : "Auto-discovery"}</p>
        <h2 id="add-actor-title">Connect actors</h2>
        <p>Enter a REST admin server address. The CoralConsole server will discover and add every actor account exposed by that REST admin server.</p>
        <div className="actor-type-list" aria-label="Supported actor types">
          {ACTOR_KINDS.filter((kind) => kind !== "link").map((kind) => (
            <span className={kind === preferredKind ? "selected" : ""} key={kind}>{ACTOR_META[kind].label}</span>
          ))}
        </div>
        <form onSubmit={submit}>
          <label className="actor-host-label" htmlFor="add-actor-host">IP ADDRESS OR HOST <span>(used by the CoralConsole <strong>server</strong>, not this browser)</span></label>
          <input id="add-actor-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="10.42.0.10" autoFocus />
          <label htmlFor="add-actor-port">REST admin port</label>
          <input id="add-actor-port" value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" placeholder="30001" />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="button button-ghost" type="button" onClick={closeDialog} disabled={connecting}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={connecting}>{connecting ? "Discovering…" : "Discover actors"}</button>
          </div>
        </form>
        <div className="privacy-note"><span aria-hidden="true">⌂</span><p><strong>Shared internal configuration</strong>The CoralConsole server contacts the REST admin server and stores discovered actors in CoralConsole&apos;s SQLite database.</p></div>
      </section>
    </div>
  );
}
