"use client";

import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { ACTOR_META, statusLabel, type Actor } from "../actor-ui";
import type { TopologySettings } from "@/lib/types";

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

const BrandIcon = ACTOR_META.sequencer.icon;

export default function ActorList() {
  const [actors, setActors] = useState<Actor[]>([]);
  const actorsRef = useRef<Actor[]>([]);
  const dragOriginalRef = useRef<Actor[]>([]);
  const dragCommittedRef = useRef(false);
  const draggedIdRef = useRef("");
  const noticeFadeTimerRef = useRef<number | undefined>(undefined);
  const noticeClearTimerRef = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeFading, setNoticeFading] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draftHost, setDraftHost] = useState("");
  const [draftPort, setDraftPort] = useState("");
  const [savingId, setSavingId] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [draggedId, setDraggedId] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(5);

  const replaceActors = useCallback((next: Actor[]) => {
    actorsRef.current = next;
    setActors(next);
  }, []);

  const loadActors = useCallback(async () => {
    const payload = await apiRequest<{ actors: Actor[] }>("/api/actors", { cache: "no-store" });
    replaceActors(payload.actors);
  }, [replaceActors]);

  function showNotice(message: string, autoDismiss = false) {
    if (noticeFadeTimerRef.current !== undefined) window.clearTimeout(noticeFadeTimerRef.current);
    if (noticeClearTimerRef.current !== undefined) window.clearTimeout(noticeClearTimerRef.current);
    noticeFadeTimerRef.current = undefined;
    noticeClearTimerRef.current = undefined;
    setNoticeFading(false);
    setNotice(message);
    if (!message || !autoDismiss) return;
    noticeFadeTimerRef.current = window.setTimeout(() => setNoticeFading(true), 2400);
    noticeClearTimerRef.current = window.setTimeout(() => {
      setNotice("");
      setNoticeFading(false);
    }, 3000);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<{ actors: Actor[] }>("/api/actors", { cache: "no-store" }),
      apiRequest<{ settings: TopologySettings }>("/api/settings", { cache: "no-store" }),
    ]).then(([actorPayload, settingsPayload]) => {
      if (!active) return;
      replaceActors(actorPayload.actors);
      setPollIntervalSeconds(settingsPayload.settings.pollIntervalSeconds);
    }).catch((requestError) => {
      if (active) setError(requestError instanceof Error ? requestError.message : "Actors could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [replaceActors]);

  useEffect(() => () => {
    if (noticeFadeTimerRef.current !== undefined) window.clearTimeout(noticeFadeTimerRef.current);
    if (noticeClearTimerRef.current !== undefined) window.clearTimeout(noticeClearTimerRef.current);
  }, []);

  useEffect(() => {
    if (editingId || draggedId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadActors().catch(() => undefined);
    }, pollIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [draggedId, editingId, loadActors, pollIntervalSeconds]);

  function startEditing(actor: Actor) {
    setEditingId(actor.id);
    setDraftHost(actor.host);
    setDraftPort(String(actor.port));
    setError("");
    showNotice("");
  }

  function cancelEditing() {
    setEditingId("");
    setDraftHost("");
    setDraftPort("");
  }

  async function refreshEditedActor(actorId: string) {
    try {
      const payload = await apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actorId)}/refresh`, {
        method: "POST",
      });
      replaceActors(actorsRef.current.map((actor) => actor.id === actorId ? payload.actor : actor));
    } catch {
      // The endpoint edit is already saved. The normal polling loop will retry it.
    }
  }

  async function saveEndpoint(actor: Actor) {
    const host = draftHost.trim();
    const port = Number(draftPort);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Enter a host and a valid REST admin port.");
      return;
    }
    setSavingId(actor.id);
    setError("");
    showNotice("");
    try {
      const payload = await apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actor.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port }),
      });
      replaceActors(actorsRef.current.map((current) => current.id === actor.id ? payload.actor : current));
      cancelEditing();
      showNotice(`${actor.name} endpoint saved. CoralConsole is checking the new address.`);
      void refreshEditedActor(actor.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Actor endpoint could not be saved.");
    } finally {
      setSavingId("");
    }
  }

  function handleEditKey(event: KeyboardEvent<HTMLInputElement>, actor: Actor) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveEndpoint(actor);
    } else if (event.key === "Escape") {
      cancelEditing();
    }
  }

  async function removeActor(actor: Actor) {
    if (actor.demo || !window.confirm(`Remove ${actor.name} from CoralConsole? This cannot be undone.`)) return;
    setRemovingId(actor.id);
    setError("");
    showNotice("");
    try {
      await apiRequest<{ removed: boolean }>(`/api/actors/${encodeURIComponent(actor.id)}`, { method: "DELETE" });
      replaceActors(actorsRef.current.filter((current) => current.id !== actor.id));
      showNotice(`${actor.name} was removed from CoralConsole.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Actor could not be removed.");
    } finally {
      setRemovingId("");
    }
  }

  function beginDrag(event: DragEvent<HTMLTableRowElement>, actorId: string) {
    if (editingId || ordering) {
      event.preventDefault();
      return;
    }
    dragOriginalRef.current = [...actorsRef.current];
    dragCommittedRef.current = false;
    draggedIdRef.current = actorId;
    setDraggedId(actorId);
    showNotice("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", actorId);
  }

  function moveDraggedActor(event: DragEvent<HTMLTableRowElement>, targetId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const currentDraggedId = draggedIdRef.current;
    if (!currentDraggedId || currentDraggedId === targetId) return;
    const targetRow = event.currentTarget.getBoundingClientRect();
    const placeAfterTarget = event.clientY > targetRow.top + targetRow.height / 2;
    setActors((current) => {
      const next = [...current];
      const draggedIndex = next.findIndex((actor) => actor.id === currentDraggedId);
      if (draggedIndex < 0) return current;
      const [dragged] = next.splice(draggedIndex, 1);
      const targetIndex = next.findIndex((actor) => actor.id === targetId);
      if (!dragged || targetIndex < 0) return current;
      next.splice(targetIndex + (placeAfterTarget ? 1 : 0), 0, dragged);
      actorsRef.current = next;
      return next;
    });
  }

  async function saveOrder(event: DragEvent<HTMLTableRowElement>) {
    event.preventDefault();
    const orderChanged = actorsRef.current.some((actor, index) => actor.id !== dragOriginalRef.current[index]?.id);
    dragCommittedRef.current = true;
    draggedIdRef.current = "";
    setDraggedId("");
    if (!orderChanged) {
      replaceActors(dragOriginalRef.current);
      return;
    }
    setOrdering(true);
    setError("");
    showNotice("");
    try {
      const payload = await apiRequest<{ actors: Actor[] }>("/api/actors/order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorIds: actorsRef.current.map((actor) => actor.id) }),
      });
      replaceActors(payload.actors);
      showNotice("Actor order saved.", true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Actor order could not be saved.");
      await loadActors().catch(() => replaceActors(dragOriginalRef.current));
    } finally {
      setOrdering(false);
    }
  }

  function finishDrag() {
    if (!dragCommittedRef.current) replaceActors(dragOriginalRef.current);
    draggedIdRef.current = "";
    setDraggedId("");
  }

  return (
    <main className="console-shell actor-list-page">
      <header className="topbar">
        <div className="brand" aria-label="CoralConsole actor list">
          <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
          <span><strong>CoralConsole</strong><small>Actor registry</small></span>
        </div>
      </header>

      <section className="actor-list-main">
        <div className="actor-list-title">
          <p className="eyebrow">Shared topology registry</p>
          <h1>List Actors</h1>
          <p>Edit REST endpoints, remove actors, or drag rows into the precedence order you want CoralConsole to retain.</p>
        </div>

        {error && <p className="page-alert actor-list-alert" role="alert">{error}</p>}
        {notice && <p className={`actor-list-notice${noticeFading ? " actor-list-notice-fading" : ""}`} role="status">{notice}</p>}

        <section className="actor-list-table-wrap" aria-live="polite" aria-busy={loading || ordering}>
          {loading ? <p className="empty-audit">Loading actors…</p> : !actors.length ? <p className="empty-audit">No actors have been added to CoralConsole.</p> : (
            <table className="actor-list-table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Class</th><th>REST IP</th><th>REST PORT</th><th>Online?</th><th>Edit</th><th>Remove</th></tr>
              </thead>
              <tbody>
                {actors.map((actor) => {
                  const editing = editingId === actor.id;
                  const saving = savingId === actor.id;
                  return (
                    <tr
                      key={actor.id}
                      draggable={!editingId && !ordering}
                      className={draggedId === actor.id ? "actor-list-row-dragging" : ""}
                      onDragStart={(event) => beginDrag(event, actor.id)}
                      onDragOver={(event) => moveDraggedActor(event, actor.id)}
                      onDrop={(event) => void saveOrder(event)}
                      onDragEnd={finishDrag}
                    >
                      <td>
                        <span className="actor-list-endpoint">
                          <span className="actor-drag-handle" title="Drag to reorder" aria-label={`Drag ${actor.name} to reorder`}><GripVertical aria-hidden="true" /></span>
                          <strong>{actor.name}</strong>
                        </span>
                      </td>
                      <td>{ACTOR_META[actor.kind].label}</td>
                      <td><code>{actor.className}</code></td>
                      <td>{editing
                        ? <input aria-label={`${actor.name} REST IP`} value={draftHost} onChange={(event) => setDraftHost(event.target.value)} onKeyDown={(event) => handleEditKey(event, actor)} autoFocus />
                        : <code>{actor.host}</code>}</td>
                      <td>{editing
                        ? <input aria-label={`${actor.name} REST port`} inputMode="numeric" value={draftPort} onChange={(event) => setDraftPort(event.target.value)} onKeyDown={(event) => handleEditKey(event, actor)} />
                        : <code>{actor.port}</code>}</td>
                      <td><span className={`actor-list-status status-${actor.status}`}><i />{statusLabel(actor.status)}</span></td>
                      <td>{editing ? <span className="actor-list-edit-actions">
                        <button type="button" onClick={() => void saveEndpoint(actor)} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                        <button type="button" onClick={cancelEditing} disabled={saving}>Cancel</button>
                      </span> : <button className="actor-list-edit-button" type="button" onClick={() => startEditing(actor)} disabled={Boolean(editingId) || actor.demo}>{actor.demo ? "Sample" : "Edit"}</button>}</td>
                      <td><button className="actor-list-remove-button" type="button" onClick={() => void removeActor(actor)} disabled={Boolean(removingId) || actor.demo}>{removingId === actor.id ? "Removing…" : actor.demo ? "Sample" : "Remove"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </section>
    </main>
  );
}
