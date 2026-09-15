-- Administrador central padrão do HLabVet.
-- Usuário é normalizado como "hlabvet", portanto HLABVET, HLabVet, hlabvet etc. funcionam.
-- Senha temporária: lab123. O primeiro acesso exige troca de senha.

INSERT INTO users (
  role,
  username_display,
  username_key,
  password_hash,
  password_salt,
  force_password_change,
  active,
  created_at,
  updated_at
)
VALUES (
  'admin',
  'HLabVet',
  'hlabvet',
  '3qFpat1YI240bQIYSIrc8AR0SsJ4f7ph-CuZveFvUhs',
  'pinBnr9TtE24ToDkIXYa6g',
  1,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(username_key) DO UPDATE SET
  role = 'admin',
  username_display = 'HLabVet',
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  force_password_change = 1,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;
