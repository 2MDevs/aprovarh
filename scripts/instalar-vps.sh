#!/usr/bin/env bash
# =============================================================================
# aprovaRH - instalação na VPS (primeira vez)
#
# Uso (como root, de dentro da pasta clonada):
#   bash scripts/instalar-vps.sh [dominio]
#
# A VPS é compartilhada com outros projetos. Este script:
#   - usa só pasta, usuário, banco, porta, serviços e site do Nginx PRÓPRIOS do aprovaRH;
#   - confere antes se algum desses nomes já existe e PARA se encontrar conflito;
#   - não troca a versão do Node do servidor: se precisar, baixa um Node 22 só para o aprovaRH (pasta .node);
#   - não reinicia o Nginx (só "reload", depois de "nginx -t" aprovar a configuração).
# Senhas e chaves são geradas aqui no servidor e aparecem só neste terminal.
# =============================================================================
set -euo pipefail

DOMINIO="${1:-teste.hummmgestao.com.br}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USUARIO="aprovarh"
BANCO="aprovarh_db"
SITE_NGINX="aprovarh"

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m•\033[0m %s\n' "$*"; }
aviso(){ printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Rode como root (ou com sudo)."
[ -f "$APP_DIR/package.json" ] && grep -q '"name": *"aprovarh"' "$APP_DIR/package.json" || die "Rode o script de dentro da pasta do aprovaRH."
cd "$APP_DIR"

echo
echo "aprovaRH - instalação na VPS"
echo "Pasta: $APP_DIR"
echo "Endereço: https://$DOMINIO"
echo

# -----------------------------------------------------------------------------
# 1. Conferências (nada é alterado nesta parte)
# -----------------------------------------------------------------------------
for c in git curl openssl ss systemctl nginx psql; do command -v "$c" >/dev/null || die "Comando '$c' não encontrado no servidor."; done

[ ! -f "$APP_DIR/.env" ] || die "Já existe $APP_DIR/.env: o aprovaRH parece já instalado. Nada foi alterado."
for u in aprovarh.service aprovarh-worker.service; do
  [ ! -e "/etc/systemd/system/$u" ] || die "O serviço $u já existe. Nada foi alterado."
done

# Domínio não pode estar em nenhum site do Nginx (de nenhum projeto).
EM_USO=$(grep -rlE "server_name[^;]*[[:space:]]$(printf '%s' "$DOMINIO" | sed 's/\./\\./g')([[:space:];]|$)" /etc/nginx 2>/dev/null || true)
[ -z "$EM_USO" ] || die "O endereço $DOMINIO já está configurado no Nginx em: $EM_USO. Nada foi alterado."
if [ -d /etc/nginx/sites-available ]; then
  ARQ_NGINX="/etc/nginx/sites-available/$SITE_NGINX"; LINK_NGINX="/etc/nginx/sites-enabled/$SITE_NGINX"
else
  ARQ_NGINX="/etc/nginx/conf.d/$SITE_NGINX.conf"; LINK_NGINX=""
fi
[ ! -e "$ARQ_NGINX" ] || die "Já existe $ARQ_NGINX. Nada foi alterado."
ok "Endereço livre no Nginx"

# Banco e usuário do banco não podem existir.
[ -z "$(runuser -u postgres -- psql -Atc "select 1 from pg_database where datname='$BANCO'")" ] || die "O banco $BANCO já existe. Nada foi alterado."
[ -z "$(runuser -u postgres -- psql -Atc "select 1 from pg_roles where rolname='$USUARIO'")" ] || die "O usuário de banco $USUARIO já existe. Nada foi alterado."
ok "Nome do banco livre ($BANCO)"

# Porta livre, a partir da 3100.
PORTA=3100
while ss -ltnH "( sport = :$PORTA )" | grep -q .; do PORTA=$((PORTA + 1)); done
ok "Porta livre: $PORTA"

# O domínio precisa apontar para esta VPS (só aviso).
IP_DOMINIO=$(getent hosts "$DOMINIO" | awk '{print $1}' | head -1 || true)
if [ -n "$IP_DOMINIO" ] && hostname -I | tr ' ' '\n' | grep -qx "$IP_DOMINIO"; then
  ok "$DOMINIO aponta para esta VPS ($IP_DOMINIO)"
else
  aviso "$DOMINIO aponta para '${IP_DOMINIO:-nenhum IP}', que não parece ser desta VPS. O HTTPS pode falhar."
fi

# E-mails (nada é inventado: quem instala informa).
echo
read -rp "E-mail do desenvolvedor (TI) que vai acessar a tela Integração: " DEV_EMAIL
[[ "$DEV_EMAIL" == *@*.* ]] || die "E-mail inválido."
read -rp "E-mail do administrador inicial (usado só no primeiro acesso): " ADMIN_EMAIL
[[ "$ADMIN_EMAIL" == *@*.* ]] || die "E-mail inválido."
echo
read -rp "Tudo conferido. Instalar agora? (s/N) " RESP
[[ "$RESP" =~ ^[sS]$ ]] || die "Cancelado. Nada foi alterado."

# -----------------------------------------------------------------------------
# 2. Node.js 22 (o do servidor, se servir; senão um só do aprovaRH)
# -----------------------------------------------------------------------------
NODE_BIN_DIR=""
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
  NODE_BIN_DIR=$(dirname "$(command -v node)")
  ok "Usando o Node do servidor: $(node -v)"
else
  info "O Node do servidor não é 22 ou mais novo. Baixando um Node 22 só para o aprovaRH (não mexe no do servidor)..."
  case "$(uname -m)" in x86_64) ARQ=x64 ;; aarch64|arm64) ARQ=arm64 ;; *) die "Processador não suportado: $(uname -m)" ;; esac
  BASE=https://nodejs.org/dist/latest-v22.x
  SOMAS=$(curl -fsSL "$BASE/SHASUMS256.txt")
  PACOTE=$(printf '%s\n' "$SOMAS" | awk '{print $2}' | grep -E "^node-v22\.[0-9.]+-linux-$ARQ\.tar\.xz$" | head -1)
  [ -n "$PACOTE" ] || die "Não encontrei o pacote do Node 22."
  TMP=$(mktemp -d)
  curl -fsSL "$BASE/$PACOTE" -o "$TMP/$PACOTE"
  (cd "$TMP" && printf '%s\n' "$SOMAS" | grep " $PACOTE\$" | sha256sum -c --quiet) || die "O arquivo do Node veio corrompido."
  mkdir -p "$APP_DIR/.node"
  tar -xJf "$TMP/$PACOTE" -C "$APP_DIR/.node" --strip-components=1
  rm -rf "$TMP"
  NODE_BIN_DIR="$APP_DIR/.node/bin"
  ok "Node $("$NODE_BIN_DIR/node" -v) em $NODE_BIN_DIR"
fi
CAMINHO="$NODE_BIN_DIR:/usr/local/bin:/usr/bin:/bin"

# -----------------------------------------------------------------------------
# 3. Usuário do Linux, banco e .env
# -----------------------------------------------------------------------------
if ! id "$USUARIO" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$USUARIO"
  ok "Usuário do Linux '$USUARIO' criado"
fi

SENHA_BANCO=$(openssl rand -hex 24)
runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -c "CREATE ROLE $USUARIO LOGIN PASSWORD '$SENHA_BANCO';"
runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE $BANCO OWNER $USUARIO;"
ok "Banco $BANCO criado"

SENHA_ADMIN="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 14)Rh7"
umask 077
sed \
  -e "s|^PORT=.*|PORT=$PORTA|" \
  -e "s|^APP_URL=.*|APP_URL=https://$DOMINIO|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$USUARIO:$SENHA_BANCO@127.0.0.1:5432/$BANCO|" \
  -e "s|^SETTINGS_ENCRYPTION_KEY=.*|SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 32)|" \
  -e "s|^DEVELOPER_EMAILS=.*|DEVELOPER_EMAILS=$DEV_EMAIL|" \
  -e "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=$ADMIN_EMAIL|" \
  -e "s|^ADMIN_INITIAL_PASSWORD=.*|ADMIN_INITIAL_PASSWORD=$SENHA_ADMIN|" \
  .env.example > .env
umask 022
mkdir -p storage
chown -R "$USUARIO:$USUARIO" "$APP_DIR"
chmod 600 .env
ok ".env criado (só o usuário $USUARIO lê)"

# -----------------------------------------------------------------------------
# 4. Instalar dependências, criar tabelas e gerar as telas
# -----------------------------------------------------------------------------
como_app() { runuser -u "$USUARIO" -- env PATH="$CAMINHO" HOME="$APP_DIR" "$@"; }
info "Instalando dependências (pode levar alguns minutos)..."
como_app npm install --no-audit --no-fund
como_app npm run migrate
como_app npm run build
ok "Dependências, banco e telas prontos"

# -----------------------------------------------------------------------------
# 5. Serviços (API e worker)
# -----------------------------------------------------------------------------
servico() { # nome descricao script
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$2
After=network.target postgresql.service

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN_DIR/npm run $3
Restart=always
RestartSec=3
User=$USUARIO
Environment=NODE_ENV=production
Environment=PATH=$CAMINHO
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
}
servico aprovarh "aprovaRH - API" start
servico aprovarh-worker "aprovaRH - Worker" worker
systemctl daemon-reload
systemctl enable --now aprovarh aprovarh-worker >/dev/null 2>&1

info "Esperando a API responder..."
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORTA/api/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORTA/api/health" >/dev/null || die "A API não respondeu. Veja: journalctl -u aprovarh -n 50"
ok "API no ar na porta $PORTA"

# -----------------------------------------------------------------------------
# 6. Nginx (site próprio) e HTTPS
# -----------------------------------------------------------------------------
cat > "$ARQ_NGINX" <<EOF
# aprovaRH - $DOMINIO (criado por scripts/instalar-vps.sh)
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;

    client_max_body_size 20m;

    # Tempo real (SSE): sem buffer e conexão longa
    location /api/eventos {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
[ -n "$LINK_NGINX" ] && ln -s "$ARQ_NGINX" "$LINK_NGINX"
if ! nginx -t >/dev/null 2>&1; then
  rm -f "$ARQ_NGINX"; [ -n "$LINK_NGINX" ] && rm -f "$LINK_NGINX"
  die "O Nginx recusou a configuração. O arquivo do aprovaRH foi removido e os outros sites não foram afetados. Veja: nginx -t"
fi
systemctl reload nginx
ok "Site do Nginx criado ($ARQ_NGINX)"

if command -v certbot >/dev/null; then
  if certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos --redirect -m "$DEV_EMAIL"; then
    ok "HTTPS ativo"
  else
    aviso "O certificado HTTPS não foi emitido. Confira se $DOMINIO aponta para esta VPS e rode: certbot --nginx -d $DOMINIO"
  fi
else
  aviso "certbot não encontrado. Instale o HTTPS para $DOMINIO do mesmo jeito que nos outros projetos."
fi

# -----------------------------------------------------------------------------
# 7. Botão "Atualizar sistema"
# -----------------------------------------------------------------------------
bash scripts/install-auto-update.sh

echo
echo "================================================================"
ok "aprovaRH instalado"
echo "  Endereço:            https://$DOMINIO"
echo "  Administrador:       $ADMIN_EMAIL"
echo "  Senha inicial:       $SENHA_ADMIN"
echo "  (anote agora; ela será trocada no primeiro acesso)"
echo "  Porta interna:       $PORTA"
echo "  Serviços:            aprovarh, aprovarh-worker, aprovarh-update.path"
echo "  Faça backup de:      banco $BANCO e pasta $APP_DIR/storage"
echo "================================================================"
