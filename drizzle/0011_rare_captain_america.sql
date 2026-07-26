ALTER TABLE `actors` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `ordered_actors` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) - 1 AS `position`
	FROM `actors`
)
UPDATE `actors`
SET `sort_order` = (
	SELECT `position`
	FROM `ordered_actors`
	WHERE `ordered_actors`.`id` = `actors`.`id`
);
