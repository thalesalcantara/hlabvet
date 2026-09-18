PRAGMA foreign_keys = ON;

-- Promoções podem abrir como propaganda ao entrar no site.
ALTER TABLE site_offers ADD COLUMN show_popup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_offers ADD COLUMN popup_seconds INTEGER NOT NULL DEFAULT 5;

-- Parceiros/clientes exibidos em carrossel de logos no site público.
CREATE TABLE IF NOT EXISTS site_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  website_url TEXT,
  logo_r2_key TEXT,
  logo_mime TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_site_partners_active_sort ON site_partners(active,sort_order,id);
