# Segurança — HLab Vet Resultados

- Senhas são armazenadas com PBKDF2-SHA-256 e salt individual; nunca em texto puro.
- O nome de usuário é normalizado para ignorar diferenças de maiúsculas/minúsculas e acentos. A senha permanece exata e sensível a maiúsculas/minúsculas.
- Sessões usam cookie HttpOnly + SameSite=Lax; em HTTPS o cookie recebe Secure.
- Arquivos de resultados ficam no R2 privado e só são baixados pela API após autorização.
- Links de entregadores são segredos de acesso. Ao regenerar um link, o anterior é invalidado.
- Exclusão de cliente é lógica (desativação), preservando rastreabilidade de exames e auditoria.
- O sistema mantém trilha de auditoria para ações administrativas relevantes.
- Em produção, use uma SETUP_KEY longa, aleatória e exclusiva e mantenha os segredos somente no Cloudflare/GitHub Secrets.
- Faça backup periódico do D1 e defina política de retenção dos arquivos do R2 conforme sua operação e obrigações de privacidade/LGPD.
