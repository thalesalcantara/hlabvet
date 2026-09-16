-- Garante que o login principal HLabVet permaneça como administrador do laboratório.
-- Não altera senha, não mexe nos técnicos e não toca na tabela central de usuários.
UPDATE users
SET role = 'admin',
    active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE username_key = 'hlabvet'
  AND (role <> 'admin' OR active <> 1);
