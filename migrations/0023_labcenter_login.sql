-- Atualiza o administrador principal do laboratório sem recriar a conta.
-- O login é normalizado e aceita qualquer combinação de maiúsculas/minúsculas.
UPDATE users
SET username_display='LabCenter', username_key='labcenter',role='admin',
password_hash='DbzMzYOk0Kv80xBF_ViuYjEWedt9Mtqd7RUHrk0-8Mk',
password_salt='0TwbnvS3iIeIAbgymD1OBg',
force_password_change=0, active=1, updated_at=CURRENT_TIMESTAMP
WHERE username_key IN ('petlab','hlabvet')
AND role='admin'
AND NOT EXISTS(SELECT 1 FROM users WHERE username_key='labcenter');

UPDATE users
SET username_display='LabCenter',role='admin',
password_hash='DbzMzYOk0Kv80xBF_ViuYjEWedt9Mtqd7RUHrk0-8Mk',
password_salt='0TwbnvS3iIeIAbgymD1OBg',
force_password_change=0, active=1, updated_at=CURRENT_TIMESTAMP
WHERE username_key='labcenter' AND role='admin';

DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username_key='labcenter' AND role='admin');
