CREATE TABLE shop (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE cashier_sessions (
  digest TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE vouchers (
  code TEXT PRIMARY KEY,
  receipt TEXT NOT NULL UNIQUE,
  cups INTEGER NOT NULL CHECK (cups >= 2),
  discount INTEGER NOT NULL CHECK (discount = 5000),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  voucher TEXT REFERENCES vouchers(code),
  base_amount INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  total INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'production')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'completed', 'canceled', 'expired', 'failed')),
  created_at INTEGER NOT NULL,
  qr_url TEXT,
  provider_checked_at INTEGER NOT NULL DEFAULT 0,
  paid_at INTEGER,
  completed_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_order_per_voucher ON orders(voucher)
  WHERE voucher IS NOT NULL AND status IN ('pending', 'paid', 'completed');
--> statement-breakpoint
CREATE INDEX orders_by_creation ON orders(created_at);
