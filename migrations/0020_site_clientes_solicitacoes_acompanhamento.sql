PRAGMA foreign_keys = ON;

-- Cadastro persistente do tutor/cliente vindo do site público.
CREATE TABLE IF NOT EXISTS site_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone_key TEXT NOT NULL UNIQUE,
  phone_display TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'RN',
  zip_code TEXT,
  tutor_account_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tutor_account_id) REFERENCES tutors(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_site_customers_name ON site_customers(name);
CREATE INDEX IF NOT EXISTS idx_site_customers_phone ON site_customers(phone_key);

-- Animais ficam vinculados ao cadastro do cliente para reaproveitamento em novos pedidos.
CREATE TABLE IF NOT EXISTS site_pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  birth_date TEXT,
  species TEXT,
  breed TEXT,
  sex TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(site_customer_id) REFERENCES site_customers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_site_pets_customer ON site_pets(site_customer_id,id);

-- Sessão temporária usada apenas para visualizar andamento/resultado depois da conferência por telefone.
CREATE TABLE IF NOT EXISTS site_customer_sessions (
  token_hash TEXT PRIMARY KEY,
  site_customer_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(site_customer_id) REFERENCES site_customers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_site_customer_sessions_expires ON site_customer_sessions(expires_at);

ALTER TABLE quotes ADD COLUMN site_customer_id INTEGER;
ALTER TABLE quotes ADD COLUMN site_pet_id INTEGER;

ALTER TABLE requisitions ADD COLUMN site_customer_id INTEGER;
ALTER TABLE requisitions ADD COLUMN site_pet_id INTEGER;
ALTER TABLE requisitions ADD COLUMN collection_address TEXT;
ALTER TABLE requisitions ADD COLUMN request_source TEXT NOT NULL DEFAULT 'panel';

CREATE INDEX IF NOT EXISTS idx_quotes_site_customer ON quotes(site_customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_requisitions_site_customer ON requisitions(site_customer_id,created_at);
