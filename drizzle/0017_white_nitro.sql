DELETE FROM `actors` WHERE `demo` = 1;--> statement-breakpoint
ALTER TABLE `actors` DROP COLUMN `demo`;
