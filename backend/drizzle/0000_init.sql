CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activities_client_idx` ON `activities` (`client_id`);--> statement-breakpoint
CREATE INDEX `activities_entity_idx` ON `activities` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`siren` text,
	`vat_number` text,
	`email` text,
	`contact_name` text,
	`phone` text,
	`address` text,
	`channel` text DEFAULT 'DIRECT' NOT NULL,
	`malt_fee_bps` integer,
	`payment_terms_days` integer,
	`notes` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`at` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_label` text DEFAULT '' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`body_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_key_idx` ON `idempotency_records` (`key`);--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`label` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'DAY' NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`vat_rate_bps` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text,
	`external_ref` text,
	`kind` text DEFAULT 'INVOICE' NOT NULL,
	`credited_invoice_id` integer,
	`client_id` integer NOT NULL,
	`opportunity_id` integer,
	`quote_id` integer,
	`channel` text DEFAULT 'DIRECT' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`title` text NOT NULL,
	`issue_date` text,
	`service_start` text,
	`service_end` text,
	`due_date` text,
	`payment_terms_days` integer DEFAULT 30 NOT NULL,
	`malt_fee_bps` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`total_ht_cents` integer DEFAULT 0 NOT NULL,
	`total_vat_cents` integer DEFAULT 0 NOT NULL,
	`total_ttc_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`client_snapshot` text,
	`seller_snapshot` text,
	`reminders_enabled` integer DEFAULT true NOT NULL,
	`issued_at` text,
	`paid_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE INDEX `invoices_client_idx` ON `invoices` (`client_id`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`title` text NOT NULL,
	`stage` text DEFAULT 'NEW' NOT NULL,
	`source` text DEFAULT 'MALT' NOT NULL,
	`malt_url` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`daily_rate_cents` integer,
	`days_milli` integer,
	`probability` integer DEFAULT 10 NOT NULL,
	`expected_close_date` text,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_date` text,
	`lost_reason` text,
	`projets_project_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`stage_changed_at` text,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `opportunities_stage_idx` ON `opportunities` (`stage`);--> statement-breakpoint
CREATE INDEX `opportunities_client_idx` ON `opportunities` (`client_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`received_on` text NOT NULL,
	`method` text DEFAULT 'TRANSFER' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`tresorerie_status` text DEFAULT 'PENDING' NOT NULL,
	`tresorerie_transaction_ids` text DEFAULT '[]' NOT NULL,
	`tresorerie_error` text,
	`synced_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quote_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quote_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`label` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'DAY' NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`vat_rate_bps` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text NOT NULL,
	`client_id` integer NOT NULL,
	`opportunity_id` integer,
	`channel` text DEFAULT 'DIRECT' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`title` text NOT NULL,
	`issue_date` text NOT NULL,
	`valid_until` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`total_ht_cents` integer DEFAULT 0 NOT NULL,
	`total_vat_cents` integer DEFAULT 0 NOT NULL,
	`total_ttc_cents` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`decided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_number_unique` ON `quotes` (`number`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`level` integer NOT NULL,
	`due_on` text NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`to_email` text,
	`subject` text,
	`brevo_message_id` text,
	`error` text,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`status`,`due_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_invoice_level_idx` ON `reminders` (`invoice_id`,`level`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projets_entry_id` integer NOT NULL,
	`projets_project_id` integer NOT NULL,
	`projets_project_name` text NOT NULL,
	`work_item_id` integer NOT NULL,
	`work_item_title` text NOT NULL,
	`work_item_type` text DEFAULT 'TASK' NOT NULL,
	`spent_on` text NOT NULL,
	`minutes` integer NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`invoice_line_id` integer,
	`changed_after_billing` integer DEFAULT false NOT NULL,
	`removed_in_projets` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`invoice_line_id`) REFERENCES `invoice_lines`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_projets_idx` ON `time_entries` (`projets_entry_id`);--> statement-breakpoint
CREATE INDEX `time_entries_project_idx` ON `time_entries` (`projets_project_id`);--> statement-breakpoint
CREATE INDEX `time_entries_line_idx` ON `time_entries` (`invoice_line_id`);