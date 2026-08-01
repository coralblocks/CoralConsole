UPDATE `actors` SET `account` = `name`;--> statement-breakpoint
DROP INDEX `actors_endpoint_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `actors_identity_unique` ON `actors` (`host`,`port`,`account`);
