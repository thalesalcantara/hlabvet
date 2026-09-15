PRAGMA foreign_keys = ON;

-- Usuários adicionais do cliente. O usuário principal já existente também passa a
-- ter um perfil nesta tabela, sem carimbo obrigatório.
CREATE TABLE IF NOT EXISTS client_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  can_manage_users INTEGER NOT NULL DEFAULT 0,
  is_technician INTEGER NOT NULL DEFAULT 0,
  function_title TEXT,
  council_name TEXT DEFAULT 'CRMV',
  council_number TEXT,
  council_state TEXT DEFAULT 'RN',
  stamp_color TEXT DEFAULT '#5c2a72',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_client_members_client ON client_members(client_id);
CREATE INDEX IF NOT EXISTS idx_client_members_active ON client_members(client_id,active);

INSERT OR IGNORE INTO client_members (
  client_id,user_id,name,can_manage_users,is_technician,function_title,
  council_name,council_number,council_state,stamp_color,active
)
SELECT c.id,c.user_id,c.name,1,0,NULL,'CRMV',NULL,COALESCE(c.state,'RN'),COALESCE(c.stamp_color,'#5c2a72'),c.active
FROM clients c;

-- Tabela geral de preços por exame.
CREATE TABLE IF NOT EXISTS exam_prices (
  exam_code TEXT PRIMARY KEY,
  exam_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Preço negociado específico por cliente. Quando existir, substitui o preço geral.
CREATE TABLE IF NOT EXISTS client_exam_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  exam_code TEXT NOT NULL,
  exam_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_id,exam_code),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_client_exam_prices_client ON client_exam_prices(client_id);

-- Snapshot do valor usado no momento da solicitação/precificação pendente.
ALTER TABLE requisition_exams ADD COLUMN unit_price_cents INTEGER;
ALTER TABLE requisition_exams ADD COLUMN price_source TEXT;

-- Rastreabilidade do cancelamento.
ALTER TABLE requisitions ADD COLUMN cancelled_at TEXT;
ALTER TABLE requisitions ADD COLUMN cancelled_by_user_id INTEGER;
ALTER TABLE requisitions ADD COLUMN cancelled_by_name TEXT;
ALTER TABLE requisitions ADD COLUMN cancelled_by_role TEXT;
ALTER TABLE requisitions ADD COLUMN requested_by_user_id INTEGER;
ALTER TABLE requisitions ADD COLUMN requested_by_name TEXT;

-- Alertas operacionais persistentes. Usado principalmente para cancelamento feito pelo cliente.
CREATE TABLE IF NOT EXISTS lab_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  requisition_id INTEGER,
  client_id INTEGER,
  title TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TEXT,
  acknowledged_by_user_id INTEGER,
  acknowledged_by_name TEXT,
  FOREIGN KEY(requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(acknowledged_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_alerts_open ON lab_alerts(acknowledged_at,created_at);
CREATE INDEX IF NOT EXISTS idx_lab_alerts_req ON lab_alerts(requisition_id);
