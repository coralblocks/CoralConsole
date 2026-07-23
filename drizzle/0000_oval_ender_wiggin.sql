CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`account` text NOT NULL,
	`class_name` text NOT NULL,
	`cluster` text,
	`sequencer_role` text,
	`latency` text DEFAULT '—' NOT NULL,
	`session` text DEFAULT 'Not reported' NOT NULL,
	`session_started` text,
	`last_seen` text DEFAULT 'Never' NOT NULL,
	`last_seen_at` text,
	`last_error` text,
	`commands` text DEFAULT '[]' NOT NULL,
	`demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actors_endpoint_unique` ON `actors` (`host`,`port`);--> statement-breakpoint
CREATE INDEX `actors_kind_idx` ON `actors` (`kind`);--> statement-breakpoint
CREATE INDEX `actors_status_idx` ON `actors` (`status`);--> statement-breakpoint
CREATE TABLE `command_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`actor_endpoint` text NOT NULL,
	`command` text NOT NULL,
	`params` text DEFAULT '' NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`success` integer NOT NULL,
	`error` text,
	`duration_ms` integer NOT NULL,
	`source_ip` text,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `command_audit_actor_idx` ON `command_audit` (`actor_id`);--> statement-breakpoint
CREATE INDEX `command_audit_created_idx` ON `command_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `command_audit_success_idx` ON `command_audit` (`success`);--> statement-breakpoint
CREATE TABLE `topology_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`topology_name` text DEFAULT 'Coral Topology' NOT NULL,
	`background_color` text DEFAULT '#f4eee7' NOT NULL,
	`poll_interval_seconds` integer DEFAULT 30 NOT NULL,
	`audit_retention_days` integer DEFAULT 90 NOT NULL,
	`setup_complete` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
