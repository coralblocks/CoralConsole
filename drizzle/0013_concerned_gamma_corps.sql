PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_command_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`actor_endpoint` text NOT NULL,
	`command` text NOT NULL,
	`params` text DEFAULT '' NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT 'error' NOT NULL,
	`error` text,
	`duration_ms` integer NOT NULL,
	`source_ip` text DEFAULT 'N/A' NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_command_audit`("id", "actor_id", "actor_name", "actor_endpoint", "command", "params", "output", "outcome", "error", "duration_ms", "source_ip", "truncated", "created_at")
SELECT
	"id",
	"actor_id",
	"actor_name",
	"actor_endpoint",
	"command",
	"params",
	"output",
	CASE WHEN "outcome" = 'failed' THEN 'failure' ELSE "outcome" END,
	"error",
	"duration_ms",
	COALESCE(NULLIF(TRIM("source_ip"), ''), 'N/A'),
	"truncated",
	"created_at"
FROM `command_audit`;--> statement-breakpoint
DROP TABLE `command_audit`;--> statement-breakpoint
ALTER TABLE `__new_command_audit` RENAME TO `command_audit`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `command_audit_actor_idx` ON `command_audit` (`actor_id`);--> statement-breakpoint
CREATE INDEX `command_audit_created_idx` ON `command_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `command_audit_outcome_idx` ON `command_audit` (`outcome`);
