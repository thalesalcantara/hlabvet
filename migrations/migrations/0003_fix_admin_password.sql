UPDATE users
SET
  password_hash = 'TwP_yjkuugIsPRV71Z4e0rVeTcmPgXU7YImyBgrCPLI',
  password_salt = 'pinBnr9TtE24ToDkIXYa6g',
  force_password_change = 1,
  active = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE username_key = 'hlabvet';
