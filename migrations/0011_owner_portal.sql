PRAGMA foreign_keys = ON;

-- Painel do proprietário do HLabVet.
-- Autenticação totalmente separada de users/sessions do laboratório.
CREATE TABLE IF NOT EXISTS owner_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username_display TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_account_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_account_id) REFERENCES owner_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_owner_sessions_account ON owner_sessions(owner_account_id);
CREATE INDEX IF NOT EXISTS idx_owner_sessions_expires ON owner_sessions(expires_at);

-- Faixas comerciais editáveis pelo proprietário.
CREATE TABLE IF NOT EXISTS owner_pricing_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  min_clients INTEGER NOT NULL,
  max_clients INTEGER,
  monthly_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(min_clients >= 0),
  CHECK(max_clients IS NULL OR max_clients >= min_clients),
  CHECK(monthly_cents >= 0)
);

CREATE TABLE IF NOT EXISTS owner_contract_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  contracted_monthly_cents INTEGER,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER NOT NULL DEFAULT 10,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(contracted_monthly_cents IS NULL OR contracted_monthly_cents >= 0),
  CHECK(discount_cents >= 0),
  CHECK(due_day BETWEEN 1 AND 28)
);

CREATE TABLE IF NOT EXISTS owner_backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER,
  kind TEXT NOT NULL DEFAULT 'logical',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Login inicial do proprietário informado pelo titular.
-- A senha NÃO fica em texto puro: somente PBKDF2-SHA256 + salt.
INSERT INTO owner_accounts (
  username_display, username_key, password_hash, password_salt, active, created_at, updated_at
) VALUES (
  'THALES ALCANTARA',
  'thales alcantara',
  'XTC_mvPGF5CWPeNYXzX2IILbQdxpHoeTzfpm0rejirw',
  '_Nd8I9r8nUP2qDOSyuNakQ',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(username_key) DO NOTHING;

INSERT OR IGNORE INTO owner_contract_settings(id, contracted_monthly_cents, discount_cents, due_day)
VALUES(1, NULL, 0, 10);

-- Tabela inicial de preços sugerida para lançamento do HLabVet.
INSERT INTO owner_pricing_tiers(min_clients,max_clients,monthly_cents,sort_order)
SELECT 1,10,24900,1 WHERE NOT EXISTS (SELECT 1 FROM owner_pricing_tiers);
INSERT INTO owner_pricing_tiers(min_clients,max_clients,monthly_cents,sort_order)
SELECT 11,25,34900,2 WHERE (SELECT COUNT(*) FROM owner_pricing_tiers)=1;
INSERT INTO owner_pricing_tiers(min_clients,max_clients,monthly_cents,sort_order)
SELECT 26,50,44900,3 WHERE (SELECT COUNT(*) FROM owner_pricing_tiers)=2;
INSERT INTO owner_pricing_tiers(min_clients,max_clients,monthly_cents,sort_order)
SELECT 51,100,59900,4 WHERE (SELECT COUNT(*) FROM owner_pricing_tiers)=3;
INSERT INTO owner_pricing_tiers(min_clients,max_clients,monthly_cents,sort_order)
SELECT 101,200,79900,5 WHERE (SELECT COUNT(*) FROM owner_pricing_tiers)=4;
INSERT INTO owner_pricing_tiers(min_clients,max_clients,monthly_cents,sort_order)
SELECT 201,NULL,99900,6 WHERE (SELECT COUNT(*) FROM owner_pricing_tiers)=5;
