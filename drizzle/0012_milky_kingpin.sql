WITH `ordered_actors` AS (
	SELECT
		`id`,
		ROW_NUMBER() OVER (
			PARTITION BY `kind`
			ORDER BY `sort_order`, `created_at`, `id`
		) - 1 AS `position`
	FROM `actors`
)
UPDATE `actors`
SET `sort_order` = (
	SELECT `position`
	FROM `ordered_actors`
	WHERE `ordered_actors`.`id` = `actors`.`id`
);--> statement-breakpoint
CREATE INDEX `actors_kind_order_idx` ON `actors` (`kind`,`sort_order`);
