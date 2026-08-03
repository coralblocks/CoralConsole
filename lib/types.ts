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
export const DEFAULT_SUMMARY_ACTOR_KINDS: SummaryActorKind[] = SUMMARY_ACTOR_KINDS.filter(
  (kind) => kind !== "application" && kind !== "multimqapp",
);
export type ActorKind = SummaryActorKind | "link";

export type ActorStatus = "online" | "offline";
export type ActorOperationalState = "closed" | "disconnected" | "rewinding" | "active" | "inactive";

export const BASELINE_ADMIN_ACTIONS = ["list", "actorStatus", "healthCheck"] as const;
export const BASELINE_VM_ADMIN_ACTIONS = ["list"] as const;

export type ActorStatusField = {
  label: string;
  value: string;
};

export type Actor = {
  id: string;
  name: string;
  kind: ActorKind;
  status: ActorStatus;
  operationalState: ActorOperationalState;
  host: string;
  port: number;
  account: string;
  className: string;
  cluster?: string;
  sequencerRole?: "Primary" | "Backup";
  latency: string;
  session: string;
  outboundSequence: string;
  accounts: string;
  clockTickInterval: string;
  actorStatusFields: ActorStatusField[];
  sortOrder?: number;
  sessionStarted?: string;
  actorStatusRespondedAt?: string;
  lastSeen: string;
  actions: string[];
  vmActions: string[];
};

export type ActorDiscoveryResult = {
  actors: Actor[];
  duplicateAccounts: string[];
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
  keepPollingWithoutViewers: boolean;
  viewerGracePeriodSeconds: number;
  auditRetentionDays: number;
  summaryActorKinds: SummaryActorKind[];
  setupComplete: boolean;
};

export const AUDIT_OUTCOMES = ["success", "failure", "error", "unreachable"] as const;
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
  sourceIp: string;
  truncated: boolean;
  createdAt: string;
};
