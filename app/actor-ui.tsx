import {
  Archive,
  Boxes,
  Link2,
  MemoryStick,
  Network,
  Orbit,
  RotateCcw,
  ScrollText,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react";

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

export const ACTOR_KINDS: ActorKind[] = [
  "sequencer",
  "backup-sequencer",
  "replayer",
  "archiver",
  "logger",
  "bridge",
  "dispatcher",
  "node",
  "application",
  "link",
  "multimqapp",
];

export const ACTOR_META: Record<ActorKind, { label: string; summaryLabel: string; icon: LucideIcon }> = {
  sequencer: { label: "Sequencer", summaryLabel: "Sequencer", icon: Orbit },
  "backup-sequencer": { label: "Backup Sequencer", summaryLabel: "Backup Sequencers", icon: Orbit },
  replayer: { label: "Replayer", summaryLabel: "Replayers", icon: RotateCcw },
  archiver: { label: "Archiver", summaryLabel: "Archivers", icon: Archive },
  logger: { label: "Logger", summaryLabel: "Loggers", icon: ScrollText },
  bridge: { label: "Bridge", summaryLabel: "Bridges", icon: Waypoints },
  dispatcher: { label: "Dispatcher", summaryLabel: "Dispatchers", icon: MemoryStick },
  node: { label: "Node", summaryLabel: "Nodes", icon: Network },
  application: { label: "Application", summaryLabel: "Applications", icon: Boxes },
  link: { label: "Link", summaryLabel: "Links", icon: Link2 },
  multimqapp: { label: "MultiMqApp", summaryLabel: "MultiMqApps", icon: Workflow },
};

export function statusLabel(status: ActorStatus) {
  return status === "standby" ? "ready" : status;
}

export function actorSnapshotKey(actorId: string) {
  return `coral-console-actor:${actorId}`;
}

export function saveActorSnapshot(actor: Actor) {
  window.localStorage.setItem(actorSnapshotKey(actor.id), JSON.stringify(actor));
}

export function parseActorSnapshot(value: string | null): Actor | null {
  if (!value) return null;
  try {
    const actor = JSON.parse(value) as Actor;
    if (!actor || typeof actor.id !== "string" || typeof actor.name !== "string") return null;
    if (!ACTOR_KINDS.includes(actor.kind) || !Array.isArray(actor.commands)) return null;
    return actor;
  } catch {
    return null;
  }
}

export async function callActor(actor: Pick<Actor, "host" | "port">, adminCommand: string, params = "") {
  const response = await fetch("/api/actor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host: actor.host, port: actor.port, adminCommand, params }),
  });
  const payload = (await response.json()) as AdminReply;
  if (!response.ok || payload.error) throw new Error(payload.error || "The actor did not accept the command.");
  return payload;
}
