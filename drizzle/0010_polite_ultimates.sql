PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_topology_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`topology_name` text DEFAULT 'Coral Topology' NOT NULL,
	`background_color` text DEFAULT '#f4eee7' NOT NULL,
	`poll_interval_seconds` integer DEFAULT 5 NOT NULL,
	`keep_polling_without_viewers` integer DEFAULT false NOT NULL,
	`viewer_grace_period_seconds` integer DEFAULT 90 NOT NULL,
	`audit_retention_days` integer DEFAULT 90 NOT NULL,
	`summary_actor_kinds` text DEFAULT '["sequencer","backup-sequencer","replayer","archiver","logger","bridge","dispatcher","node","application","multimqapp"]' NOT NULL,
	`setup_complete` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_topology_settings`("id", "topology_name", "background_color", "poll_interval_seconds", "keep_polling_without_viewers", "viewer_grace_period_seconds", "audit_retention_days", "summary_actor_kinds", "setup_complete", "created_at", "updated_at") SELECT "id", "topology_name", "background_color", "health_check_interval_seconds", "keep_polling_without_viewers", "viewer_grace_period_seconds", "audit_retention_days", "summary_actor_kinds", "setup_complete", "created_at", "updated_at" FROM `topology_settings`;--> statement-breakpoint
DROP TABLE `topology_settings`;--> statement-breakpoint
ALTER TABLE `__new_topology_settings` RENAME TO `topology_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
