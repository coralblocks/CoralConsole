ALTER TABLE `actors` ADD `outbound_sequence` text DEFAULT 'Not reported' NOT NULL;--> statement-breakpoint
ALTER TABLE `actors` ADD `accounts` text DEFAULT 'Not reported' NOT NULL;--> statement-breakpoint
ALTER TABLE `actors` ADD `clock_tick_interval` text DEFAULT 'Not reported' NOT NULL;