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
import type { ActorKind, ActorStatus } from "@/lib/types";

export type { Actor, ActorKind, ActorStatus, AdminReply } from "@/lib/types";

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
