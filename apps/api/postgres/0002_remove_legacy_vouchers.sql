LOCK TABLE orders, vouchers IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM vouchers) OR EXISTS (SELECT 1 FROM orders WHERE voucher IS NOT NULL) THEN
    RAISE EXCEPTION 'Legacy voucher records exist. Review the data before applying this migration.';
  END IF;
END
$migration$;
--> statement-breakpoint
ALTER TABLE orders DROP COLUMN voucher;
--> statement-breakpoint
DROP TABLE vouchers;
