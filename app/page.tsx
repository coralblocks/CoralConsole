"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ACTOR_KINDS,
  ACTOR_META,
  operationalStateForDisplay,
  operationalStateLabel,
  statusLabel,
  type Actor,
  type ActorKind,
  type ActorOperationalState,
} from "./actor-ui";
import { sessionStartFromId } from "@/lib/session";
import { SUMMARY_ACTOR_KINDS, type SummaryActorKind, type TopologySettings } from "@/lib/types";

const LEGACY_ACTORS_KEY = "coral-console-actors";
const BrandIcon = ACTOR_META.sequencer.icon;
const ACTOR_FILTERS = [
  "all",
  "online",
  "offline",
  "closed",
  "rewinding",
  "active",
  "inactive",
  "disconnected",
] as const;
type ActorFilter = typeof ACTOR_FILTERS[number];
const PULSE_OPERATIONAL_STATES: ActorOperationalState[] = [
  "closed",
  "rewinding",
  "active",
  "inactive",
  "disconnected",
];

function actorCountLabel(count: number, state: string) {
  return `${count} ${count === 1 ? "Actor" : "Actors"} ${state}`;
}

function actorNoun(count: number) {
  return count === 1 ? "actor" : "actors";
}

const GROUPS: { id: string; kinds: ActorKind[]; eyebrow: string; title: string }[] = [
  { id: "replayer", kinds: ["replayer"], eyebrow: "Replayer Fabric", title: "Replayers" },
  { id: "persistence", kinds: ["archiver", "logger"], eyebrow: "Persistence & audit", title: "Archiver · Logger" },
  {
    id: "transport",
    kinds: ["bridge", "dispatcher", "multimqapp"],
    eyebrow: "Transport layer",
    title: "Bridge · Dispatcher · MultiMqApp",
  },
  { id: "customer", kinds: ["node", "application"], eyebrow: "Application Layer", title: "Nodes · Applications" },
];

function actorsInPanelOrder(source: Actor[], kinds: ActorKind[]) {
  const kindOrder = new Map(kinds.map((kind, index) => [kind, index]));
  return source
    .filter((actor) => kindOrder.has(actor.kind))
    .sort((left, right) => {
      const kindDifference = kindOrder.get(left.kind)! - kindOrder.get(right.kind)!;
      if (kindDifference) return kindDifference;
      return (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
    });
}

function ActorGroupCountLink({ count, label }: { count: number; label: string }) {
  return (
    <a
      className="group-count-link"
      href="/actors"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Edit ${label} actors (opens in a new tab)`}
    >
      {count}
    </a>
  );
}

const DEFAULT_SETTINGS: TopologySettings = {
  topologyName: "Coral topology",
  backgroundColor: "#f4f1e9",
  pollIntervalSeconds: 5,
  keepPollingWithoutViewers: false,
  viewerGracePeriodSeconds: 90,
  auditRetentionDays: 90,
  summaryActorKinds: [...SUMMARY_ACTOR_KINDS],
  setupComplete: false,
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload;
}

function normalizeSavedActors(value: unknown): Actor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const legacy = entry as Omit<Actor, "kind" | "status" | "actions"> & {
      actions?: string[];
      commands?: string[];
      kind: string;
      status: string;
      statusRespondedAt?: string;
    };
    if (typeof legacy.name !== "string" || typeof legacy.host !== "string" || !Number.isInteger(Number(legacy.port))) return [];
    const wasBackup = legacy.kind === "backup"
      || legacy.kind === "backup-sequencer"
      || (legacy.kind === "sequencer" && (legacy.sequencerRole === "Backup" || legacy.status === "standby"));
    const kind = wasBackup
      ? "backup-sequencer"
      : ACTOR_KINDS.includes(legacy.kind as ActorKind) ? legacy.kind as ActorKind : "node";
    return [{
      ...legacy,
      actions: Array.isArray(legacy.actions) ? legacy.actions : Array.isArray(legacy.commands) ? legacy.commands : [],
      commands: undefined,
      kind,
      port: Number(legacy.port),
      status: legacy.status === "online" || legacy.status === "standby" || legacy.status === "healthy"
        ? "online"
        : "offline",
      operationalState: (["closed", "disconnected", "rewinding", "active", "inactive"] as ActorOperationalState[])
        .includes(legacy.operationalState)
        ? legacy.operationalState
        : "inactive",
      outboundSequence: legacy.outboundSequence || "Not reported",
      accounts: legacy.accounts || "Not reported",
      clockTickInterval: legacy.clockTickInterval || "Not reported",
      actorStatusFields: Array.isArray(legacy.actorStatusFields) ? legacy.actorStatusFields : [],
      actorStatusRespondedAt: legacy.actorStatusRespondedAt || legacy.statusRespondedAt,
      sequencerRole: kind === "sequencer" ? "Primary" : kind === "backup-sequencer" ? "Backup" : undefined,
      sessionStarted: legacy.sessionStarted || sessionStartFromId(legacy.session),
    }];
  });
}

function ActorCard({ actor }: { actor: Actor }) {
  const meta = ACTOR_META[actor.kind];
  const Icon = meta.icon;
  const displayedState = operationalStateForDisplay(actor.status, actor.operationalState);
  const displayedSequence = actor.status === "offline" ? "?" : actor.outboundSequence;
  return (
    <a
      className={`actor-card actor-${actor.kind}${actor.status === "offline" ? " actor-card-offline" : ""}`}
      href={`/actor/${encodeURIComponent(actor.id)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${actor.name} details, ${statusLabel(actor.status)} (opens in a new tab)`}
    >
      <span className="actor-card-head">
        <span className="actor-avatar" aria-hidden="true"><Icon /></span>
        <span className="actor-heading">
          <span className="actor-name-line">
            <strong>{actor.name}</strong>
            <span className="actor-card-sequence" aria-label={`Sequence ${displayedSequence}`} title="Sequence">{displayedSequence}</span>
          </span>
          <small>{actor.className}</small>
        </span>
        <span className="actor-card-status">
          <span className={`actor-state-badge state-${displayedState}`}>{operationalStateLabel(displayedState)}</span>
        </span>
      </span>
    </a>
  );
}

export default function Home() {
  const [actors, setActors] = useState<Actor[]>([]);
  const [settings, setSettings] = useState<TopologySettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<TopologySettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [pageError, setPageError] = useState("");
  const [introVisible, setIntroVisible] = useState(true);
  const [filter, setFilter] = useState<ActorFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("30001");
  const [connectError, setConnectError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [legacyActors, setLegacyActors] = useState<Actor[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const filterBarRef = useRef<HTMLDivElement>(null);

  const positionFilterIndicator = useCallback(() => {
    const filterBar = filterBarRef.current;
    const selectedButton = filterBar?.querySelector<HTMLButtonElement>("button.active");
    if (!filterBar || !selectedButton) return;
    filterBar.style.setProperty("--filter-indicator-x", `${selectedButton.offsetLeft}px`);
    filterBar.style.setProperty("--filter-indicator-y", `${selectedButton.offsetTop}px`);
    filterBar.style.setProperty("--filter-indicator-width", `${selectedButton.offsetWidth}px`);
    filterBar.style.setProperty("--filter-indicator-height", `${selectedButton.offsetHeight}px`);
    filterBar.dataset.indicatorReady = "true";
  }, []);

  useEffect(() => {
    positionFilterIndicator();
    const filterBar = filterBarRef.current;
    if (!filterBar) return;
    const resizeObserver = new ResizeObserver(positionFilterIndicator);
    resizeObserver.observe(filterBar);
    filterBar.querySelectorAll("button").forEach((button) => resizeObserver.observe(button));
    return () => resizeObserver.disconnect();
  }, [filter, positionFilterIndicator]);

  const loadWorkspace = useCallback(async () => {
    const [settingsPayload, actorsPayload] = await Promise.all([
      apiRequest<{ settings: TopologySettings }>("/api/settings", { cache: "no-store" }),
      apiRequest<{ actors: Actor[] }>("/api/actors", { cache: "no-store" }),
    ]);
    setSettings(settingsPayload.settings);
    setSettingsDraft(settingsPayload.settings);
    setActors(actorsPayload.actors);
    if (!settingsPayload.settings.setupComplete) setSettingsOpen(true);
  }, []);

  useEffect(() => {
    let active = true;
    const hydration = window.setTimeout(() => {
      void loadWorkspace()
        .catch((error) => { if (active) setPageError(error instanceof Error ? error.message : "Could not load this topology."); })
        .finally(() => { if (active) setReady(true); });
      try {
        if (window.localStorage.getItem("coral-console-intro") === "hidden") setIntroVisible(false);
        const saved = window.localStorage.getItem(LEGACY_ACTORS_KEY);
        if (saved) setLegacyActors(normalizeSavedActors(JSON.parse(saved)).filter((actor) => !actor.demo));
      } catch {
        window.localStorage.removeItem(LEGACY_ACTORS_KEY);
      }
    }, 0);
    return () => { active = false; window.clearTimeout(hydration); };
  }, [loadWorkspace]);

  const refreshActors = useCallback(async (force = false) => {
    if (document.visibilityState !== "visible" && !force) return;
    setRefreshing(true);
    try {
      const payload = await apiRequest<{ actors: Actor[] }>("/api/actors/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      setActors(payload.actors);
      setPageError("");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Actor refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !settings.setupComplete) return;
    const timer = window.setInterval(() => void refreshActors(false), settings.pollIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [ready, refreshActors, settings.pollIntervalSeconds, settings.setupComplete]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAddOpen(false);
      if (settings.setupComplete) setSettingsOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settings.setupComplete]);

  const visibleActors = useMemo(() => {
    if (filter === "all") return actors;
    if (filter === "online" || filter === "offline") {
      return actors.filter((actor) => actor.status === filter);
    }
    return actors.filter((actor) => operationalStateForDisplay(actor.status, actor.operationalState) === filter);
  }, [actors, filter]);
  const onlineCount = actors.filter((actor) => actor.status === "online").length;
  const offlineCount = actors.filter((actor) => actor.status === "offline").length;
  const pulseConnectivityFilter: ActorFilter = !actors.length ? "all" : offlineCount ? "offline" : "online";
  const operationalStateCounts = Object.fromEntries(PULSE_OPERATIONAL_STATES.map((state) => [
    state,
    actors.filter((actor) => operationalStateForDisplay(actor.status, actor.operationalState) === state).length,
  ])) as Record<ActorOperationalState, number>;
  const disconnectedCount = operationalStateCounts.disconnected;
  const connectedCount = onlineCount - disconnectedCount - operationalStateCounts.closed;
  const primarySequencers = actorsInPanelOrder(visibleActors, ["sequencer"]);
  const backupSequencers = actorsInPanelOrder(visibleActors, ["backup-sequencer"]);
  const sessionSequencer = actors.find((actor) => actor.kind === "sequencer" && actor.status === "online")
    || actors.find((actor) => actor.kind === "sequencer");
  const visibleSummaryKinds = SUMMARY_ACTOR_KINDS.filter((kind) => settings.summaryActorKinds.includes(kind));

  function toggleSummaryActorKind(kind: SummaryActorKind) {
    setSettingsDraft((current) => {
      const selected = new Set(current.summaryActorKinds);
      if (selected.has(kind)) selected.delete(kind);
      else selected.add(kind);
      return {
        ...current,
        summaryActorKinds: SUMMARY_ACTOR_KINDS.filter((candidate) => selected.has(candidate)),
      };
    });
  }

  function toggleIntro() {
    setIntroVisible((current) => {
      const next = !current;
      window.localStorage.setItem("coral-console-intro", next ? "visible" : "hidden");
      return next;
    });
  }

  async function addActor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnectError("");
    const numericPort = Number(port);
    if (!host.trim() || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setConnectError("Enter a host and a valid REST admin port.");
      return;
    }
    setConnecting(true);
    try {
      const payload = await apiRequest<{ actor: Actor }>("/api/actors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: host.trim(), port: numericPort }),
      });
      setActors((current) => [...current.filter((actor) => actor.id !== payload.actor.id), payload.actor]);
      setHost("");
      setPort("30001");
      setAddOpen(false);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Could not reach this actor.");
    } finally {
      setConnecting(false);
    }
  }

  async function saveTopologySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsError("");
    setSavingSettings(true);
    try {
      const payload = await apiRequest<{ settings: TopologySettings }>("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settingsDraft, setupComplete: true }),
      });
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function importLocalActors() {
    setImporting(true);
    let imported = 0;
    const remaining: Actor[] = [];
    for (const legacy of legacyActors) {
      try {
        await apiRequest<{ actor: Actor }>("/api/actors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host: legacy.host, port: legacy.port }),
        });
        imported += 1;
      } catch (error) {
        if (error instanceof Error && /already exists/i.test(error.message)) imported += 1;
        else remaining.push(legacy);
      }
    }
    if (remaining.length) window.localStorage.setItem(LEGACY_ACTORS_KEY, JSON.stringify(remaining));
    else window.localStorage.removeItem(LEGACY_ACTORS_KEY);
    setLegacyActors(remaining);
    setImportMessage(`${imported} actor${imported === 1 ? "" : "s"} moved to the shared topology${remaining.length ? `; ${remaining.length} could not be reached` : ""}.`);
    await loadWorkspace().catch(() => undefined);
    setImporting(false);
  }

  const themeStyle = { "--topology-color": settings.backgroundColor } as CSSProperties;

  return (
    <main className="console-shell" style={themeStyle}>
      <header className="topbar">
        <a className="brand" href="#topology" aria-label="CoralConsole home">
          <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
          <span><strong>CoralConsole</strong><small>The Ops Console for CoralSequencer</small></span>
        </a>
        <div className="topbar-actions">
          <span className="environment" title="Shared topology"><i /> {settings.topologyName}</span>
          <Link className="intro-toggle nav-link" href="/audit" target="_blank" rel="noopener noreferrer">Audit</Link>
          <button className="intro-toggle" type="button" onClick={() => { setSettingsDraft(settings); setSettingsOpen(true); }}>Settings</button>
          <button className="intro-toggle" type="button" onClick={toggleIntro} aria-expanded={introVisible} aria-controls="console-intro">
            {introVisible ? "Hide intro" : "Show intro"}
          </button>
          <button className="button button-primary" type="button" onClick={() => setAddOpen(true)}><span aria-hidden="true">＋</span><span className="button-label">Add actor</span></button>
        </div>
      </header>

      <section className="hero" id="console-intro" aria-labelledby="page-title" hidden={!introVisible}>
        <div>
          <p className="eyebrow">Distributed system · Live topology</p>
          <h1 id="page-title">Every actor.<br /><em>One clear picture.</em></h1>
          <p className="hero-copy">See the sequencer at the center of your system, follow every connection, and run admin actions without leaving the map.</p>
        </div>
      </section>

      {(legacyActors.length > 0 || importMessage) && (
        <section className="import-banner" aria-live="polite">
          <div><strong>{importMessage || `${legacyActors.length} actor${legacyActors.length === 1 ? " was" : "s were"} saved in this browser.`}</strong><span>{importMessage ? "" : "Move them into the shared SQLite topology so everyone sees the same configuration."}</span></div>
          {legacyActors.length > 0 && <button className="button button-dark compact" type="button" onClick={() => void importLocalActors()} disabled={importing}>{importing ? "Importing…" : "Import local actors"}</button>}
        </section>
      )}

      {pageError && <p className="page-alert" role="alert">{pageError}</p>}

      <section className={`system-overview${visibleSummaryKinds.length ? "" : " summary-counts-hidden"}`} aria-label="System summary">
        {visibleSummaryKinds.length > 0 && <div
          className="actor-summary"
          aria-label="Actor type counts"
          style={{ "--summary-columns": Math.min(3, visibleSummaryKinds.length) } as CSSProperties}
        >
          {visibleSummaryKinds.map((kind) => {
            const count = actors.filter((actor) => actor.kind === kind).length;
            const Icon = ACTOR_META[kind].icon;
            return (
              <div className={`actor-metric actor-${kind}`} key={kind} aria-label={`${count} ${ACTOR_META[kind].summaryLabel}`}>
                <span className="actor-type-icon" aria-hidden="true"><Icon /></span>
                <p><strong>{count}</strong><small>{ACTOR_META[kind].summaryLabel}</small></p>
              </div>
            );
          })}
        </div>}
        <aside className="pulse-panel" id="system-pulse" aria-label="System Pulse">
          <div className="pulse-heading">
            <a className="health-orbit" href="#system-pulse" aria-label="Jump to System Pulse" aria-controls="topology" onClick={() => setFilter("all")}><span /><span /><span /></a>
            <div className="pulse-copy">
              <small>System Pulse</small>
              <button
                className="pulse-summary pulse-summary-button"
                type="button"
                aria-controls="topology"
                aria-pressed={filter === pulseConnectivityFilter}
                onClick={() => setFilter(pulseConnectivityFilter)}
              >
                <strong>{offlineCount ? actorCountLabel(offlineCount, "Offline") : actors.length ? "All Actors Online" : "Waiting for Actors"}</strong>
                <span>{onlineCount} of {actors.length} {actorNoun(actors.length)} online in the console</span>
              </button>
              <button
                className="pulse-summary pulse-summary-button pulse-summary-sequencer"
                type="button"
                aria-controls="topology"
                aria-pressed={filter === "disconnected"}
                onClick={() => setFilter("disconnected")}
              >
                <strong>{actorCountLabel(disconnectedCount, "Disconnected")}</strong>
                <span>{connectedCount} of {actors.length} {actorNoun(actors.length)} connected to the sequencer</span>
              </button>
            </div>
          </div>
          <div className="pulse-counts" aria-label="Actor connectivity and operational state counts">
            <button className="pulse-count status-online" type="button" aria-label={`${onlineCount} Online`} aria-controls="topology" aria-pressed={filter === "online"} onClick={() => setFilter("online")}><span><i /><strong>{onlineCount}</strong></span><small>ONLINE</small></button>
            <button className="pulse-count status-offline" type="button" aria-label={`${offlineCount} Offline`} aria-controls="topology" aria-pressed={filter === "offline"} onClick={() => setFilter("offline")}><span><i /><strong>{offlineCount}</strong></span><small>OFFLINE</small></button>
            <span className="pulse-count-divider" aria-hidden="true" />
            {PULSE_OPERATIONAL_STATES.map((state) => (
              <button
                className={`pulse-count state-${state}`}
                type="button"
                key={state}
                aria-label={`${operationalStateCounts[state]} ${operationalStateLabel(state)}`}
                aria-controls="topology"
                aria-pressed={filter === state}
                onClick={() => setFilter(state)}
              >
                <span><i /><strong>{operationalStateCounts[state]}</strong></span>
                <small>{operationalStateLabel(state)}</small>
              </button>
            ))}
          </div>
          <div className="pulse-footer">
            <button
              className="pulse-total"
              type="button"
              aria-label={`Show all ${actors.length} ${actorNoun(actors.length)} in the Actor Map`}
              aria-controls="topology"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              <small>Total actors</small>
              <strong>{actors.length}</strong>
              <span>Added to CoralConsole</span>
            </button>
            <div className="pulse-session">
              <small>Active session</small>
              <strong>{sessionSequencer?.session || "Not discovered"}</strong>
              {sessionSequencer?.sessionStarted && <span>Started {sessionSequencer.sessionStarted}</span>}
            </div>
          </div>
        </aside>
      </section>

      <section className="workspace" id="topology">
        <div className="topology-panel">
          <div className="section-heading topology-heading">
            <div><p className="eyebrow">Topology</p><h2>Actor Map</h2></div>
            <div className="topology-heading-actions">
              <button className="button button-ghost" type="button" onClick={() => setAddOpen(true)}>＋ Add Actor</button>
              <Link className="button button-ghost" href="/actors" target="_blank" rel="noopener noreferrer">List Actors</Link>
              <button
                className="button button-ghost refresh-button"
                type="button"
                onClick={() => void refreshActors(true)}
                disabled={refreshing || !actors.length}
                title="Immediately poll actorStatus and list for every actor"
              >
                {refreshing ? "Refreshing…" : "Refresh Now"}
              </button>
            </div>
            <div className="filters" aria-label="Filter actors" ref={filterBarRef}>
              <span className="filter-selection-indicator" aria-hidden="true" />
              {ACTOR_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`${filter === value ? "active" : ""}${value === "online" || value === "closed" ? " filter-section-start" : ""}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === "all"
                    ? "All Actors"
                    : value === "online" || value === "offline"
                      ? statusLabel(value)
                      : operationalStateLabel(value)}
                </button>
              ))}
            </div>
          </div>

          <div className="topology-canvas">
            {!ready && <p className="workspace-loading">Loading shared topology…</p>}
            <div className="actor-groups">
              <section className="actor-group group-sequencer sequencer-primary" aria-labelledby="group-sequencer-primary">
                <div className="group-heading"><div><p>Sequencer Fabric</p><h3 id="group-sequencer-primary">Primary Sequencer</h3></div><ActorGroupCountLink count={primarySequencers.length} label="Primary Sequencer" /></div>
                <div className="group-cards">{primarySequencers.map((actor) => <ActorCard key={actor.id} actor={actor} />)}{!primarySequencers.length && <p className="empty-group">No primary sequencer matches this filter.</p>}</div>
              </section>
              <section className="actor-group group-backup-sequencer sequencer-backups" aria-labelledby="group-sequencer-backups">
                <div className="group-heading"><div><p>Sequencer Fabric</p><h3 id="group-sequencer-backups">Backup Sequencers</h3></div><ActorGroupCountLink count={backupSequencers.length} label="Backup Sequencer" /></div>
                <div className="group-cards">{backupSequencers.map((actor) => <ActorCard key={actor.id} actor={actor} />)}{!backupSequencers.length && <p className="empty-group">No backup sequencers match this filter.</p>}</div>
              </section>
              {GROUPS.map((group) => {
                const grouped = actorsInPanelOrder(visibleActors, group.kinds);
                return (
                  <section className={`actor-group group-${group.id}`} key={group.id} aria-labelledby={`group-${group.id}`}>
                    <div className="group-heading"><div><p>{group.eyebrow}</p><h3 id={`group-${group.id}`}>{group.title}</h3></div><ActorGroupCountLink count={grouped.length} label={group.eyebrow} /></div>
                    <div className="group-cards">{grouped.map((actor) => <ActorCard key={actor.id} actor={actor} />)}{!grouped.length && <p className="empty-group">No matching actors</p>}</div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <footer className="console-footer"><p><span className="brand-mark mini" aria-hidden="true"><BrandIcon /></span> CoralConsole</p><p>Shared topology · Persisted in SQLite</p></footer>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <section className="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <button className="modal-close" type="button" onClick={() => setAddOpen(false)} aria-label="Close add actor dialog">×</button>
            <p className="eyebrow">Auto-discovery</p><h2 id="add-title">Connect an actor</h2>
            <p>Enter the actor’s network address. The server will discover its role and actions, then save it for everyone using this console.</p>
            <div className="actor-type-list" aria-label="Supported actor types">{ACTOR_KINDS.filter((kind) => kind !== "link").map((kind) => <span key={kind}>{ACTOR_META[kind].label}</span>)}</div>
            <form onSubmit={addActor}>
              <label htmlFor="host">IP address or host</label><input id="host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="10.42.0.10" autoFocus />
              <label htmlFor="port">REST admin port</label><input id="port" value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" placeholder="30001" />
              {connectError && <p className="form-error" role="alert">{connectError}</p>}
              <div className="modal-actions"><button className="button button-ghost" type="button" onClick={() => setAddOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={connecting}>{connecting ? "Discovering…" : "Discover actor"}</button></div>
            </form>
            <div className="privacy-note"><span aria-hidden="true">⌂</span><p><strong>Shared internal configuration</strong>The actor is contacted by this server and stored in its SQLite database.</p></div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && settings.setupComplete) setSettingsOpen(false); }}>
          <section className="add-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            {settings.setupComplete && <button className="modal-close" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings dialog">×</button>}
            <p className="eyebrow">{settings.setupComplete ? "Shared settings" : "First-run setup"}</p><h2 id="settings-title">Name this topology</h2>
            <p>These settings apply to every person who opens this CoralConsole installation.</p>
            <form onSubmit={saveTopologySettings}>
              <label htmlFor="topology-name">Topology name</label><input id="topology-name" value={settingsDraft.topologyName} onChange={(event) => setSettingsDraft((current) => ({ ...current, topologyName: event.target.value }))} autoFocus />
              <label htmlFor="background-color">Workspace color</label><div className="color-input"><input id="background-color" type="color" value={settingsDraft.backgroundColor} onChange={(event) => setSettingsDraft((current) => ({ ...current, backgroundColor: event.target.value }))} /><code>{settingsDraft.backgroundColor}</code></div>
              <div className="settings-grid">
                <div><label htmlFor="poll-interval">Actor polling interval (seconds)</label><input id="poll-interval" type="number" min="1" max="300" value={settingsDraft.pollIntervalSeconds} onChange={(event) => setSettingsDraft((current) => ({ ...current, pollIntervalSeconds: Number(event.target.value) }))} /></div>
                <div><label htmlFor="audit-retention">Audit retention (days)</label><input id="audit-retention" type="number" min="1" max="3650" value={settingsDraft.auditRetentionDays} onChange={(event) => setSettingsDraft((current) => ({ ...current, auditRetentionDays: Number(event.target.value) }))} /></div>
              </div>
              <fieldset className="polling-settings">
                <legend>Polling without viewers</legend>
                <label className="polling-option">
                  <input
                    type="checkbox"
                    checked={settingsDraft.keepPollingWithoutViewers}
                    onChange={(event) => setSettingsDraft((current) => ({ ...current, keepPollingWithoutViewers: event.target.checked }))}
                  />
                  <span><strong>Keep polling actors when nobody is viewing CoralConsole</strong><small>When disabled, server-side polling pauses after the last browser tab stops reporting presence.</small></span>
                </label>
                <div className="grace-period-setting">
                  <label htmlFor="viewer-grace-period">Stop polling after no viewers (seconds)</label>
                  <input id="viewer-grace-period" type="number" min="5" max="3600" value={settingsDraft.viewerGracePeriodSeconds} disabled={settingsDraft.keepPollingWithoutViewers} onChange={(event) => setSettingsDraft((current) => ({ ...current, viewerGracePeriodSeconds: Number(event.target.value) }))} />
                </div>
              </fieldset>
              <fieldset className="summary-settings">
                <legend>Summary counts</legend>
                <p>Choose which actor types appear in the count panel. Actors remain visible everywhere else.</p>
                <div className="summary-kind-options">
                  {SUMMARY_ACTOR_KINDS.map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={settingsDraft.summaryActorKinds.includes(kind)}
                        onChange={() => toggleSummaryActorKind(kind)}
                      />
                      <span>{ACTOR_META[kind].summaryLabel}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {settingsError && <p className="form-error" role="alert">{settingsError}</p>}
              <div className="modal-actions">{settings.setupComplete && <button className="button button-ghost" type="button" onClick={() => setSettingsOpen(false)}>Cancel</button>}<button className="button button-primary" type="submit" disabled={savingSettings}>{savingSettings ? "Saving…" : settings.setupComplete ? "Save settings" : "Start CoralConsole"}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
