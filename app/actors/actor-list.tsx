"use client";

import { type DragEvent, type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { ACTOR_KINDS, ACTOR_META, statusLabel, type Actor, type ActorKind } from "../actor-ui";
import type { TopologySettings } from "@/lib/types";

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

const BrandIcon = ACTOR_META.sequencer.icon;

type GroupFeedback = {
  message: string;
  tone: "notice" | "error";
  fading: boolean;
};

function groupLabel(kind: ActorKind) {
  return kind === "sequencer" ? "Sequencers" : ACTOR_META[kind].summaryLabel;
}

export default function ActorList() {
  const [actors, setActors] = useState<Actor[]>([]);
  const actorsRef = useRef<Actor[]>([]);
  const dragOriginalRef = useRef<Actor[]>([]);
  const dragCommittedRef = useRef(false);
  const draggedIdRef = useRef("");
  const draggedKindRef = useRef<ActorKind | null>(null);
  const feedbackTimersRef = useRef(new Map<ActorKind, { fade?: number; clear?: number }>());
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [feedbackByKind, setFeedbackByKind] = useState<Partial<Record<ActorKind, GroupFeedback>>>({});
  const [editingId, setEditingId] = useState("");
  const [draftHost, setDraftHost] = useState("");
  const [draftPort, setDraftPort] = useState("");
  const [savingId, setSavingId] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [draggedId, setDraggedId] = useState("");
  const [orderingKind, setOrderingKind] = useState<ActorKind | null>(null);
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(5);
  const [addKind, setAddKind] = useState<ActorKind | null>(null);
  const [connectHost, setConnectHost] = useState("");
  const [connectPort, setConnectPort] = useState("30001");
  const [connectError, setConnectError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const replaceActors = useCallback((next: Actor[]) => {
    actorsRef.current = next;
    setActors(next);
  }, []);

  const loadActors = useCallback(async () => {
    const payload = await apiRequest<{ actors: Actor[] }>("/api/actors", { cache: "no-store" });
    replaceActors(payload.actors);
  }, [replaceActors]);

  function clearFeedbackTimers(kind: ActorKind) {
    const timers = feedbackTimersRef.current.get(kind);
    if (timers?.fade !== undefined) window.clearTimeout(timers.fade);
    if (timers?.clear !== undefined) window.clearTimeout(timers.clear);
    feedbackTimersRef.current.delete(kind);
  }

  function showFeedback(kind: ActorKind, message: string, tone: GroupFeedback["tone"] = "notice", dismissAfterMs?: number) {
    clearFeedbackTimers(kind);
    setFeedbackByKind((current) => {
      const next = { ...current };
      if (message) next[kind] = { message, tone, fading: false };
      else delete next[kind];
      return next;
    });
    if (!message || !dismissAfterMs) return;
    const fade = window.setTimeout(() => {
      setFeedbackByKind((current) => current[kind]
        ? { ...current, [kind]: { ...current[kind]!, fading: true } }
        : current);
    }, Math.max(0, dismissAfterMs - 600));
    const clear = window.setTimeout(() => {
      setFeedbackByKind((current) => {
        const next = { ...current };
        delete next[kind];
        return next;
      });
      feedbackTimersRef.current.delete(kind);
    }, dismissAfterMs);
    feedbackTimersRef.current.set(kind, { fade, clear });
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
      if (active) setPageError(requestError instanceof Error ? requestError.message : "Actors could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [replaceActors]);

  useEffect(() => () => {
    for (const kind of feedbackTimersRef.current.keys()) clearFeedbackTimers(kind);
  }, []);

  useEffect(() => {
    if (editingId || draggedId || orderingKind) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadActors().catch(() => undefined);
    }, pollIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [draggedId, editingId, loadActors, orderingKind, pollIntervalSeconds]);

  function startEditing(actor: Actor) {
    setEditingId(actor.id);
    setDraftHost(actor.host);
    setDraftPort(String(actor.port));
    setPageError("");
    showFeedback(actor.kind, "");
  }

  function openAddActor(kind: ActorKind) {
    setAddKind(kind);
    setConnectError("");
  }

  function closeAddActor() {
    if (connecting) return;
    setAddKind(null);
    setConnectError("");
  }

  async function addActor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericPort = Number(connectPort);
    if (!connectHost.trim() || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setConnectError("Enter a host and a valid REST admin port.");
      return;
    }
    setConnectError("");
    setConnecting(true);
    try {
      const payload = await apiRequest<{ actor: Actor }>("/api/actors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: connectHost.trim(), port: numericPort }),
      });
      replaceActors([...actorsRef.current.filter((actor) => actor.id !== payload.actor.id), payload.actor]);
      setConnectHost("");
      setConnectPort("30001");
      setAddKind(null);
      showFeedback(payload.actor.kind, `${payload.actor.name} was added to CoralConsole.`, "notice", 7000);
    } catch (requestError) {
      setConnectError(requestError instanceof Error ? requestError.message : "Could not reach this actor.");
    } finally {
      setConnecting(false);
    }
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
      showFeedback(actor.kind, "Enter a host and a valid REST admin port.", "error");
      return;
    }
    setSavingId(actor.id);
    setPageError("");
    showFeedback(actor.kind, "");
    try {
      const payload = await apiRequest<{ actor: Actor }>(`/api/actors/${encodeURIComponent(actor.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port }),
      });
      replaceActors(actorsRef.current.map((current) => current.id === actor.id ? payload.actor : current));
      cancelEditing();
      showFeedback(actor.kind, `${actor.name} endpoint saved. CoralConsole is checking the new address.`, "notice", 7000);
      void refreshEditedActor(actor.id);
    } catch (requestError) {
      showFeedback(actor.kind, requestError instanceof Error ? requestError.message : "Actor endpoint could not be saved.", "error");
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
    setPageError("");
    showFeedback(actor.kind, "");
    try {
      await apiRequest<{ removed: boolean }>(`/api/actors/${encodeURIComponent(actor.id)}`, { method: "DELETE" });
      replaceActors(actorsRef.current.filter((current) => current.id !== actor.id));
      showFeedback(actor.kind, `${actor.name} was removed from CoralConsole.`, "notice", 7000);
    } catch (requestError) {
      showFeedback(actor.kind, requestError instanceof Error ? requestError.message : "Actor could not be removed.", "error");
    } finally {
      setRemovingId("");
    }
  }

  function beginDrag(event: DragEvent<HTMLTableRowElement>, actor: Actor) {
    if (editingId || orderingKind) {
      event.preventDefault();
      return;
    }
    dragOriginalRef.current = [...actorsRef.current];
    dragCommittedRef.current = false;
    draggedIdRef.current = actor.id;
    draggedKindRef.current = actor.kind;
    setDraggedId(actor.id);
    showFeedback(actor.kind, "");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", actor.id);
  }

  function moveDraggedActor(event: DragEvent<HTMLTableRowElement>, targetActor: Actor) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const currentDraggedId = draggedIdRef.current;
    if (!currentDraggedId || draggedKindRef.current !== targetActor.kind || currentDraggedId === targetActor.id) return;
    const targetRow = event.currentTarget.getBoundingClientRect();
    const placeAfterTarget = event.clientY > targetRow.top + targetRow.height / 2;
    setActors((current) => {
      const next = [...current];
      const draggedIndex = next.findIndex((actor) => actor.id === currentDraggedId);
      if (draggedIndex < 0) return current;
      const [dragged] = next.splice(draggedIndex, 1);
      const targetIndex = next.findIndex((actor) => actor.id === targetActor.id);
      if (!dragged || targetIndex < 0) return current;
      next.splice(targetIndex + (placeAfterTarget ? 1 : 0), 0, dragged);
      actorsRef.current = next;
      return next;
    });
  }

  async function saveOrder(event: DragEvent<HTMLTableRowElement>, kind: ActorKind) {
    event.preventDefault();
    const actorIds = actorsRef.current.filter((actor) => actor.kind === kind).map((actor) => actor.id);
    const originalIds = dragOriginalRef.current.filter((actor) => actor.kind === kind).map((actor) => actor.id);
    const orderChanged = actorIds.some((actorId, index) => actorId !== originalIds[index]);
    dragCommittedRef.current = true;
    draggedIdRef.current = "";
    draggedKindRef.current = null;
    setDraggedId("");
    if (!orderChanged) {
      replaceActors(dragOriginalRef.current);
      return;
    }
    setOrderingKind(kind);
    setPageError("");
    showFeedback(kind, "");
    try {
      const payload = await apiRequest<{ actors: Actor[] }>("/api/actors/order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, actorIds }),
      });
      replaceActors(payload.actors);
      showFeedback(kind, `${groupLabel(kind)} order saved.`, "notice", 7000);
    } catch (requestError) {
      showFeedback(kind, requestError instanceof Error ? requestError.message : "Actor order could not be saved.", "error");
      await loadActors().catch(() => replaceActors(dragOriginalRef.current));
    } finally {
      setOrderingKind(null);
    }
  }

  function finishDrag() {
    if (!dragCommittedRef.current) replaceActors(dragOriginalRef.current);
    draggedIdRef.current = "";
    draggedKindRef.current = null;
    setDraggedId("");
  }

  const actorGroups = ACTOR_KINDS
    .map((kind) => ({ kind, actors: actors.filter((actor) => actor.kind === kind) }))
    .filter((group) => group.actors.length > 0 || feedbackByKind[group.kind]);

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
          <p>Edit REST endpoints, remove actors, or drag rows into the precedence order CoralConsole should retain within each actor type.</p>
        </div>

        {pageError && <p className="page-alert actor-list-page-alert" role="alert">{pageError}</p>}
        {loading ? <p className="empty-audit">Loading actors…</p> : !actors.length && actorGroups.length === 0
          ? <p className="empty-audit">No actors have been added to CoralConsole.</p>
          : (
            <div className="actor-list-groups">
              {actorGroups.map(({ kind, actors: groupActors }) => {
                const feedback = feedbackByKind[kind];
                const headingId = `actor-list-${kind}`;
                const GroupIcon = ACTOR_META[kind].icon;
                return (
                  <section className={`actor-list-group actor-${kind}`} key={kind}>
                    <div className="actor-list-group-heading">
                      <div className="actor-list-group-identity">
                        <span className="actor-avatar actor-list-group-icon" aria-hidden="true"><GroupIcon /></span>
                        <div className="actor-list-group-title">
                          <p className="eyebrow">Actor type</p>
                          <div>
                            <h2 id={headingId}>{groupLabel(kind)}</h2>
                            <span className="actor-list-group-count" aria-label={`${groupActors.length} ${groupActors.length === 1 ? "actor" : "actors"}`}>{groupActors.length}</span>
                          </div>
                        </div>
                      </div>
                      <div className="actor-list-feedback">
                        {feedback?.tone === "error" && <p className="page-alert actor-list-alert" role="alert">{feedback.message}</p>}
                        {feedback?.tone === "notice" && <p className={`actor-list-notice${feedback.fading ? " actor-list-notice-fading" : ""}`} role="status">{feedback.message}</p>}
                      </div>
                      <button className="actor-list-add-button" type="button" onClick={() => openAddActor(kind)}><span aria-hidden="true">＋</span>Add Actor</button>
                    </div>

                    <div className="actor-list-table-wrap" aria-labelledby={headingId} aria-busy={orderingKind === kind}>
                      {groupActors.length === 0 ? <p className="empty-audit">No actors of this type remain.</p> : (
                        <table className="actor-list-table">
                          <colgroup>
                            <col className="actor-list-col-name" />
                            <col className="actor-list-col-class" />
                            <col className="actor-list-col-host" />
                            <col className="actor-list-col-port" />
                            <col className="actor-list-col-status" />
                            <col className="actor-list-col-edit" />
                            <col className="actor-list-col-remove" />
                          </colgroup>
                          <thead>
                            <tr><th>Name</th><th>Class</th><th>REST IP</th><th>PORT</th><th>Online?</th><th>Edit</th><th>Remove</th></tr>
                          </thead>
                          <tbody>
                            {groupActors.map((actor) => {
                              const editing = editingId === actor.id;
                              const saving = savingId === actor.id;
                              return (
                                <tr
                                  key={actor.id}
                                  draggable={!editingId && !orderingKind}
                                  className={draggedId === actor.id ? "actor-list-row-dragging" : ""}
                                  onDragStart={(event) => beginDrag(event, actor)}
                                  onDragOver={(event) => moveDraggedActor(event, actor)}
                                  onDrop={(event) => void saveOrder(event, kind)}
                                  onDragEnd={finishDrag}
                                >
                                  <td data-label="Name">
                                    <span className="actor-list-endpoint">
                                      <span className="actor-drag-handle" title={`Drag to reorder within ${groupLabel(kind)}`} aria-label={`Drag ${actor.name} to reorder within ${groupLabel(kind)}`}><GripVertical aria-hidden="true" /></span>
                                      <strong>{actor.name}</strong>
                                    </span>
                                  </td>
                                  <td data-label="Class"><code>{actor.className}</code></td>
                                  <td data-label="REST IP">{editing
                                    ? <input aria-label={`${actor.name} REST IP`} value={draftHost} onChange={(event) => setDraftHost(event.target.value)} onKeyDown={(event) => handleEditKey(event, actor)} autoFocus />
                                    : <code>{actor.host}</code>}</td>
                                  <td data-label="PORT">{editing
                                    ? <input aria-label={`${actor.name} REST port`} inputMode="numeric" value={draftPort} onChange={(event) => setDraftPort(event.target.value)} onKeyDown={(event) => handleEditKey(event, actor)} />
                                    : <code>{actor.port}</code>}</td>
                                  <td data-label="Online?"><span className={`actor-list-status status-${actor.status}`}><i />{statusLabel(actor.status)}</span></td>
                                  <td data-label="Edit">{editing ? <span className="actor-list-edit-actions">
                                    <button type="button" onClick={() => void saveEndpoint(actor)} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                                    <button type="button" onClick={cancelEditing} disabled={saving}>Cancel</button>
                                  </span> : <button className="actor-list-edit-button" type="button" onClick={() => startEditing(actor)} disabled={Boolean(editingId) || actor.demo}>{actor.demo ? "Sample" : "Edit"}</button>}</td>
                                  <td data-label="Remove"><button className="actor-list-remove-button" type="button" onClick={() => void removeActor(actor)} disabled={Boolean(editingId) || Boolean(removingId) || actor.demo}>{removingId === actor.id ? "Removing…" : actor.demo ? "Sample" : "Remove"}</button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
      </section>

      {addKind && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAddActor(); }}>
          <section className={`add-modal actor-${addKind}`} role="dialog" aria-modal="true" aria-labelledby="actor-list-add-title">
            <button className="modal-close" type="button" onClick={closeAddActor} aria-label="Close add actor dialog">×</button>
            <p className="eyebrow">Add to {groupLabel(addKind)}</p>
            <h2 id="actor-list-add-title">Connect an actor</h2>
            <p>Enter the actor’s network address. The server will discover its role and actions, then place it in the appropriate actor table.</p>
            <div className="actor-type-list" aria-label="Supported actor types">{ACTOR_KINDS.filter((kind) => kind !== "link").map((kind) => <span className={kind === addKind ? "selected" : ""} key={kind}>{ACTOR_META[kind].label}</span>)}</div>
            <form onSubmit={addActor}>
              <label htmlFor="actor-list-host">IP address or host</label>
              <input id="actor-list-host" value={connectHost} onChange={(event) => setConnectHost(event.target.value)} placeholder="10.42.0.10" autoFocus />
              <label htmlFor="actor-list-port">REST admin port</label>
              <input id="actor-list-port" value={connectPort} onChange={(event) => setConnectPort(event.target.value)} inputMode="numeric" placeholder="30001" />
              {connectError && <p className="form-error" role="alert">{connectError}</p>}
              <div className="modal-actions">
                <button className="button button-ghost" type="button" onClick={closeAddActor} disabled={connecting}>Cancel</button>
                <button className="button button-primary" type="submit" disabled={connecting}>{connecting ? "Discovering…" : "Discover actor"}</button>
              </div>
            </form>
            <div className="privacy-note"><span aria-hidden="true">⌂</span><p><strong>Shared internal configuration</strong>The actor is contacted by this server and stored in its SQLite database.</p></div>
          </section>
        </div>
      )}
    </main>
  );
}
