DROP INDEX `command_audit_success_idx`;--> statement-breakpoint
ALTER TABLE `command_audit` ADD `outcome` text DEFAULT 'error' NOT NULL;--> statement-breakpoint
UPDATE `command_audit`
SET `outcome` = CASE
	WHEN `success` = 1 THEN 'success'
	WHEN lower(coalesce(`error`, '')) LIKE '%reported that the admin action failed%' THEN 'failed'
	WHEN lower(coalesce(`error`, '')) LIKE '%could not reach the actor%'
		OR lower(coalesce(`error`, '')) LIKE '%did not respond within%'
		OR lower(coalesce(`error`, '')) LIKE '%connection refused%'
		OR lower(coalesce(`error`, '')) LIKE '%econnrefused%'
		OR lower(coalesce(`error`, '')) LIKE '%enotfound%'
		OR lower(coalesce(`error`, '')) LIKE '%socket hang up%'
		OR lower(coalesce(`error`, '')) LIKE '%connection reset%'
	THEN 'unreachable'
	ELSE 'error'
END;--> statement-breakpoint
CREATE INDEX `command_audit_outcome_idx` ON `command_audit` (`outcome`);--> statement-breakpoint
ALTER TABLE `command_audit` DROP COLUMN `success`;
