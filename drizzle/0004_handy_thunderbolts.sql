ALTER TABLE `topology_settings` ADD `keep_polling_without_viewers` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `topology_settings` ADD `viewer_grace_period_seconds` integer DEFAULT 90 NOT NULL;
