-- Prioridade da solicitação + controle de prazo por exame.
-- O cronômetro de cada exame começa somente quando a amostra é recebida no laboratório.

ALTER TABLE requisitions ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE requisition_exams ADD COLUMN turnaround_minutes INTEGER;
ALTER TABLE requisition_exams ADD COLUMN due_at TEXT;
ALTER TABLE requisition_exams ADD COLUMN completed_at TEXT;
ALTER TABLE requisition_exams ADD COLUMN completed_by_user_id INTEGER;
ALTER TABLE requisition_exams ADD COLUMN completed_by_name TEXT;
ALTER TABLE requisition_exams ADD COLUMN completed_within_sla INTEGER;

CREATE TABLE IF NOT EXISTS lab_timing_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_turnaround_minutes INTEGER NOT NULL DEFAULT 1440,
  warning_minutes INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO lab_timing_settings(id, default_turnaround_minutes, warning_minutes)
VALUES(1, 1440, 10);

CREATE TABLE IF NOT EXISTS exam_turnaround_settings (
  exam_code TEXT PRIMARY KEY,
  exam_name TEXT NOT NULL,
  turnaround_minutes INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_req_exams_due_at ON requisition_exams(due_at);
CREATE INDEX IF NOT EXISTS idx_req_exams_completed_at ON requisition_exams(completed_at);
CREATE INDEX IF NOT EXISTS idx_req_priority ON requisitions(priority);
CREATE INDEX IF NOT EXISTS idx_req_received_at ON requisitions(lab_received_at);
