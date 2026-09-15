PRAGMA foreign_keys = ON;

-- Tutor / cliente final: acesso próprio para visualizar apenas seus resultados.
-- O usuário continua armazenado na tabela users com role='client' por compatibilidade
-- com o CHECK do banco inicial; a aplicação identifica o perfil pela tabela tutors.
CREATE TABLE IF NOT EXISTS tutors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tutors_client ON tutors(client_id,active,name);
CREATE INDEX IF NOT EXISTS idx_tutors_user ON tutors(user_id);

-- Vincula a solicitação ao tutor que poderá enxergar o resultado.
-- Tutor textual continua existindo em tutor_name para solicitações sem login.
ALTER TABLE requisitions ADD COLUMN tutor_account_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_req_tutor_account ON requisitions(tutor_account_id);
