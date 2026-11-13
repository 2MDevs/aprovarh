-- aprovaRH · 001 · base padrão (perfis, usuários, unidades, sessões, 2FA, dispositivos,
-- configurações, auditoria imutável, chaves de API, webhooks, notificações).
-- Datas sempre em timestamptz (UTC no banco; a tela mostra em America/Sao_Paulo).

-- ── Perfis e permissões ────────────────────────────────────────────────────
CREATE TABLE perfis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave         varchar(40)  NOT NULL UNIQUE,          -- desenvolvedor, diretoria, gestora_rh, colaborador, ou personalizado
  nome          varchar(80)  NOT NULL,
  descricao     varchar(255),
  sistema       boolean      NOT NULL DEFAULT false,   -- perfis criados na instalação não podem ser excluídos
  permissoes    text[]       NOT NULL DEFAULT '{}',
  criado_em     timestamptz  NOT NULL DEFAULT now(),
  atualizado_em timestamptz  NOT NULL DEFAULT now()
);

-- ── Unidades (lojas) ───────────────────────────────────────────────────────
CREATE TABLE unidades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          varchar(120) NOT NULL,
  codigo        varchar(32),
  ativa         boolean      NOT NULL DEFAULT true,
  criado_em     timestamptz  NOT NULL DEFAULT now(),
  atualizado_em timestamptz  NOT NULL DEFAULT now(),
  criado_por    uuid,
  excluido_em   timestamptz
);
CREATE UNIQUE INDEX unidades_codigo_unico ON unidades (lower(codigo)) WHERE codigo IS NOT NULL AND excluido_em IS NULL;
CREATE UNIQUE INDEX unidades_nome_unico   ON unidades (lower(nome))   WHERE excluido_em IS NULL;

-- ── Usuários internos ──────────────────────────────────────────────────────
CREATE TABLE usuarios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               varchar(160) NOT NULL,
  email              varchar(254) NOT NULL,
  perfil_id          uuid         NOT NULL REFERENCES perfis(id),
  setor              varchar(80),
  todas_unidades     boolean      NOT NULL DEFAULT false,
  senha_hash         varchar(100),
  deve_trocar_senha  boolean      NOT NULL DEFAULT false,
  admin_inicial      boolean      NOT NULL DEFAULT false, -- "usuário fantasma" do primeiro acesso
  situacao           varchar(20)  NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'bloqueado')),
  tentativas_falhas  integer      NOT NULL DEFAULT 0,
  bloqueado_ate      timestamptz,
  pin_hash           varchar(100),
  ultimo_login_em    timestamptz,
  criado_em          timestamptz  NOT NULL DEFAULT now(),
  atualizado_em      timestamptz  NOT NULL DEFAULT now(),
  criado_por         uuid,
  excluido_em        timestamptz
);
CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (lower(email)) WHERE excluido_em IS NULL;

CREATE TABLE usuario_unidades (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  unidade_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, unidade_id)
);
CREATE INDEX usuario_unidades_unidade ON usuario_unidades (unidade_id);

-- ── Dispositivos ───────────────────────────────────────────────────────────
CREATE TABLE dispositivos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id         uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash         char(64)    NOT NULL UNIQUE,        -- cookie próprio do dispositivo (só o hash fica aqui)
  nome               varchar(160) NOT NULL,
  sistema            varchar(80),
  navegador          varchar(80),
  tipo               varchar(20)  NOT NULL DEFAULT 'computador',
  ip_primeiro        varchar(64),
  ip_ultimo          varchar(64),
  situacao           varchar(20)  NOT NULL DEFAULT 'pendente'
                     CHECK (situacao IN ('pendente', 'confiavel', 'bloqueado', 'revogado')),
  confiavel_ate      timestamptz,
  primeiro_acesso_em timestamptz  NOT NULL DEFAULT now(),
  ultimo_acesso_em   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX dispositivos_usuario ON dispositivos (usuario_id);

-- ── Desafios de 2FA por e-mail ─────────────────────────────────────────────
CREATE TABLE desafios_2fa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash      char(64)    NOT NULL UNIQUE,   -- identifica o desafio entre "senha ok" e "código ok"
  codigo_hash     char(64)    NOT NULL,          -- HMAC do código de 6 dígitos
  expira_em       timestamptz NOT NULL,          -- 10 minutos
  tentativas      integer     NOT NULL DEFAULT 0,
  ultimo_envio_em timestamptz NOT NULL DEFAULT now(),
  usado_em        timestamptz,
  invalidado_em   timestamptz,
  ip              varchar(64),
  user_agent      text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX desafios_2fa_usuario ON desafios_2fa (usuario_id);

-- ── Sessões ────────────────────────────────────────────────────────────────
CREATE TABLE sessoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id         uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dispositivo_id     uuid        REFERENCES dispositivos(id) ON DELETE SET NULL,
  token_hash         char(64)    NOT NULL UNIQUE,
  criada_em          timestamptz NOT NULL DEFAULT now(),
  expira_em          timestamptz NOT NULL,
  ultimo_uso_em      timestamptz NOT NULL DEFAULT now(),
  bloqueada_em       timestamptz,               -- bloqueio por inatividade (pede PIN ou senha)
  pin_tentativas     integer     NOT NULL DEFAULT 0,
  reautenticada_em   timestamptz,               -- senha reconfirmada (tela Integração, 10 min)
  modo_configuracao  boolean     NOT NULL DEFAULT false, -- entrou sem 2FA porque o SMTP não estava configurado
  encerrada_em       timestamptz,
  motivo_encerramento varchar(40),
  ip                 varchar(64),
  user_agent         text
);
CREATE INDEX sessoes_usuario_ativas ON sessoes (usuario_id) WHERE encerrada_em IS NULL;
CREATE INDEX sessoes_dispositivo   ON sessoes (dispositivo_id) WHERE encerrada_em IS NULL;

-- ── Redefinição de senha (link de uso único) ───────────────────────────────
CREATE TABLE redefinicoes_senha (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash char(64)    NOT NULL UNIQUE,
  expira_em  timestamptz NOT NULL,
  usado_em   timestamptz,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

-- ── Configurações (prioridade Banco > .env > padrão) ───────────────────────
CREATE TABLE configuracoes (
  chave          varchar(80) PRIMARY KEY,
  valor          text,                 -- segredos ficam cifrados (AES-256-GCM)
  segredo        boolean     NOT NULL DEFAULT false,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

-- ── Auditoria imutável com encadeamento SHA-256 ────────────────────────────
CREATE TABLE auditoria (
  id             bigserial   PRIMARY KEY,
  em             timestamptz NOT NULL DEFAULT now(),
  usuario_id     uuid,
  usuario_nome   varchar(160),
  perfil         varchar(80),
  setor          varchar(80),
  chave_api_nome varchar(120),
  acao           varchar(80) NOT NULL,
  item_tipo      varchar(40),
  item_id        varchar(64),
  item_nome      varchar(255),
  detalhes       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resultado      varchar(20) NOT NULL CHECK (resultado IN ('sucesso', 'negado', 'bloqueado', 'falha')),
  ip             varchar(64),
  dispositivo    varchar(255),
  hash_anterior  char(64),
  hash           char(64)    NOT NULL
);
CREATE INDEX auditoria_em      ON auditoria (em DESC);
CREATE INDEX auditoria_usuario ON auditoria (usuario_id, em DESC);
CREATE INDEX auditoria_acao    ON auditoria (acao, em DESC);

CREATE FUNCTION auditoria_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A auditoria é imutável: registros não podem ser alterados nem apagados.';
END;
$$;
CREATE TRIGGER auditoria_sem_update BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_imutavel();
CREATE TRIGGER auditoria_sem_truncate BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_imutavel();

-- ── Chaves de API ──────────────────────────────────────────────────────────
CREATE TABLE chaves_api (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           varchar(120) NOT NULL,
  prefixo        varchar(24)  NOT NULL,          -- início visível (ex.: aprh_live_ab12…)
  hash           char(64)     NOT NULL UNIQUE,
  escopos        text[]       NOT NULL DEFAULT '{}',
  criada_por     uuid         NOT NULL REFERENCES usuarios(id),
  criada_em      timestamptz  NOT NULL DEFAULT now(),
  ultimo_uso_em  timestamptz,
  ultimo_uso_ip  varchar(64),
  revogada_em    timestamptz,
  revogada_por   uuid
);

-- ── Webhooks de saída ──────────────────────────────────────────────────────
CREATE TABLE webhooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             varchar(120) NOT NULL,
  url              text         NOT NULL CHECK (url LIKE 'https://%'),
  eventos          text[]       NOT NULL DEFAULT '{}',
  segredo          text         NOT NULL,        -- cifrado
  ativo            boolean      NOT NULL DEFAULT true,
  ultimo_disparo_em timestamptz,
  ultimo_resultado varchar(120),
  criado_por       uuid         NOT NULL REFERENCES usuarios(id),
  criado_em        timestamptz  NOT NULL DEFAULT now(),
  excluido_em      timestamptz
);

-- ── Notificações (sino) ────────────────────────────────────────────────────
CREATE TABLE notificacoes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo       varchar(40) NOT NULL,
  titulo     varchar(160) NOT NULL,
  texto      text,
  link       varchar(255),
  lida_em    timestamptz,
  criada_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notificacoes_usuario ON notificacoes (usuario_id, criada_em DESC);
