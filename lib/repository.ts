import { and, desc, eq, like, or, type SQL } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { actors, adminActionAudit, topologySettings, type ActorRow } from "@/db/schema";
import { DEMO_ACTORS } from "./demo-actors";
import {
  SUMMARY_ACTOR_KINDS,
  type Actor,
  type ActorKind,
  type ActorStatus,
  type AuditEntry,
  type AuditOutcome,
  type SummaryActorKind,
  type TopologySettings,
} from "./types";

const ACTOR_KINDS: ActorKind[] = [
  "sequencer", "backup-sequencer", "replayer", "bridge", "dispatcher", "archiver",
  "application", "node", "logger", "link", "multimqapp",
];
const ACTOR_STATUSES: ActorStatus[] = ["online", "standby", "warning", "offline"];
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
  for (const actor of DEMO_ACTORS) {
    db.insert(actors).values({
      ...actor,
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
  return ACTOR_STATUSES.includes(value as ActorStatus) ? value as ActorStatus : "offline";
}

function validSummaryActorKinds(value: unknown): SummaryActorKind[] {
  if (!Array.isArray(value)) return [...SUMMARY_ACTOR_KINDS];
  const selected = new Set(value);
  return SUMMARY_ACTOR_KINDS.filter((kind) => selected.has(kind));
}

export function rowToActor(row: ActorRow): Actor {
  return {
    id: row.id,
    name: row.name,
    kind: validKind(row.kind),
    status: validStatus(row.status),
    host: row.host,
    port: row.port,
    account: row.account,
    className: row.className,
    cluster: row.cluster || undefined,
    sequencerRole: row.sequencerRole === "Primary" || row.sequencerRole === "Backup" ? row.sequencerRole : undefined,
    latency: row.latency,
    session: row.session,
    sessionStarted: row.sessionStarted || undefined,
    lastSeen: row.lastSeen,
    actions: Array.isArray(row.actions) ? row.actions : [],
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
    healthCheckIntervalSeconds: row.healthCheckIntervalSeconds,
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
  return getDb().select().from(actors).orderBy(actors.createdAt).all().map(rowToActor);
}

export function getActor(id: string) {
  syncDemoMode();
  const row = getDb().select().from(actors).where(eq(actors.id, id)).get();
  return row ? rowToActor(row) : null;
}

export function createActor(actor: Actor) {
  const now = new Date().toISOString();
  getDb().insert(actors).values({
    ...actor,
    cluster: actor.cluster || null,
    sequencerRole: actor.sequencerRole || null,
    sessionStarted: actor.sessionStarted || null,
    lastSeenAt: now,
    lastError: null,
    demo: Boolean(actor.demo),
    createdAt: now,
    updatedAt: now,
  }).run();
  return getActor(actor.id)!;
}

export function updateActor(actor: Actor, lastError: string | null = null) {
  const now = new Date().toISOString();
  getDb().update(actors).set({
    name: actor.name,
    kind: actor.kind,
    status: actor.status,
    host: actor.host,
    port: actor.port,
    account: actor.account,
    className: actor.className,
    cluster: actor.cluster || null,
    sequencerRole: actor.sequencerRole || null,
    latency: actor.latency,
    session: actor.session,
    sessionStarted: actor.sessionStarted || null,
    lastSeen: actor.lastSeen,
    lastSeenAt: lastError ? undefined : now,
    lastError,
    actions: actor.actions,
    demo: Boolean(actor.demo),
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

export function recordActorHeartbeat(
  actorId: string,
  heartbeat: { status: ActorStatus; latency: string; lastSeen: string; error: string | null },
) {
  const now = new Date().toISOString();
  getDb().update(actors).set({
    status: heartbeat.status,
    latency: heartbeat.latency,
    lastSeen: heartbeat.lastSeen,
    lastSeenAt: now,
    lastError: heartbeat.error,
    updatedAt: now,
  }).where(eq(actors.id, actorId)).run();
}

export function deleteActor(id: string) {
  return getDb().delete(actors).where(eq(actors.id, id)).run().changes > 0;
}

export function recordAudit(entry: Omit<AuditEntry, "id" | "createdAt">) {
  return getDb().insert(adminActionAudit).values(entry).run().lastInsertRowid;
}

export function listAudit(options: { actorId?: string; query?: string; outcome?: AuditOutcome; limit?: number }) {
  const clauses: SQL[] = [];
  if (options.actorId) clauses.push(eq(adminActionAudit.actorId, options.actorId));
  if (options.outcome) clauses.push(eq(adminActionAudit.outcome, options.outcome));
  if (options.query) {
    const pattern = `%${options.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const search = or(
      like(adminActionAudit.action, pattern),
      like(adminActionAudit.actorName, pattern),
      like(adminActionAudit.actorEndpoint, pattern),
      like(adminActionAudit.output, pattern),
    );
    if (search) clauses.push(search);
  }
  const where = clauses.length ? and(...clauses) : undefined;
  return getDb().select().from(adminActionAudit).where(where).orderBy(desc(adminActionAudit.id)).limit(options.limit || 100).all();
}

export function clearAudit() {
  return getDb().delete(adminActionAudit).run().changes;
}

let lastPurgeAt = 0;
export function purgeExpiredAudit(force = false) {
  const now = Date.now();
  if (!force && now - lastPurgeAt < 24 * 60 * 60 * 1000) return 0;
  lastPurgeAt = now;
  const days = getSettings().auditRetentionDays;
  return getSqlite().prepare("DELETE FROM command_audit WHERE created_at < datetime('now', ?)").run(`-${days} days`).changes;
}
