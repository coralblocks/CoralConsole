export const SUMMARY_ACTOR_KINDS = [
  "sequencer",
  "backup-sequencer",
  "replayer",
  "archiver",
  "logger",
  "bridge",
  "dispatcher",
  "node",
  "application",
  "multimqapp",
] as const;

export type SummaryActorKind = typeof SUMMARY_ACTOR_KINDS[number];
export type ActorKind = SummaryActorKind | "link";

export type ActorStatus = "online" | "standby" | "warning" | "offline";

export type Actor = {
  id: string;
  name: string;
  kind: ActorKind;
  status: ActorStatus;
  host: string;
  port: number;
  account: string;
  className: string;
  cluster?: string;
  sequencerRole?: "Primary" | "Backup";
  latency: string;
  session: string;
  sessionStarted?: string;
  lastSeen: string;
  actions: string[];
  demo?: boolean;
};

export type AdminActionReply = {
  result?: boolean;
  adminCommand?: string;
  params?: string;
  results?: string;
  error?: string;
};

export type TopologySettings = {
  topologyName: string;
  backgroundColor: string;
  pollIntervalSeconds: number;
  auditRetentionDays: number;
  summaryActorKinds: SummaryActorKind[];
  setupComplete: boolean;
};

export const AUDIT_OUTCOMES = ["success", "failed", "error", "unreachable"] as const;
export type AuditOutcome = typeof AUDIT_OUTCOMES[number];

export type AuditEntry = {
  id: number;
  actorId: string | null;
  actorName: string;
  actorEndpoint: string;
  action: string;
  params: string;
  output: string;
  outcome: AuditOutcome;
  error: string | null;
  durationMs: number;
  sourceIp: string | null;
  truncated: boolean;
  createdAt: string;
};
