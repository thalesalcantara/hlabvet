-- Analisador de resultados exclusivo do cliente/clínica + índices leves para gráficos.
-- Não altera a tabela users e não interfere no login do laboratório, técnicos ou entregadores.

CREATE TABLE IF NOT EXISTS result_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_file_id INTEGER NOT NULL UNIQUE,
  requisition_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_result_analyses_client ON result_analyses(client_id);
CREATE INDEX IF NOT EXISTS idx_result_analyses_requisition ON result_analyses(requisition_id);

-- Índices para manter o painel com gráficos rápido sem biblioteca pesada.
CREATE INDEX IF NOT EXISTS idx_requisitions_created_at ON requisitions(created_at);
CREATE INDEX IF NOT EXISTS idx_requisitions_status_created_at ON requisitions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_requisitions_client_created_at ON requisitions(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_requisition_exams_requisition_id ON requisition_exams(requisition_id);
