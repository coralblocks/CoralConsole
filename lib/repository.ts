import { and, asc, desc, eq, like, or, type SQL } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { actors, adminActionAudit, topologySettings, type ActorRow } from "@/db/schema";
import { DEMO_ACTORS } from "./demo-actors";
import {
  BASELINE_ADMIN_ACTIONS,
  BASELINE_VM_ADMIN_ACTIONS,
  DEFAULT_SUMMARY_ACTOR_KINDS,
  SUMMARY_ACTOR_KINDS,
  type Actor,
  type ActorKind,
  type ActorOperationalState,
  type ActorStatus,
  type ActorStatusField,
  type AuditEntry,
  type AuditOutcome,
  type SummaryActorKind,
  type TopologySettings,
} from "./types";

const ACTOR_KINDS: ActorKind[] = [
  "sequencer", "backup-sequencer", "replayer", "bridge", "dispatcher", "archiver",
  "application", "node", "logger", "link", "multimqapp",
];
const ACTOR_STATUSES: ActorStatus[] = ["online", "offline"];
const ACTOR_OPERATIONAL_STATES: ActorOperationalState[] = ["closed", "disconnected", "rewinding", "active", "inactive"];
let demoModeSynced = false;

function syncDemoMode() {
  if (demoModeSynced) return;
  demoModeSynced = true;
  const db = getDb();
  if (process.env.CORAL_DEMO_MODE !== "true") {
    db.delete(actors).where(eq(actors.demo, true)).run();
    return;
  }
  const now = new Date().toISOString();
  const nextSortOrderByKind = new Map<ActorKind, number>();
  for (const actor of DEMO_ACTORS) {
    const sortOrder = nextSortOrderByKind.get(actor.kind) || 0;
    nextSortOrderByKind.set(actor.kind, sortOrder + 1);
    db.insert(actors).values({
      ...actor,
      sortOrder,
      cluster: actor.cluster || null,
      sequencerRole: actor.sequencerRole || null,
      sessionStarted: actor.sessionStarted || null,
      lastSeenAt: now,
      lastError: null,
      demo: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();
  }
}

function validKind(value: string): ActorKind {
  return ACTOR_KINDS.includes(value as ActorKind) ? value as ActorKind : "node";
}

function validStatus(value: string): ActorStatus {
  if (ACTOR_STATUSES.includes(value as ActorStatus)) return value as ActorStatus;
  if (value === "healthy" || value === "standby") return "online";
  return "offline";
}

function validOperationalState(value: string): ActorOperationalState {
  return ACTOR_OPERATIONAL_STATES.includes(value as ActorOperationalState)
    ? value as ActorOperationalState
    : "inactive";
}

function validSummaryActorKinds(value: unknown): SummaryActorKind[] {
  if (!Array.isArray(value)) return [...DEFAULT_SUMMARY_ACTOR_KINDS];
  const selected = new Set(value);
  return SUMMARY_ACTOR_KINDS.filter((kind) => selected.has(kind));
}

function validActions(value: unknown, baseline: readonly string[]) {
  const stored = Array.isArray(value) ? value.filter((action): action is string => typeof action === "string") : [];
  return [...new Set([...baseline, ...stored])];
}

function validActorStatusFields(value: unknown): ActorStatusField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => {
    if (
      !field
      || typeof field !== "object"
      || typeof (field as ActorStatusField).label !== "string"
      || typeof (field as ActorStatusField).value !== "string"
    ) return [];
    return [{
      label: (field as ActorStatusField).label,
      value: (field as ActorStatusField).value,
    }];
  });
}

export function rowToActor(row: ActorRow): Actor {
  return {
    id: row.id,
    name: row.name,
    kind: validKind(row.kind),
    status: validStatus(row.status),
    operationalState: validOperationalState(row.operationalState),
    host: row.host,
    port: row.port,
    account: row.account,
    className: row.className,
    cluster: row.cluster || undefined,
    sequencerRole: row.sequencerRole === "Primary" || row.sequencerRole === "Backup" ? row.sequencerRole : undefined,
    latency: row.latency,
    session: row.session,
    outboundSequence: row.outboundSequence,
    accounts: row.accounts,
    clockTickInterval: row.clockTickInterval,
    actorStatusFields: validActorStatusFields(row.actorStatusFields),
    sortOrder: row.sortOrder,
    sessionStarted: row.sessionStarted || undefined,
    actorStatusRespondedAt: row.actorStatusRespondedAt || undefined,
    lastSeen: row.lastSeen,
    actions: validActions(row.actions, BASELINE_ADMIN_ACTIONS),
    vmActions: validActions(row.vmActions, BASELINE_VM_ADMIN_ACTIONS),
    demo: row.demo || undefined,
  };
}

export function getSettings(): TopologySettings {
  const row = getDb().select().from(topologySettings).where(eq(topologySettings.id, 1)).get();
  if (!row) throw new Error("Topology settings are unavailable.");
  return {
    topologyName: row.topologyName,
    backgroundColor: row.backgroundColor,
    pollIntervalSeconds: row.pollIntervalSeconds,
    keepPollingWithoutViewers: row.keepPollingWithoutViewers,
    viewerGracePeriodSeconds: row.viewerGracePeriodSeconds,
    auditRetentionDays: row.auditRetentionDays,
    summaryActorKinds: validSummaryActorKinds(row.summaryActorKinds),
    setupComplete: row.setupComplete,
  };
}

export function saveSettings(settings: TopologySettings) {
  getDb().update(topologySettings).set({
    ...settings,
    updatedAt: new Date().toISOString(),
  }).where(eq(topologySettings.id, 1)).run();
  return getSettings();
}

export function listActors() {
  syncDemoMode();
  return getDb().select().from(actors).orderBy(asc(actors.sortOrder), asc(actors.createdAt), asc(actors.id)).all().map(rowToActor);
}

export function getActor(id: string) {
  syncDemoMode();
  const row = getDb().select().from(actors).where(eq(actors.id, id)).get();
  return row ? rowToActor(row) : null;
}

export function getActorByIdentity(host: string, port: number, account: string) {
  syncDemoMode();
  const row = getDb().select().from(actors)
    .where(and(eq(actors.host, host), eq(actors.port, port), eq(actors.account, account)))
    .get();
  return row ? rowToActor(row) : null;
}

function insertActor(actor: Actor) {
  const now = new Date().toISOString();
  const nextSortOrder = getSqlite()
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSortOrder FROM actors WHERE kind = ?")
    .get(actor.kind) as { nextSortOrder: number };
  getDb().insert(actors).values({
    ...actor,
    sortOrder: nextSortOrder.nextSortOrder,
    cluster: actor.cluster || null,
    sequencerRole: actor.sequencerRole || null,
    sessionStarted: actor.sessionStarted || null,
    actorStatusRespondedAt: actor.actorStatusRespondedAt || null,
    lastSeenAt: now,
    lastError: null,
    demo: Boolean(actor.demo),
    createdAt: now,
    updatedAt: now,
  }).run();
}

export function createActors(discoveredActors: Actor[]) {
  syncDemoMode();
  getSqlite().transaction((pendingActors: Actor[]) => {
    pendingActors.forEach(insertActor);
  })(discoveredActors);
  return discoveredActors.map((actor) => getActor(actor.id)!);
}

export function updateActor(actor: Actor, lastError: string | null = null) {
  const now = new Date().toISOString();
  const stored = getDb().select({ kind: actors.kind }).from(actors).where(eq(actors.id, actor.id)).get();
  const sortOrder = stored && stored.kind !== actor.kind
    ? (getSqlite()
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSortOrder FROM actors WHERE kind = ?")
      .get(actor.kind) as { nextSortOrder: number }).nextSortOrder
    : undefined;
  getDb().update(actors).set({
    name: actor.name,
    kind: actor.kind,
    status: actor.status,
    operationalState: actor.operationalState,
    host: actor.host,
    port: actor.port,
    account: actor.account,
    className: actor.className,
    cluster: actor.cluster || null,
    sequencerRole: actor.sequencerRole || null,
    latency: actor.latency,
    session: actor.session,
    outboundSequence: actor.outboundSequence,
    accounts: actor.accounts,
    clockTickInterval: actor.clockTickInterval,
    actorStatusFields: actor.actorStatusFields,
    sessionStarted: actor.sessionStarted || null,
    actorStatusRespondedAt: actor.actorStatusRespondedAt || null,
    lastSeen: actor.lastSeen,
    lastSeenAt: lastError ? undefined : now,
    lastError,
    actions: actor.actions,
    vmActions: actor.vmActions,
    demo: Boolean(actor.demo),
    sortOrder,
    updatedAt: now,
  }).where(eq(actors.id, actor.id)).run();
  return getActor(actor.id);
}

export function markActorOffline(actor: Actor, error: string) {
  getDb().update(actors).set({
    status: "offline",
    lastSeen: actor.lastSeen === "just now" ? "unreachable" : actor.lastSeen,
    lastError: error,
    updatedAt: new Date().toISOString(),
  }).where(eq(actors.id, actor.id)).run();
}

export function updateActorEndpoint(id: string, host: string, port: number) {
  getDb().update(actors).set({
    host,
    port,
    status: "offline",
    lastError: "Endpoint changed; awaiting actorStatus.",
    updatedAt: new Date().toISOString(),
  }).where(eq(actors.id, id)).run();
  return getActor(id);
}

export function reorderActors(kind: ActorKind, actorIds: string[]) {
  const sqlite = getSqlite();
  const updateOrder = sqlite.prepare("UPDATE actors SET sort_order = ?, updated_at = ? WHERE id = ? AND kind = ?");
  const updatedAt = new Date().toISOString();
  sqlite.transaction((ids: string[]) => {
    ids.forEach((id, index) => updateOrder.run(index, updatedAt, id, kind));
  })(actorIds);
  return listActors();
}

export function deleteActor(id: string) {
  return getDb().delete(actors).where(eq(actors.id, id)).run().changes > 0;
}

export function recordAudit(entry: Omit<AuditEntry, "id" | "createdAt">) {
  return getDb().insert(adminActionAudit).values(entry).run().lastInsertRowid;
}

function auditSearchTerms(query: string) {
  return [...query.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((match) => (match[1] || match[2]).trim())
    .filter(Boolean);
}

export function listAudit(options: { actorId?: string; query?: string; outcome?: AuditOutcome; limit?: number }) {
  const clauses: SQL[] = [];
  if (options.actorId) clauses.push(eq(adminActionAudit.actorId, options.actorId));
  if (options.outcome) clauses.push(eq(adminActionAudit.outcome, options.outcome));
  if (options.query) {
    for (const term of auditSearchTerms(options.query)) {
      const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const search = or(
        like(adminActionAudit.action, pattern),
        like(adminActionAudit.params, pattern),
        like(adminActionAudit.actorName, pattern),
        like(adminActionAudit.actorEndpoint, pattern),
        like(adminActionAudit.sourceIp, pattern),
        like(adminActionAudit.output, pattern),
        like(adminActionAudit.error, pattern),
      );
      if (search) clauses.push(search);
    }
  }
  const where = clauses.length ? and(...clauses) : undefined;
  return getDb().select().from(adminActionAudit).where(where).orderBy(desc(adminActionAudit.id)).limit(options.limit || 100).all();
}

let lastPurgeAt = 0;
export function purgeExpiredAudit(force = false) {
  const now = Date.now();
  if (!force && now - lastPurgeAt < 24 * 60 * 60 * 1000) return 0;
  lastPurgeAt = now;
  const days = getSettings().auditRetentionDays;
  return getSqlite().prepare("DELETE FROM command_audit WHERE created_at < datetime('now', ?)").run(`-${days} days`).changes;
}
