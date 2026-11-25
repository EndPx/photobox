CREATE TABLE promo_codes (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN promo_code TEXT REFERENCES promo_codes(code);
