DROP INDEX one_active_order_per_voucher;
--> statement-breakpoint
ALTER TABLE orders DROP COLUMN voucher;
--> statement-breakpoint
DROP TABLE vouchers;
