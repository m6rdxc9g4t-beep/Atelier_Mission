CREATE TABLE `einvoice_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transmission_id` integer NOT NULL,
	`remote_event_id` integer NOT NULL,
	`status_code` text NOT NULL,
	`status_text` text,
	`reason` text,
	`at` text NOT NULL,
	FOREIGN KEY (`transmission_id`) REFERENCES `einvoice_transmissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `einvoice_events_remote_idx` ON `einvoice_events` (`remote_event_id`);--> statement-breakpoint
CREATE TABLE `einvoice_payment_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL,
	`remote_event_id` integer,
	`error` text,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `einvoice_payment_reports_payment_idx` ON `einvoice_payment_reports` (`payment_id`);--> statement-breakpoint
CREATE TABLE `einvoice_transmissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`platform` text DEFAULT 'SUPERPDP' NOT NULL,
	`remote_id` integer,
	`state` text DEFAULT 'SENDING' NOT NULL,
	`last_status_code` text,
	`last_status_text` text,
	`last_event_at` text,
	`error` text,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `einvoice_transmissions_invoice_idx` ON `einvoice_transmissions` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `einvoice_transmissions_remote_idx` ON `einvoice_transmissions` (`remote_id`);