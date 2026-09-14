PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('admin','staff','client')),
  username_display TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  force_password_change INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  document TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'RN',
  zip_code TEXT,
  stamp_name TEXT,
  stamp_line2 TEXT,
  stamp_line3 TEXT,
  stamp_line4 TEXT,
  stamp_color TEXT DEFAULT '#5c2a72',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

CREATE TABLE IF NOT EXISTS couriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  token_last4 TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_couriers_name ON couriers(name);

CREATE TABLE IF NOT EXISTS receivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'solicitado' CHECK(status IN ('solicitado','atribuido','coletado','recebido','em_analise','concluido','cancelado')),
  clinic_name TEXT,
  veterinarian_name TEXT,
  crmv TEXT,
  tutor_name TEXT,
  patient_name TEXT NOT NULL,
  species TEXT,
  breed TEXT,
  sex TEXT,
  birth_date TEXT,
  age_text TEXT,
  collection_date TEXT,
  clinical_info TEXT,
  material_other TEXT,
  stamp_snapshot_json TEXT,
  assigned_courier_id INTEGER,
  assigned_at TEXT,
  collected_at TEXT,
  collection_temperature REAL,
  sent_by_name TEXT,
  sent_from_location TEXT,
  lab_received_at TEXT,
  lab_received_temperature REAL,
  receiver_id INTEGER,
  receiver_name TEXT,
  received_location TEXT,
  analysis_started_at TEXT,
  completed_at TEXT,
  cancellation_reason TEXT,
  observations TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  FOREIGN KEY(assigned_courier_id) REFERENCES couriers(id) ON DELETE SET NULL,
  FOREIGN KEY(receiver_id) REFERENCES receivers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_req_client ON requisitions(client_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON requisitions(status);
CREATE INDEX IF NOT EXISTS idx_req_created ON requisitions(created_at);
CREATE INDEX IF NOT EXISTS idx_req_patient ON requisitions(patient_name);
CREATE INDEX IF NOT EXISTS idx_req_tutor ON requisitions(tutor_name);
CREATE INDEX IF NOT EXISTS idx_req_birth ON requisitions(birth_date);
CREATE INDEX IF NOT EXISTS idx_req_breed ON requisitions(breed);
CREATE INDEX IF NOT EXISTS idx_req_courier ON requisitions(assigned_courier_id);

CREATE TABLE IF NOT EXISTS requisition_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  exam_code TEXT NOT NULL,
  exam_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_req_exams_req ON requisition_exams(requisition_id);
CREATE INDEX IF NOT EXISTS idx_req_exams_name ON requisition_exams(exam_name);

CREATE TABLE IF NOT EXISTS requisition_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL,
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  FOREIGN KEY(requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_req_materials_req ON requisition_materials(requisition_id);

CREATE TABLE IF NOT EXISTS status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_name TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_status_req ON status_events(requisition_id);
CREATE INDEX IF NOT EXISTS idx_status_created ON status_events(created_at);

CREATE TABLE IF NOT EXISTS result_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY(uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_results_req ON result_files(requisition_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
