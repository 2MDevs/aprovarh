# aprovaRH

Plataforma de recrutamento da **Hummm! Pizzas**: Central de RH, portal temporário do candidato, integração com o WhatsApp e construtor visual de automações.

Desenvolvido por **Marcos Monteiro (TI - Tecnologia da Informação da Hummm! Pizzas)**.

## Situação

| Etapa | Situação |
|---|---|
| 1. Planejamento e arquitetura | ✅ concluída |
| **2A. Base padrão: servidor e banco** | 🔄 este PR |
| 2B. Base padrão: telas (login, layout, Sistema, Integração, Auditoria, Dispositivos, Usuários e unidades, PWA, temas) | próxima |
| 3 a 9 | veja o [plano](docs/PLANO.md) |

Documentos: [Plano](docs/PLANO.md) · [Arquitetura](docs/ARQUITETURA.md) · [Modelo de dados](docs/MODELO-DE-DADOS.md) · [Telas](docs/TELAS.md) · [Decisões](docs/DECISOES.md) · [API da base](docs/API-BASE.md)

## Tecnologia

Node.js 22 + Express (executado com tsx) · PostgreSQL · React + Vite + Tailwind (etapa 2B). Infraestrutura padrão da Hummm! Pizzas; o DocSecure é o modelo.

```
server/
  main.ts            API (aplica as migrations e prepara perfis/admin ao iniciar)
  worker.ts          rotinas em segundo plano (processo separado)
  app.ts             montagem do Express (helmet, cookies, rotas)
  config/env.ts      variáveis do .env validadas
  db/                conexão, migrations SQL versionadas
  lib/               criptografia, senhas, erros, dispositivo
  core/              auditoria encadeada, configurações, e-mail, perfis e acesso
  middleware/        sessão, permissões, origem (CSRF), limites
  modules/<área>/    rotas de cada área
shared/permissoes.ts catálogo único de permissões (servidor e telas)
scripts/             atualização pelo GitHub (update.sh, install-auto-update.sh)
docs/                documentação e artefatos da plataforma
```

## Instalação na VPS (primeira vez)

> A VPS é compartilhada: use pasta, usuário, banco, porta e serviços **próprios do aprovaRH**. Não altere nada de outros projetos.

1. **Banco** (como usuário `postgres`):
   ```bash
   sudo -u postgres psql -c "CREATE USER aprovarh WITH PASSWORD 'troque-esta-senha';"
   sudo -u postgres psql -c "CREATE DATABASE aprovarh_db OWNER aprovarh;"
   ```
2. **Código**:
   ```bash
   cd /var/www   # ou a pasta padrão dos projetos na VPS
   git clone https://github.com/2MDevs/aprovarh.git && cd aprovarh
   npm install
   cp .env.example .env && nano .env   # preencha as variáveis (tabela abaixo)
   npm run migrate
   ```
3. **Serviços** (API e worker), em `/etc/systemd/system/`:
   ```ini
   # aprovarh.service
   [Unit]
   Description=aprovaRH - API
   After=network.target postgresql.service
   [Service]
   WorkingDirectory=/var/www/aprovarh
   ExecStart=/usr/bin/npm start
   Restart=always
   User=www-data
   Environment=NODE_ENV=production
   [Install]
   WantedBy=multi-user.target
   ```
   ```ini
   # aprovarh-worker.service (igual, trocando a descrição e o comando)
   Description=aprovaRH - Worker
   ExecStart=/usr/bin/npm run worker
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now aprovarh aprovarh-worker
   curl http://127.0.0.1:PORTA/api/health
   ```
4. **Nginx**: um `server` próprio para o domínio do aprovaRH (A definir), com HTTPS, apontando para `127.0.0.1:PORTA`.
5. **Botão "Atualizar sistema"** (uma única vez):
   ```bash
   sudo bash scripts/install-auto-update.sh
   ```
   O script detecta a pasta, o dono dos arquivos, a porta e os dois serviços. Ele cria apenas `/etc/aprovarh-update.conf` e as unidades `aprovarh-update.path` e `aprovarh-update.service`.

### Primeiro acesso

1. Entre com `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD`. Como o SMTP ainda não está configurado, você entra sem 2FA (**modo de configuração inicial**) e precisa trocar a senha.
2. Cadastre o desenvolvedor (e-mail que está em `DEVELOPER_EMAILS`). Ele recebe o perfil Desenvolvedor automaticamente.
3. O desenvolvedor configura o SMTP em **Integração**. A partir daí o 2FA por e-mail passa a valer para todos, e as sessões abertas no modo de configuração são encerradas.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Para que serve |
|---|---|---|---|
| `NODE_ENV` | não | `development` | `production` na VPS (liga cookies Secure) |
| `PORT` | não | `3000` | Porta interna da API |
| `APP_URL` | **sim** | — | Endereço público com https://. Também usado na proteção contra CSRF e nos links dos e-mails |
| `DATABASE_URL` | **sim** | — | Banco PostgreSQL próprio |
| `SETTINGS_ENCRYPTION_KEY` | **sim** | — | Chave AES-256-GCM (`openssl rand -hex 32`) |
| `DEVELOPER_EMAILS` | não | vazio | E-mails com perfil Desenvolvedor |
| `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` | não | — | Administrador inicial (criado uma única vez) |
| `SESSION_TTL_HOURS` | não | `8` | Validade da sessão, renovada a cada uso (tela) |
| `LOCK_IDLE_MINUTES` | não | `10` | Minutos sem uso para bloquear a tela (tela) |
| `PIN_MAX_ATTEMPTS` | não | `5` | Erros de PIN/senha no desbloqueio antes de encerrar a sessão (tela) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | não | porta `587`, seguro `false` | E-mail (tela) |
| `STORAGE_DIR` | não | `./storage` | Arquivos cifrados |
| `TRUST_PROXY` | não | `1` | Proxies na frente do Node, para o IP real |

## Segurança implementada nesta etapa

- Senhas e PIN com bcrypt; regra de 10+ caracteres com letras e números.
- 5 senhas erradas bloqueiam a conta por 15 min; 10 tentativas a cada 15 min por IP em login, 2FA, senha, PIN e reautenticação.
- 2FA por e-mail em dispositivo novo: código de 6 dígitos, 10 min de validade, reenvio após 60 s, só o hash guardado, invalidado após 5 erros.
- Dispositivo confiável por 30 dias (cookie HttpOnly próprio), com aprovar, bloquear, revogar e remover. Bloquear ou revogar encerra as sessões na hora.
- Sessão em cookie HttpOnly / Secure / SameSite=Lax, só o hash no banco, validade renovada a cada uso; bloqueio por inatividade com PIN ou senha. Enquanto a tela está bloqueada, o servidor recusa tudo, menos desbloquear, sair e verificar a sessão.
- Usuário bloqueado ou excluído perde todas as sessões na hora; trocar ou redefinir a senha encerra as demais sessões.
- Permissões conferidas no servidor em toda rota; escopo por unidade preparado para os candidatos.
- Proteção contra CSRF pela origem da requisição, além do SameSite.
- Auditoria com encadeamento SHA-256; o banco recusa UPDATE, DELETE e TRUNCATE; filtros, exportação CSV (protegida contra fórmulas) e verificação da corrente.
- Segredos (SMTP, webhooks) cifrados com AES-256-GCM e nunca devolvidos para a tela.
- Chaves de API `aprh_live_` + 64 caracteres, mostradas uma única vez, guardadas só como hash, limitadas por escopos e pelas permissões de quem criou, revogáveis. Login, Sistema, Integração e as próprias chaves não aceitam chave de API.
- Webhooks só HTTPS, assinados (`X-AprovaRH-Assinatura: t=…,v1=HMAC-SHA256`).
- Helmet com CSP, sem `x-powered-by`; erros nunca mostram detalhes técnicos.
