ALTER TABLE orders ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0 CHECK (is_trial IN (0, 1));
--> statement-breakpoint
ALTER TABLE vouchers ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0 CHECK (is_trial IN (0, 1));
