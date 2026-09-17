PRAGMA foreign_keys = ON;

-- Serviços adicionais usados nos orçamentos.
CREATE TABLE IF NOT EXISTS service_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_service_prices_active ON service_prices(active,name);

-- Orçamentos profissionais. Podem ser independentes ou vinculados a uma solicitação.
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL,
  requisition_id INTEGER UNIQUE,
  patient_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
  notes TEXT,
  valid_until TEXT,
  created_by_user_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(requisition_id) REFERENCES requisitions(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id,created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_requisition ON quotes(requisition_id);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('exam','service')),
  item_ref TEXT,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id,sort_order,id);

-- Cobrança informada ao entregador somente quando houver valor a receber na coleta.
ALTER TABLE requisitions ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'not_set';
ALTER TABLE requisitions ADD COLUMN payment_method TEXT;
ALTER TABLE requisitions ADD COLUMN payment_installments INTEGER;
ALTER TABLE requisitions ADD COLUMN payment_amount_cents INTEGER;
ALTER TABLE requisitions ADD COLUMN paid_at TEXT;
ALTER TABLE requisitions ADD COLUMN payment_updated_at TEXT;
ALTER TABLE requisitions ADD COLUMN payment_updated_by_name TEXT;
