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
import type { ActorKind, ActorOperationalState, ActorStatus, AuditOutcome } from "@/lib/types";

export type { Actor, ActorKind, ActorOperationalState, ActorStatus, AdminActionReply } from "@/lib/types";

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

export const ACTOR_META: Record<ActorKind, { label: string; summaryLabel: string; summaryTooltip?: string; icon: LucideIcon }> = {
  sequencer: { label: "Sequencer", summaryLabel: "Sequencer", summaryTooltip: "The central broker and the owner of truth", icon: Orbit },
  "backup-sequencer": { label: "Backup Sequencer", summaryLabel: "Backup Sequencers", summaryTooltip: "Ready to take over if needed", icon: Orbit },
  replayer: { label: "Replayer", summaryLabel: "Replayers", summaryTooltip: "For rewinding and gap-filling.", icon: RotateCcw },
  archiver: { label: "Archiver", summaryLabel: "Archivers", summaryTooltip: "To archive the entire session in a binary file for later reference", icon: Archive },
  logger: { label: "Logger", summaryLabel: "Loggers", summaryTooltip: "To log the entire session in a text file in a human readable way", icon: ScrollText },
  bridge: { label: "Bridge", summaryLabel: "Bridges", summaryTooltip: "To distribute the event-stream across networks", icon: Waypoints },
  dispatcher: { label: "Dispatcher", summaryLabel: "Dispatchers", summaryTooltip: "To distribute the event-stream through shared-memory", icon: MemoryStick },
  node: { label: "Node", summaryLabel: "Nodes", summaryTooltip: "The business logic is implemented here", icon: Network },
  application: { label: "Application", summaryLabel: "Applications", summaryTooltip: "Nodes that do not listen to the event-stream", icon: Boxes },
  link: { label: "Link", summaryLabel: "Links", icon: Link2 },
  multimqapp: { label: "MultiMqApp", summaryLabel: "MultiMqApps", summaryTooltip: "Applications connecting different event-streams from different sequencers", icon: Workflow },
};

export function statusLabel(status: ActorStatus) {
  return status === "online" ? "Online" : "Offline";
}

export function operationalStateForDisplay(
  status: ActorStatus,
  state: ActorOperationalState,
  stateIsFresh: boolean,
): ActorOperationalState | "unknown" {
  return status === "offline" || !stateIsFresh ? "unknown" : state;
}

export function operationalStateLabel(state: ActorOperationalState | "unknown") {
  return state[0].toUpperCase() + state.slice(1);
}

export function auditOutcomeLabel(outcome: AuditOutcome) {
  return {
    success: "Success",
    failure: "Failure",
    error: "Error",
    unreachable: "Unreachable",
  }[outcome];
}
