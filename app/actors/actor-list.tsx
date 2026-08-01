"use client";

import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { AddActorDialog } from "../add-actor-dialog";
import { ACTOR_KINDS, ACTOR_META, statusLabel, type Actor, type ActorKind } from "../actor-ui";
import { ConsoleBrand } from "../console-chrome";
import type { ActorDiscoveryResult, TopologySettings } from "@/lib/types";

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

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
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<ActorKind | null>(null);

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

  function openAddActor(kind: ActorKind | null = null) {
    setAddKind(kind);
    setAddOpen(true);
  }

  function closeAddActor() {
    setAddOpen(false);
    setAddKind(null);
  }

  function actorsDiscovered(payload: ActorDiscoveryResult) {
    const discoveredIds = new Set(payload.actors.map((actor) => actor.id));
    replaceActors([...actorsRef.current.filter((actor) => !discoveredIds.has(actor.id)), ...payload.actors]);
    const actorsByKind = new Map<ActorKind, Actor[]>();
    payload.actors.forEach((actor) => actorsByKind.set(actor.kind, [...(actorsByKind.get(actor.kind) || []), actor]));
    let firstFeedback = true;
    for (const [kind, addedActors] of actorsByKind) {
      const names = addedActors.map((actor) => actor.name).join(", ");
      const duplicateNote = firstFeedback && payload.duplicateAccounts.length
        ? ` Already present: ${payload.duplicateAccounts.join(", ")}.`
        : "";
      showFeedback(
        kind,
        `${names} ${addedActors.length === 1 ? "was" : "were"} added to CoralConsole.${duplicateNote}`,
        "notice",
        7000,
      );
      firstFeedback = false;
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
        <ConsoleBrand ariaLabel="CoralConsole actor list" subtitle="Actor registry" />
      </header>

      <section className="actor-list-main">
        <div className="actor-list-title">
          <div className="actor-list-title-heading">
            <div>
              <p className="eyebrow">Shared topology registry</p>
              <h1>List Actors</h1>
            </div>
            <button className="actor-list-global-add-button" type="button" onClick={() => openAddActor()}><span aria-hidden="true">＋</span>Add Actor</button>
          </div>
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

      <AddActorDialog open={addOpen} onClose={closeAddActor} onDiscovered={actorsDiscovered} preferredKind={addKind} />
    </main>
  );
}
