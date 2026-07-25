import type { Actor } from "./types";

const base = {
  account: "production",
  session: "operational",
  outboundSequence: "Not reported",
  accounts: "Not reported",
  clockTickInterval: "Not reported",
  actorStatusFields: [] as Actor["actorStatusFields"],
  actorStatusRespondedAt: "2026-07-17T17:25:00.000Z",
  operationalState: "active",
  lastSeen: "sample data",
  demo: true,
} as const;

export const DEMO_ACTORS: Actor[] = [
  { ...base, id: "demo-seq-01", name: "SEQ-NYC-01", kind: "sequencer", status: "online", host: "10.42.0.10", port: 30001, className: "Sequencer", sequencerRole: "Primary", latency: "3.4 μs", session: "2607171725", outboundSequence: "184201", accounts: "12", clockTickInterval: "1000000", sessionStarted: "17 Jul 2026 · 17:25", actions: ["status", "showAccounts", "rollSession", "list"] },
  { ...base, id: "demo-backup-01", name: "SEQ-NYC-02", kind: "backup-sequencer", status: "online", host: "10.42.0.11", port: 30001, className: "Sequencer", sequencerRole: "Backup", latency: "4.1 μs", session: "2607171725", sessionStarted: "17 Jul 2026 · 17:25", actions: ["status", "activate", "showAccounts", "list"] },
  { ...base, id: "demo-rpl-01", name: "RPL-EAST-01", kind: "replayer", status: "online", host: "10.42.1.20", port: 30002, className: "NetworkReplayer", cluster: "EAST", latency: "0 lag", session: "caught up", actions: ["status", "open", "close", "list"] },
  { ...base, id: "demo-rpl-02", name: "RPL-EAST-02", kind: "replayer", status: "online", host: "10.42.1.21", port: 30002, className: "NetworkReplayer", cluster: "EAST", latency: "0 lag", session: "caught up", actions: ["status", "open", "close", "list"] },
  { ...base, id: "demo-rpl-03", name: "RPL-WEST-01", kind: "replayer", status: "offline", operationalState: "rewinding", host: "10.42.2.20", port: 30002, className: "NetworkReplayer", cluster: "WEST", latency: "18 msg lag", session: "catching up", actions: ["status", "open", "close", "list"] },
  { ...base, id: "demo-bridge-01", name: "BRIDGE-LDN-01", kind: "bridge", status: "online", host: "10.42.2.30", port: 30003, className: "TcpUdpBridge", latency: "0 drops", session: "linked", actions: ["status", "open", "close", "list"] },
  { ...base, id: "demo-dispatcher-01", name: "DISPATCH-01", kind: "dispatcher", status: "online", host: "10.42.2.31", port: 30003, className: "SharedMemoryDispatcher", latency: "4 lanes", session: "dispatching", actions: ["status", "open", "close", "list"] },
  { ...base, id: "demo-arc-01", name: "ARCHIVE-01", kind: "archiver", status: "online", host: "10.42.3.30", port: 30003, className: "SessionArchiver", latency: "2.8 TB", session: "writing", actions: ["status", "roll", "list"] },
  { ...base, id: "demo-logger-01", name: "LOGGER-01", kind: "logger", status: "online", host: "10.42.3.31", port: 30003, className: "SessionLogger", latency: "12 MB/s", session: "streaming", actions: ["status", "roll", "list"] },
  { ...base, id: "demo-node-01", name: "ORDER-GATEWAY", kind: "application", status: "online", host: "10.42.4.41", port: 30004, account: "trading", className: "OrderGatewayNode", latency: "1.2M msg", session: "subscribed", actions: ["status", "warmup", "list"] },
  { ...base, id: "demo-node-02", name: "RISK-ENGINE", kind: "application", status: "online", operationalState: "inactive", host: "10.42.4.42", port: 30004, account: "risk", className: "RiskEngineNode", latency: "1.2M msg", session: "subscribed", actions: ["status", "reset", "list"] },
  { ...base, id: "demo-node-03", name: "MARKET-DATA", kind: "node", status: "offline", operationalState: "disconnected", host: "10.42.4.43", port: 30004, account: "market-data", className: "MarketDataNode", latency: "—", session: "disconnected", actions: ["status", "list"] },
];
