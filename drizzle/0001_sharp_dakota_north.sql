CREATE TABLE `machines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(32) NOT NULL,
	`location` varchar(64) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `machines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`patientId` varchar(64) NOT NULL,
	`durationMinutes` int NOT NULL,
	`startedAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`isolationTag` enum('clean','dirty') NOT NULL DEFAULT 'clean',
	`urgent` boolean NOT NULL DEFAULT false,
	`status` enum('active','ended') NOT NULL DEFAULT 'active',
	`endedAt` timestamp,
	`endedBy` text,
	`startedBy` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
