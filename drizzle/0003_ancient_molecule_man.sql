CREATE TABLE `waiting_list` (
	`id` int AUTO_INCREMENT NOT NULL,
	`patientId` varchar(64) NOT NULL,
	`floorId` int NOT NULL,
	`priority` enum('normal','urgent','veryUrgent') NOT NULL DEFAULT 'normal',
	`addedBy` text,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`admittedAt` timestamp,
	`status` enum('waiting','admitted') NOT NULL DEFAULT 'waiting',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `waiting_list_id` PRIMARY KEY(`id`)
);
