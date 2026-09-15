PRAGMA foreign_keys = ON;

-- Técnico com login próprio (mantém a tabela receivers por compatibilidade interna).
ALTER TABLE receivers ADD COLUMN user_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivers_user_id ON receivers(user_id) WHERE user_id IS NOT NULL;

-- Termômetro atual de cada entregador.
ALTER TABLE couriers ADD COLUMN thermometer_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_couriers_thermometer_active
ON couriers(thermometer_code)
WHERE active = 1 AND thermometer_code IS NOT NULL AND thermometer_code <> '';

-- Solicitação imediata/agendada, aceite do laboratório e rastreabilidade histórica.
ALTER TABLE requisitions ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE requisitions ADD COLUMN scheduled_at TEXT;
ALTER TABLE requisitions ADD COLUMN accepted_at TEXT;
ALTER TABLE requisitions ADD COLUMN accepted_by_user_id INTEGER;
ALTER TABLE requisitions ADD COLUMN accepted_by_name TEXT;
ALTER TABLE requisitions ADD COLUMN transport_courier_name TEXT;
ALTER TABLE requisitions ADD COLUMN transport_thermometer_code TEXT;
ALTER TABLE requisitions ADD COLUMN receiving_observation TEXT;

CREATE INDEX IF NOT EXISTS idx_req_scheduled_at ON requisitions(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_req_accepted_at ON requisitions(accepted_at);
