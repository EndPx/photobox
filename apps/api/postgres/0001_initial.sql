CREATE TABLE shop (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE cashier_sessions (
  digest text PRIMARY KEY,
  expires_at bigint NOT NULL
);

CREATE TABLE cashier_login_attempts (
  window_id bigint PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0)
);

CREATE TABLE vouchers (
  code text PRIMARY KEY,
  receipt text NOT NULL UNIQUE,
  cups integer NOT NULL CHECK (cups >= 2),
  discount integer NOT NULL CHECK (discount = 5000),
  created_at bigint NOT NULL,
  is_trial smallint NOT NULL DEFAULT 0 CHECK (is_trial IN (0,1))
);

CREATE TABLE promo_codes (
  code text PRIMARY KEY,
  active_slot smallint UNIQUE CHECK (active_slot BETWEEN 1 AND 5),
  created_at bigint NOT NULL,
  revoked_at bigint,
  CHECK ((active_slot IS NULL) = (revoked_at IS NOT NULL))
);

CREATE TABLE orders (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  voucher text REFERENCES vouchers(code) ON DELETE RESTRICT,
  promo_code text REFERENCES promo_codes(code) ON DELETE RESTRICT,
  base_amount integer NOT NULL CHECK (base_amount >= 0),
  discount integer NOT NULL CHECK (discount IN (0,5000)),
  total integer NOT NULL CHECK (total >= 0 AND total = base_amount - discount),
  mode text NOT NULL CHECK (mode IN ('sandbox','production')),
  status text NOT NULL CHECK (status IN ('pending','paid','completed','canceled','expired','failed')),
  is_trial smallint NOT NULL DEFAULT 0 CHECK (is_trial IN (0,1)),
  created_at bigint NOT NULL,
  paid_at bigint,
  completed_at bigint,
  provider_checked_at bigint NOT NULL DEFAULT 0,
  qr_url text,
  CHECK (voucher IS NULL OR promo_code IS NULL)
);

CREATE UNIQUE INDEX one_active_order_per_voucher ON orders(voucher)
  WHERE voucher IS NOT NULL AND status IN ('pending','paid','completed');
CREATE INDEX orders_by_creation ON orders(created_at);
CREATE INDEX orders_by_promo ON orders(promo_code) WHERE promo_code IS NOT NULL;
CREATE INDEX production_orders_by_payment ON orders(paid_at)
  WHERE mode = 'production' AND is_trial = 0 AND status IN ('paid','completed');
