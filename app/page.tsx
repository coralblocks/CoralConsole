"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTOR_KINDS,
  ACTOR_META,
  callActor,
  saveActorSnapshot,
  statusLabel,
  type Actor,
  type ActorKind,
  type ActorStatus,
} from "./actor-ui";

const SUMMARY_KINDS = ACTOR_KINDS.filter((kind) => kind !== "link");

const DEMO_ACTORS: Actor[] = [
  {
    id: "demo-seq-01",
    name: "SEQ-NYC-01",
    kind: "sequencer",
    status: "online",
    host: "10.42.0.10",
    port: 30001,
    account: "production",
    className: "Sequencer",
    sequencerRole: "Primary",
    latency: "3.4 μs",
    session: "2607171725",
    sessionStarted: "17 Jul 2026 · 17:25",
    lastSeen: "just now",
    commands: ["status", "showAccounts", "rollSession", "setThrottleMaxCommands", "list"],
    demo: true,
  },
  {
    id: "demo-backup-01",
    name: "SEQ-NYC-02",
    kind: "backup-sequencer",
    status: "standby",
    host: "10.42.0.11",
    port: 30001,
    account: "production",
    className: "Sequencer",
    sequencerRole: "Backup",
    latency: "4.1 μs",
    session: "2607171725",
    sessionStarted: "17 Jul 2026 · 17:25",
    lastSeen: "2s ago",
    commands: ["status", "activate", "showAccounts", "list"],
    demo: true,
  },
  {
    id: "demo-rpl-01",
    name: "RPL-EAST-01",
    kind: "replayer",
    status: "online",
    host: "10.42.1.20",
    port: 30002,
    account: "production",
    className: "NetworkReplayer",
    cluster: "EAST",
    latency: "0 lag",
    session: "caught up",
    lastSeen: "just now",
    commands: ["status", "open", "close", "list"],
    demo: true,
  },
  {
    id: "demo-rpl-02",
    name: "RPL-EAST-02",
    kind: "replayer",
    status: "online",
    host: "10.42.1.21",
    port: 30002,
    account: "production",
    className: "NetworkReplayer",
    cluster: "EAST",
    latency: "0 lag",
    session: "caught up",
    lastSeen: "1s ago",
    commands: ["status", "open", "close", "list"],
    demo: true,
  },
  {
    id: "demo-rpl-03",
    name: "RPL-WEST-01",
    kind: "replayer",
    status: "warning",
    host: "10.42.2.20",
    port: 30002,
    account: "production",
    className: "NetworkReplayer",
    cluster: "WEST",
    latency: "18 msg lag",
    session: "catching up",
    lastSeen: "8s ago",
    commands: ["status", "open", "close", "list"],
    demo: true,
  },
  {
    id: "demo-bridge-01",
    name: "BRIDGE-LDN-01",
    kind: "bridge",
    status: "online",
    host: "10.42.2.30",
    port: 30003,
    account: "production",
    className: "TcpUdpBridge",
    latency: "0 drops",
    session: "linked",
    lastSeen: "just now",
    commands: ["status", "open", "close", "list"],
    demo: true,
  },
  {
    id: "demo-dispatcher-01",
    name: "DISPATCH-01",
    kind: "dispatcher",
    status: "online",
    host: "10.42.2.31",
    port: 30003,
    account: "production",
    className: "SharedMemoryDispatcher",
    latency: "4 lanes",
    session: "dispatching",
    lastSeen: "1s ago",
    commands: ["status", "open", "close", "list"],
    demo: true,
  },
  {
    id: "demo-arc-01",
    name: "ARCHIVE-01",
    kind: "archiver",
    status: "online",
    host: "10.42.3.30",
    port: 30003,
    account: "production",
    className: "SessionArchiver",
    latency: "2.8 TB",
    session: "writing",
    lastSeen: "3s ago",
    commands: ["status", "roll", "list"],
    demo: true,
  },
  {
    id: "demo-logger-01",
    name: "LOGGER-01",
    kind: "logger",
    status: "online",
    host: "10.42.3.31",
    port: 30003,
    account: "production",
    className: "SessionLogger",
    latency: "12 MB/s",
    session: "streaming",
    lastSeen: "2s ago",
    commands: ["status", "roll", "list"],
    demo: true,
  },
  {
    id: "demo-node-01",
    name: "ORDER-GATEWAY",
    kind: "application",
    status: "online",
    host: "10.42.4.41",
    port: 30004,
    account: "trading",
    className: "OrderGatewayNode",
    latency: "1.2M msg",
    session: "subscribed",
    lastSeen: "just now",
    commands: ["status", "warmup", "list"],
    demo: true,
  },
  {
    id: "demo-node-02",
    name: "RISK-ENGINE",
    kind: "application",
    status: "online",
    host: "10.42.4.42",
    port: 30004,
    account: "risk",
    className: "RiskEngineNode",
    latency: "1.2M msg",
    session: "subscribed",
    lastSeen: "1s ago",
    commands: ["status", "reset", "list"],
    demo: true,
  },
  {
    id: "demo-node-03",
    name: "MARKET-DATA",
    kind: "node",
    status: "offline",
    host: "10.42.4.43",
    port: 30004,
    account: "market-data",
    className: "MarketDataNode",
    latency: "—",
    session: "disconnected",
    lastSeen: "12m ago",
    commands: ["status", "list"],
    demo: true,
  },
];

const GROUPS: { id: string; kinds: ActorKind[]; eyebrow: string; title: string }[] = [
  { id: "replayer", kinds: ["replayer"], eyebrow: "Replayer Fabric", title: "Replayers" },
  {
    id: "transport",
    kinds: ["bridge", "dispatcher", "multimqapp"],
    eyebrow: "Transport layer",
    title: "Bridge · Dispatcher · MultiMqApp",
  },
  { id: "persistence", kinds: ["archiver", "logger"], eyebrow: "Persistence & audit", title: "Archiver · Logger" },
  { id: "customer", kinds: ["node", "application"], eyebrow: "Application Layer", title: "Nodes · Applications" },
];

function kindFromDiscovery(scope: string, details: string): ActorKind {
  const signal = `${scope} ${details}`.toLowerCase();
  const compact = signal.replace(/[^a-z0-9]/g, "");
  if (/multimqapp/.test(compact)) return "multimqapp";
  if (/backupsequencer|sequencerbackup/.test(compact)) return "backup-sequencer";
  if (/dispatcher|\bdsp\b/.test(signal)) return "dispatcher";
  if (/replayer|\breplay\b|\brpl\b/.test(signal)) return "replayer";
  if (/archiver|\barchive\b|\barc\b/.test(signal)) return "archiver";
  if (/sequencer|\bseq\b/.test(signal)) return "sequencer";
  if (/bridge|\bbrg\b/.test(signal)) return "bridge";
  if (/logger|\blog\b/.test(signal)) return "logger";
  if (/\blink\b/.test(signal)) return "link";
  if (/application|\bapp\b/.test(signal)) return "application";
  if (/\bnode\b/.test(signal)) return "node";
  return "node";
}

function commandsFromDiscovery(scope: string, details: string) {
  const prefix = `${scope} `;
  return details
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

function classFromDiscovery(scope: string, details: string, kind: ActorKind) {
  const component = details
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${scope}-`) && /Receiver|Publisher|Store|Replayer|Bridge|Dispatcher|Archiver|Application|Node|Logger|Link|MultiMQ|Sequencer/i.test(line));

  if (!component) return ACTOR_META[kind].label;

  const withoutScope = component.slice(scope.length + 1);
  const addressStart = withoutScope.search(/-(?:\d{1,3}\.){3}\d{1,3}:\d+|-[\d.]+$/);
  return addressStart > 0 ? withoutScope.slice(0, addressStart) : withoutScope;
}

function sessionFromStatus(results: string) {
  const labeled = results.match(/\bsession(?:\s+(?:id|name))?\s*[:=]?\s*(\d{10})\b/i);
  return labeled?.[1] || results.match(/\b\d{10}\b/)?.[0] || "Not reported";
}

function sessionStartFromId(session: string) {
  const match = session.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const monthLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  if (!monthLabel) return undefined;
  return `${day} ${monthLabel} 20${year} · ${hour}:${minute}`;
}

function sessionStartFromStatus(results: string, session: string) {
  const explicit = results.match(/\bsession\s+start(?:\s+time)?\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim();
  return explicit || sessionStartFromId(session);
}

function normalizeSavedActors(value: unknown): Actor[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const legacy = entry as Omit<Actor, "kind"> & { kind: string };
    if (typeof legacy.name !== "string" || typeof legacy.host !== "string") return [];

    const wasBackup = legacy.kind === "backup"
      || legacy.kind === "backup-sequencer"
      || (legacy.kind === "sequencer" && (legacy.sequencerRole === "Backup" || legacy.status === "standby"));
    const kind = wasBackup
      ? "backup-sequencer"
      : ACTOR_KINDS.includes(legacy.kind as ActorKind)
        ? legacy.kind as ActorKind
        : "node";

    const status = wasBackup ? "standby" : legacy.status;
    const isSequencer = kind === "sequencer" || kind === "backup-sequencer";
    return [{
      ...legacy,
      kind,
      status,
      sequencerRole: isSequencer ? (kind === "backup-sequencer" ? "Backup" : "Primary") : undefined,
      sessionStarted: legacy.sessionStarted || sessionStartFromId(legacy.session),
    }];
  });
}

function ActorCard({ actor }: { actor: Actor }) {
  const meta = ACTOR_META[actor.kind];
  const Icon = meta.icon;

  return (
    <a
      className={`actor-card actor-${actor.kind}`}
      href={`/actor/${encodeURIComponent(actor.id)}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => saveActorSnapshot(actor)}
      aria-label={`${actor.name} details (opens in a new tab)`}
    >
      <span className="actor-card-head">
        <span className="actor-avatar" aria-hidden="true"><Icon /></span>
        <span className="actor-heading">
          <strong>{actor.name}</strong>
          <small>{actor.className}</small>
        </span>
        <span className={`status-dot status-${actor.status}`} aria-label={statusLabel(actor.status)} />
      </span>
      <span className="actor-data">
        <span><small>REST ADMIN</small>{actor.host}:{actor.port}</span>
        <span><small>{actor.kind === "archiver" ? "STORAGE" : "SIGNAL"}</small>{actor.latency}</span>
      </span>
      <span className="actor-foot">
        <span>{actor.sequencerRole || actor.cluster || actor.account}</span>
        <span>{actor.session}</span>
      </span>
    </a>
  );
}

export default function Home() {
  const [customActors, setCustomActors] = useState<Actor[]>([]);
  const storageReady = useRef(false);
  const [introVisible, setIntroVisible] = useState(true);
  const [filter, setFilter] = useState<"all" | ActorStatus>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("30001");
  const [connectError, setConnectError] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const hydration = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("coral-console-actors");
        storageReady.current = true;
        if (saved) setCustomActors(normalizeSavedActors(JSON.parse(saved)));
        if (window.localStorage.getItem("coral-console-intro") === "hidden") setIntroVisible(false);
      } catch {
        storageReady.current = true;
        window.localStorage.removeItem("coral-console-actors");
      }
    }, 0);

    return () => window.clearTimeout(hydration);
  }, []);

  useEffect(() => {
    if (!storageReady.current) return;
    window.localStorage.setItem("coral-console-actors", JSON.stringify(customActors));
  }, [customActors]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAddOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const actors = useMemo(() => [...DEMO_ACTORS, ...customActors], [customActors]);
  const visibleActors = filter === "all" ? actors : actors.filter((actor) => actor.status === filter);
  const onlineCount = actors.filter((actor) => actor.status === "online" || actor.status === "standby").length;
  const unhealthyCount = actors.filter((actor) => actor.status === "warning" || actor.status === "offline").length;
  const primarySequencers = visibleActors.filter((actor) => actor.kind === "sequencer");
  const backupSequencers = visibleActors.filter((actor) => actor.kind === "backup-sequencer");
  const activeSequencer = actors.find((actor) => actor.kind === "sequencer" && actor.status === "online")
    || actors.find((actor) => actor.kind === "sequencer");

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
    setConnecting(true);

    const numericPort = Number(port);
    if (!host.trim() || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setConnectError("Enter a host and a valid REST admin port.");
      setConnecting(false);
      return;
    }

    try {
      const root = await callActor({ host: host.trim(), port: numericPort }, "list");
      const scopes = (root.results || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && line.toUpperCase() !== "VM");
      const scope = scopes[0] || `ACTOR-${customActors.length + 1}`;
      let details = "";

      try {
        const discovered = await callActor({ host: host.trim(), port: numericPort }, "list", scope);
        details = discovered.results || "";
      } catch {
        // Some actors expose only the root list. The root response is still useful.
      }

      const kind = kindFromDiscovery(scope, details);
      const discoveredCommands = commandsFromDiscovery(scope, details);
      let statusDetails = "";

      const isSequencer = kind === "sequencer" || kind === "backup-sequencer";
      if (isSequencer && discoveredCommands.includes("status")) {
        try {
          const statusReply = await callActor({ host: host.trim(), port: numericPort }, `${scope} status`);
          statusDetails = statusReply.results || "";
        } catch {
          // Discovery still succeeds when a sequencer does not expose status.
        }
      }

      const isBackup = isSequencer && (kind === "backup-sequencer" || /backup|standby|failover/i.test(`${details} ${statusDetails}`));
      const discoveredKind: ActorKind = isBackup ? "backup-sequencer" : kind;
      const session = isSequencer ? sessionFromStatus(statusDetails) : "discovered";
      const actor: Actor = {
        id: `actor-${Date.now()}`,
        name: scope,
        kind: discoveredKind,
        status: isBackup ? "standby" : "online",
        host: host.trim(),
        port: numericPort,
        account: scope,
        className: classFromDiscovery(scope, details, discoveredKind),
        sequencerRole: isSequencer ? (isBackup ? "Backup" : "Primary") : undefined,
        latency: "connected",
        session,
        sessionStarted: sessionStartFromStatus(statusDetails, session),
        lastSeen: "just now",
        commands: discoveredCommands.length ? discoveredCommands : ["list", "status"],
      };

      setCustomActors((current) => [...current, actor]);
      setHost("");
      setPort("30001");
      setAddOpen(false);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Could not reach this actor.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main className="console-shell">
      <header className="topbar">
        <a className="brand" href="#topology" aria-label="CoralConsole home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>CoralConsole</strong><small>Operations console</small></span>
        </a>
        <div className="topbar-actions">
          <span className="environment"><i /> Local workspace</span>
          <button className="intro-toggle" type="button" onClick={toggleIntro} aria-expanded={introVisible} aria-controls="console-intro">
            {introVisible ? "Hide intro" : "Show intro"}
          </button>
          <button className="button button-primary" type="button" onClick={() => setAddOpen(true)}>
            <span aria-hidden="true">＋</span> Add actor
          </button>
        </div>
      </header>

      <section className="hero" id="console-intro" aria-labelledby="page-title" hidden={!introVisible}>
        <div>
          <p className="eyebrow">Distributed system · Live topology</p>
          <h1 id="page-title">Every actor.<br /><em>One clear picture.</em></h1>
          <p className="hero-copy">See the sequencer at the center of your system, follow every connection, and run admin actions without leaving the map.</p>
        </div>
      </section>

      <section className="system-overview" aria-label="System summary">
        <div className="actor-summary" aria-label="Actor type counts">
          {SUMMARY_KINDS.map((kind) => {
            const count = actors.filter((actor) => actor.kind === kind).length;
            const Icon = ACTOR_META[kind].icon;
            return (
              <div className={`actor-metric actor-${kind}`} key={kind} aria-label={`${count} ${ACTOR_META[kind].summaryLabel}`}>
                <span className="actor-type-icon" aria-hidden="true"><Icon /></span>
                <p><strong>{count}</strong><small>{ACTOR_META[kind].summaryLabel}</small></p>
              </div>
            );
          })}
        </div>

        <aside className="pulse-panel" aria-label="System Pulse">
          <div className="pulse-heading">
            <div className="health-orbit" aria-hidden="true"><span /><span /><span /></div>
            <div><small>System Pulse</small><strong>{unhealthyCount ? "Attention needed" : "All systems nominal"}</strong><span>{onlineCount} of {actors.length} actors responding</span></div>
          </div>
          <div className="health-counts">
            <div className="health-count healthy"><i /><p><strong>{onlineCount}</strong><small>Healthy</small></p></div>
            <div className="health-count unhealthy"><i /><p><strong>{unhealthyCount}</strong><small>Unhealthy</small></p></div>
          </div>
          <div className="pulse-session">
            <small>Active session</small>
            <strong>{activeSequencer?.session || "Not discovered"}</strong>
            <span>{activeSequencer?.sessionStarted ? `Started ${activeSequencer.sessionStarted}` : "Start time not reported"}</span>
          </div>
        </aside>
      </section>

      <section className="workspace" id="topology">
        <div className="topology-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Topology</p>
              <h2>Actor map</h2>
            </div>
            <div className="filters" aria-label="Filter actors">
              {(["all", "online", "warning", "offline"] as const).map((value) => (
                <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                  {value === "all" ? "All actors" : value}
                </button>
              ))}
            </div>
          </div>

          <div className="topology-canvas">
            <div className="sequencer-groups">
              <section className="actor-group group-sequencer sequencer-primary" aria-labelledby="group-sequencer-primary">
                <div className="group-heading">
                  <div><p>Sequencer Fabric</p><h3 id="group-sequencer-primary">Primary Sequencer</h3></div>
                  <span>{primarySequencers.length}</span>
                </div>
                <div className="group-cards">
                  {primarySequencers.map((actor) => (
                    <ActorCard key={actor.id} actor={actor} />
                  ))}
                  {!primarySequencers.length && <p className="empty-group">No primary sequencer matches this filter.</p>}
                </div>
              </section>

              <section className="actor-group group-backup-sequencer sequencer-backups" aria-labelledby="group-sequencer-backups">
                <div className="group-heading">
                  <div><p>Sequencer Fabric</p><h3 id="group-sequencer-backups">Backup Sequencers</h3></div>
                  <span>{backupSequencers.length}</span>
                </div>
                <div className="group-cards">
                  {backupSequencers.map((actor) => (
                    <ActorCard key={actor.id} actor={actor} />
                  ))}
                  {!backupSequencers.length && <p className="empty-group">No backup sequencers match this filter.</p>}
                </div>
              </section>
            </div>

            <div className="actor-groups">
              {GROUPS.map((group) => {
                const grouped = group.kinds.flatMap((kind) => visibleActors.filter((actor) => actor.kind === kind));
                return (
                  <section className={`actor-group group-${group.id}`} key={group.id} aria-labelledby={`group-${group.id}`}>
                    <div className="group-heading">
                      <div><p>{group.eyebrow}</p><h3 id={`group-${group.id}`}>{group.title}</h3></div>
                      <span>{grouped.length}</span>
                    </div>
                    <div className="group-cards">
                      {grouped.map((actor) => (
                        <ActorCard key={actor.id} actor={actor} />
                      ))}
                      {!grouped.length && <p className="empty-group">No matching actors</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

      </section>

      <footer className="console-footer">
        <p><span className="brand-mark mini" aria-hidden="true"><i /><i /><i /></span> CoralConsole</p>
        <p>Local-first · Configuration stays in this browser</p>
      </footer>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <section className="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <button className="modal-close" type="button" onClick={() => setAddOpen(false)} aria-label="Close add actor dialog">×</button>
            <p className="eyebrow">Auto-discovery</p>
            <h2 id="add-title">Connect an actor</h2>
            <p>Enter the actor’s network address. The console will call <code>list</code>, discover its role and available actions, then place it on the map.</p>
            <div className="actor-type-list" aria-label="Supported actor types">
              {ACTOR_KINDS.map((kind) => <span key={kind}>{ACTOR_META[kind].label}</span>)}
            </div>
            <form onSubmit={addActor}>
              <label htmlFor="host">IP address or host</label>
              <input id="host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="10.42.0.10" autoFocus />
              <label htmlFor="port">REST admin port</label>
              <input id="port" value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" placeholder="30001" />
              {connectError && <p className="form-error" role="alert">{connectError}</p>}
              <div className="modal-actions">
                <button className="button button-ghost" type="button" onClick={() => setAddOpen(false)}>Cancel</button>
                <button className="button button-primary" type="submit" disabled={connecting}>{connecting ? "Discovering…" : "Discover actor"}</button>
              </div>
            </form>
            <div className="privacy-note"><span aria-hidden="true">⌂</span><p><strong>Built for local networks</strong>Your configuration stays in browser storage. Admin calls are relayed only through this local console.</p></div>
          </section>
        </div>
      )}
    </main>
  );
}
