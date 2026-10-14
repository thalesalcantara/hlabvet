-- Atualização de acesso do administrador do laboratório LabCenter.
-- Preserva o ID do administrador HLabVet e seus registros vinculados.
-- Não altera a conta independente do proprietário.
UPDATE users
SET username_display='petlab',
    username_key='petlab',
    role='admin',
    password_hash='CGdrmZWpEYIR9PXh3Oc-i3qhFl0jAlz7fDKIg1SmRPU',
    password_salt='w06RrA0CfiyrLBoHRaQLfA',
    force_password_change=0,
    active=1,
    updated_at=CURRENT_TIMESTAMP
WHERE username_key='hlabvet'
  AND NOT EXISTS(SELECT 1 FROM users WHERE username_key='petlab');

-- Se o usuário petlab já existia como administrador, atualiza suas credenciais.
UPDATE users
SET username_display='petlab',
    role='admin',
    password_hash='CGdrmZWpEYIR9PXh3Oc-i3qhFl0jAlz7fDKIg1SmRPU',
    password_salt='w06RrA0CfiyrLBoHRaQLfA',
    force_password_change=0,
    active=1,
    updated_at=CURRENT_TIMESTAMP
WHERE username_key='petlab' AND role='admin';

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE username_key='petlab' AND role='admin');
