PRAGMA foreign_keys = ON;

-- O entregador precisa aceitar a coleta antes de registrar a retirada.
-- O toque do painel móvel permanece ativo enquanto houver coleta atribuída sem aceite.
ALTER TABLE requisitions ADD COLUMN courier_accepted_at TEXT;
ALTER TABLE requisitions ADD COLUMN courier_accepted_name TEXT;

CREATE INDEX IF NOT EXISTS idx_req_courier_acceptance
ON requisitions(assigned_courier_id, status, courier_accepted_at);
