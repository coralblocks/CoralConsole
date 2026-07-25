PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TEMP TABLE `__actor_audit_refs` AS
SELECT `id`, `actor_id`
FROM `command_audit`
WHERE `actor_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_actors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'unhealthy' NOT NULL,
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
INSERT INTO `__new_actors`("id", "name", "kind", "status", "host", "port", "account", "class_name", "cluster", "sequencer_role", "latency", "session", "session_started", "last_seen", "last_seen_at", "last_error", "commands", "demo", "created_at", "updated_at") SELECT "id", "name", "kind", "status", "host", "port", "account", "class_name", "cluster", "sequencer_role", "latency", "session", "session_started", "last_seen", "last_seen_at", "last_error", "commands", "demo", "created_at", "updated_at" FROM `actors`;--> statement-breakpoint
DROP TABLE `actors`;--> statement-breakpoint
ALTER TABLE `__new_actors` RENAME TO `actors`;--> statement-breakpoint
UPDATE `actors`
SET `status` = CASE
	WHEN `status` IN ('healthy', 'online', 'standby') THEN 'healthy'
	ELSE 'unhealthy'
END;--> statement-breakpoint
UPDATE `command_audit`
SET `actor_id` = (
	SELECT `actor_id`
	FROM `__actor_audit_refs`
	WHERE `__actor_audit_refs`.`id` = `command_audit`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__actor_audit_refs`);--> statement-breakpoint
DROP TABLE `__actor_audit_refs`;--> statement-breakpoint
CREATE UNIQUE INDEX `actors_endpoint_unique` ON `actors` (`host`,`port`);--> statement-breakpoint
CREATE INDEX `actors_kind_idx` ON `actors` (`kind`);--> statement-breakpoint
CREATE INDEX `actors_status_idx` ON `actors` (`status`);
