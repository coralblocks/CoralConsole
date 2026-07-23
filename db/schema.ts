import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const topologySettings = sqliteTable("topology_settings", {
  id: integer("id").primaryKey().default(1),
  topologyName: text("topology_name").notNull().default("Coral Topology"),
  backgroundColor: text("background_color").notNull().default("#f4eee7"),
  pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(30),
  auditRetentionDays: integer("audit_retention_days").notNull().default(90),
  setupComplete: integer("setup_complete", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const actors = sqliteTable("actors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("offline"),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  account: text("account").notNull(),
  className: text("class_name").notNull(),
  cluster: text("cluster"),
  sequencerRole: text("sequencer_role"),
  latency: text("latency").notNull().default("—"),
  session: text("session").notNull().default("Not reported"),
  sessionStarted: text("session_started"),
  lastSeen: text("last_seen").notNull().default("Never"),
  lastSeenAt: text("last_seen_at"),
  lastError: text("last_error"),
  commands: text("commands", { mode: "json" }).$type<string[]>().notNull().default([]),
  demo: integer("demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("actors_endpoint_unique").on(table.host, table.port),
  index("actors_kind_idx").on(table.kind),
  index("actors_status_idx").on(table.status),
]);

export const commandAudit = sqliteTable("command_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: text("actor_id").references(() => actors.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  actorEndpoint: text("actor_endpoint").notNull(),
  command: text("command").notNull(),
  params: text("params").notNull().default(""),
  output: text("output").notNull().default(""),
  success: integer("success", { mode: "boolean" }).notNull(),
  error: text("error"),
  durationMs: integer("duration_ms").notNull(),
  sourceIp: text("source_ip"),
  truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("command_audit_actor_idx").on(table.actorId),
  index("command_audit_created_idx").on(table.createdAt),
  index("command_audit_success_idx").on(table.success),
]);

export type TopologySettingsRow = typeof topologySettings.$inferSelect;
export type ActorRow = typeof actors.$inferSelect;
export type CommandAuditRow = typeof commandAudit.$inferSelect;
