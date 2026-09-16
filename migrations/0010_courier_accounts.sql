-- HLabVet: login próprio do entregador, separado da tabela users.
-- Não altera users, sessions, clients, technicians ou tutores.

CREATE TABLE IF NOT EXISTS courier_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  courier_id INTEGER NOT NULL UNIQUE,
  username_display TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  force_password_change INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(courier_id) REFERENCES couriers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS courier_sessions (
  token_hash TEXT PRIMARY KEY,
  courier_account_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(courier_account_id) REFERENCES courier_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_courier_accounts_courier_id
  ON courier_accounts(courier_id);

CREATE INDEX IF NOT EXISTS idx_courier_accounts_username_key
  ON courier_accounts(username_key);

CREATE INDEX IF NOT EXISTS idx_courier_sessions_account
  ON courier_sessions(courier_account_id);

CREATE INDEX IF NOT EXISTS idx_courier_sessions_expires
  ON courier_sessions(expires_at);
