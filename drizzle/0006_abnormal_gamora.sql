CREATE TABLE `staff_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`displayName` varchar(64) NOT NULL,
	`role` enum('nurse','supervisor') NOT NULL,
	`assignedFloorId` int,
	`passwordHash` varchar(128) NOT NULL,
	`passwordSalt` varchar(32) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignedIn` timestamp,
	CONSTRAINT `staff_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_accounts_username_unique` UNIQUE(`username`)
);
