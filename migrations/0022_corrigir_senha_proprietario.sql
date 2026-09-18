PRAGMA foreign_keys = ON;

-- Corrige a credencial do proprietário já existente no banco de produção.
-- A senha continua armazenada somente como PBKDF2-SHA256 + salt.
UPDATE owner_accounts
SET username_display = 'THALES ALCANTARA',
    username_key = 'thales alcantara',
    password_hash = 'MESN8g_8GMNR0hk13RvyUDZ8krzTjGJjkI3kwIGTvDw',
    password_salt = 'YXpretAgP697oWxPUMFJsQ',
    active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = (
  SELECT id
  FROM owner_accounts
  ORDER BY id
  LIMIT 1
);
