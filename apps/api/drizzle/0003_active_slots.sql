ALTER TABLE promo_codes ADD COLUMN active_slot INTEGER CHECK (active_slot BETWEEN 1 AND 5);
--> statement-breakpoint
WITH ranks AS (
  SELECT code, ROW_NUMBER() OVER (ORDER BY created_at, code) AS slot FROM promo_codes WHERE revoked_at IS NULL
)
UPDATE promo_codes SET active_slot = (SELECT slot FROM ranks WHERE ranks.code = promo_codes.code)
WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX promo_active_slot ON promo_codes(active_slot);
--> statement-breakpoint
CREATE TABLE cashier_login_attempts (
  window_id INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);
