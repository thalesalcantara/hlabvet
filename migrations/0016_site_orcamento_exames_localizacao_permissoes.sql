PRAGMA foreign_keys = ON;

-- Exames adicionais cadastrados pelo laboratório. Entram sempre na categoria Outros.
CREATE TABLE IF NOT EXISTS custom_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_code TEXT NOT NULL UNIQUE,
  exam_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_custom_exams_active_name ON custom_exams(active,exam_name);

-- Site público de orçamento. O endereço é sempre relativo (/orcamento), acompanhando o domínio atual.
CREATE TABLE IF NOT EXISTS quote_site_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0,
  show_prices INTEGER NOT NULL DEFAULT 1,
  show_services INTEGER NOT NULL DEFAULT 1,
  whatsapp_phone TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO quote_site_settings(id,enabled,show_prices,show_services,whatsapp_phone) VALUES(1,0,1,1,NULL);

-- Localização exata opcional do Google Maps para cliente/coleta.
ALTER TABLE clients ADD COLUMN map_url TEXT;
ALTER TABLE clients ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requisitions ADD COLUMN collection_map_url TEXT;

-- Permissões comerciais por usuário interno. Técnicos atuais continuam liberados para orçamento/valores.
ALTER TABLE receivers ADD COLUMN profile_type TEXT NOT NULL DEFAULT 'technician';
ALTER TABLE receivers ADD COLUMN can_view_prices INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receivers ADD COLUMN can_make_quotes INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receivers ADD COLUMN can_manage_payments INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receivers ADD COLUMN can_manage_prices INTEGER NOT NULL DEFAULT 0;

-- Orçamento avulso. Mantém a FK atual usando um cliente interno invisível na interface.
ALTER TABLE quotes ADD COLUMN walk_in_name TEXT;
ALTER TABLE quotes ADD COLUMN walk_in_phone TEXT;

INSERT OR IGNORE INTO users(role,username_display,username_key,password_hash,password_salt,force_password_change,active)
VALUES('client','HLabVet Avulso','__hlabvet_walkin__','DISABLED','DISABLED',0,0);

INSERT INTO clients(user_id,name,active,is_system)
SELECT u.id,'Cliente avulso',1,1
FROM users u
WHERE u.username_key='__hlabvet_walkin__'
  AND NOT EXISTS(SELECT 1 FROM clients c WHERE c.user_id=u.id);
