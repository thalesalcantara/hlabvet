# HLab Vet Resultados

Aplicativo web profissional para o **HLabVet Diagnósticos Veterinários**, pronto para versionamento no GitHub e publicação em **Cloudflare Workers + D1 + R2**.

## O que já está implementado

### HLab Vet / administrador
- Cadastro de clientes com nome de usuário e senha inicial.
- Edição, desativação/exclusão lógica e redefinição de senha do cliente.
- Cadastro de entregadores e geração de **link privado individual**.
- Cadastro de pessoas autorizadas a receber amostras no laboratório.
- Recebimento de todas as solicitações de exames.
- Atribuição de entregador a cada coleta.
- Registro do recebimento no laboratório com **data/hora automáticas**, temperatura, local e nome de quem recebeu.
- Mudança de status para **Em análise** e **Concluído**.
- Envio de resultados em PDF, Word ou outra extensão (até 25 MB por arquivo).
- Busca e filtros por período, protocolo, cliente, animal, tutor, nascimento, raça, espécie, veterinário, CRMV, exame, material e conteúdo clínico.
- Impressão de uma ou várias requisições e opção **Salvar como PDF** pelo navegador.
- Controle mensal de temperatura com ficha de 45 linhas por página, separada por mês.
- Auditoria de ações administrativas.

### Cliente
- Login com nome de usuário **sem diferença entre maiúsculas/minúsculas e acentos**: `JOAO`, `joao` e `João` apontam para o mesmo usuário.
- A **senha é exata** e diferencia maiúsculas/minúsculas.
- No primeiro login, troca obrigatória da senha inicial.
- Cadastro do próprio carimbo por linhas de texto e cor da tinta, com prévia visual parecida com carimbo real.
- Preenchimento da requisição de exames baseada no formulário físico HLabVet.
- Seleção dos exames por categoria e do material enviado.
- Acompanhamento em tempo real do andamento: Solicitado → Entregador atribuído → Coletado → Recebido → Em análise → Concluído.
- Visualização e download dos resultados.
- Pesquisa do histórico por data, animal, nascimento, raça, tutor e demais dados disponíveis.
- Consulta e impressão das fichas mensais de temperatura.

### Entregador
- Acesso pelo próprio link privado, sem enxergar outros entregadores.
- Aba **Pendentes** com cliente, endereço, contato e dados da coleta.
- Ação **Coletado** registra automaticamente a data e a hora.
- Campo obrigatório de temperatura na coleta.
- Registro de quem entregou a amostra e do local de envio.
- Depois da coleta, o atendimento sai de Pendentes e entra em **Coletados / histórico**.
- Filtro de histórico por intervalo de datas.

## Requisição de exames reproduzida no sistema

O formulário digital contém os grupos vistos no modelo HLabVet:

- Hematologia
- Análise fecal
- Urinálises
- Citologia
- Parasitologia
- Testes rápidos
- Sorologias
- Bioquímica
- Fluidos biológicos
- Material enviado
- Informações clínicas / observações
- Carimbo

A impressão usa layout A4 e pode ser salva em PDF pelo navegador.

## Tecnologia

- **Frontend:** HTML, CSS e JavaScript responsivo, sem framework externo.
- **Backend:** Cloudflare Worker.
- **Banco:** Cloudflare D1 (SQLite).
- **Arquivos de resultados:** Cloudflare R2 privado.
- **Autenticação:** sessão por cookie HttpOnly e senhas PBKDF2-SHA-256.
- **Deploy:** Wrangler ou GitHub Actions.

---

# Instalação local no Windows

## 1. Instale

- Node.js 20 ou superior
- Git
- Conta Cloudflare

No PowerShell, dentro da pasta do projeto:

```powershell
npm install
copy .dev.vars.example .dev.vars
```

Edite `.dev.vars` e troque a `SETUP_KEY` por uma chave forte.

## 2. Criar banco D1

Faça login no Cloudflare:

```powershell
npx wrangler login
```

Crie o banco:

```powershell
npx wrangler d1 create hlab-vet-resultados-db
```

O comando exibirá um `database_id`. Abra `wrangler.jsonc` e substitua:

```text
REPLACE_WITH_D1_DATABASE_ID
```

pelo ID real.

## 3. Criar bucket R2

```powershell
npx wrangler r2 bucket create hlab-vet-resultados-files
```

## 4. Aplicar banco local

```powershell
npm run db:migrate:local
npm run dev
```

Abra o endereço mostrado pelo Wrangler, normalmente `http://localhost:8787`.

Na tela de login, abra **Configuração inicial do sistema**, informe a `SETUP_KEY`, o usuário administrador e a senha inicial.

---

# Publicação no Cloudflare

## 1. Aplicar migrations no D1 remoto

```powershell
npm run db:migrate:remote
```

## 2. Salvar a chave de configuração como segredo

```powershell
npx wrangler secret put SETUP_KEY
```

Digite uma chave longa e aleatória.

## 3. Publicar

```powershell
npm run deploy
```

Depois abra a URL fornecida pelo Cloudflare e faça a **Configuração inicial** uma única vez.

---

# Colocar no GitHub

Crie um repositório vazio no GitHub e, dentro da pasta do projeto:

```powershell
git init
git add .
git commit -m "HLab Vet Resultados - versão inicial"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/hlab-vet-resultados.git
git push -u origin main
```

## Deploy automático pelo GitHub

O projeto já contém `.github/workflows/deploy.yml`.

No repositório GitHub, adicione em **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

O `CLOUDFLARE_API_TOKEN` precisa de permissões compatíveis com Workers, D1 e R2 usados pelo projeto.

Após isso, cada `push` na branch `main` aplicará as migrations e publicará a nova versão.

---

# Fluxo operacional

1. HLab Vet cadastra o cliente e define usuário + senha temporária.
2. Cliente entra e é obrigado a definir a própria senha.
3. Cliente configura o carimbo.
4. Cliente preenche a requisição e marca os exames.
5. HLab Vet recebe a solicitação e atribui um entregador.
6. O entregador abre seu link, vê endereço/local e registra **Coletado + temperatura + responsável pelo envio**.
7. A solicitação passa para o histórico do entregador.
8. No laboratório, o HLab Vet registra **Recebido + temperatura + recebedor + local**; data e hora ficam automáticas.
9. HLab Vet marca **Em análise**.
10. HLab Vet envia o arquivo do resultado e marca **Concluído**.
11. O cliente acompanha o fluxo e baixa o resultado.
12. As coletas e recebimentos alimentam a ficha mensal de temperatura.

## Estrutura principal

```text
hlab-vet-resultados/
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  └─ assets/
│     └─ hlabvet-logo.png
├─ src/
│  ├─ index.js
│  ├─ auth.js
│  ├─ catalog.js
│  └─ utils.js
├─ migrations/
│  └─ 0001_initial.sql
├─ .github/workflows/deploy.yml
├─ wrangler.jsonc
├─ package.json
└─ SECURITY.md
```

## Observações de produção

- Não torne o bucket R2 público; os downloads devem passar pela API autenticada.
- Guarde links de entregadores como informação reservada. Se um link vazar, use **Gerar novo link**.
- O botão de “Excluir” cliente desativa o acesso e preserva o histórico, o que evita perda de rastreabilidade.
- Antes do uso definitivo, valide internamente os campos obrigatórios, a política de retenção e o tratamento de dados pessoais conforme a rotina do laboratório.
Atualização de deploy
