ALTER TABLE `waiting_list` ADD `durationMinutes` int DEFAULT 240 NOT NULL;--> statement-breakpoint
ALTER TABLE `waiting_list` ADD `isolationTag` enum('clean','dirty') DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE `waiting_list` ADD `assignedNurse` varchar(64);