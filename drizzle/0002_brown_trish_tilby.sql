CREATE TABLE `floors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(16) NOT NULL,
	`name` varchar(64) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `floors_id` PRIMARY KEY(`id`),
	CONSTRAINT `floors_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `machines` ADD `floorId` int;