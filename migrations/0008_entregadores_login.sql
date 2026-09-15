PRAGMA foreign_keys = ON;

-- Login próprio do entregador/cooperado para uso no painel móvel e futuro APK.
-- A tabela users mantém role='staff' por compatibilidade com o CHECK inicial;
-- a aplicação identifica o perfil de entregador pelo vínculo abaixo.
ALTER TABLE couriers ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_couriers_user_id ON couriers(user_id) WHERE user_id IS NOT NULL;

-- Os entregadores já existentes continuam cadastrados normalmente.
-- O administrador deve abrir cada cadastro antigo e definir usuário + senha temporária.
-- O token/link antigo é mantido apenas por compatibilidade e deixa de ser o acesso principal.
