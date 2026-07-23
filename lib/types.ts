export type ActorKind =
  | "sequencer"
  | "backup-sequencer"
  | "replayer"
  | "bridge"
  | "dispatcher"
  | "archiver"
  | "application"
  | "node"
  | "logger"
  | "link"
  | "multimqapp";

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
  commands: string[];
  demo?: boolean;
};

export type AdminReply = {
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
  setupComplete: boolean;
};

export type AuditEntry = {
  id: number;
  actorId: string | null;
  actorName: string;
  actorEndpoint: string;
  command: string;
  params: string;
  output: string;
  success: boolean;
  error: string | null;
  durationMs: number;
  sourceIp: string | null;
  truncated: boolean;
  createdAt: string;
};
