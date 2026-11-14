-- aprovaRH · 006 · integração com o WhatsApp Business (Cloud API oficial da Meta).

-- Janela de atendimento de 24 h: aberta quando o candidato escreve. Fora dela, só modelo aprovado.
ALTER TABLE conversas ADD COLUMN janela_whatsapp_ate timestamptz;

-- Modelos (templates) da conta, sincronizados da Meta
CREATE TABLE whatsapp_modelos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_id       varchar(64) NOT NULL,
  nome          varchar(512) NOT NULL,
  idioma        varchar(16)  NOT NULL,
  categoria     varchar(30),
  situacao      varchar(30)  NOT NULL,          -- APPROVED, PENDING, REJECTED, PAUSED...
  corpo         text,
  variaveis     smallint     NOT NULL DEFAULT 0,
  botoes        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nome, idioma)
);

-- Tudo o que chega no webhook, guardado antes de processar (nada se perde se o processamento falhar)
CREATE TABLE whatsapp_eventos_entrada (
  id            bigserial    PRIMARY KEY,
  chave_dedup   varchar(200) NOT NULL UNIQUE,   -- id da mensagem (wamid) ou do status: a Meta reenvia; aqui entra uma vez só
  tipo          varchar(20)  NOT NULL CHECK (tipo IN ('mensagem', 'status')),
  carga         text         NOT NULL,          -- JSON cifrado
  recebido_em   timestamptz  NOT NULL DEFAULT now(),
  processado_em timestamptz,
  tentativas    smallint     NOT NULL DEFAULT 0,
  erro          varchar(500)
);
CREATE INDEX whatsapp_eventos_pendentes ON whatsapp_eventos_entrada (id) WHERE processado_em IS NULL;

-- Fila de envio: cada mensagem de saída pelo WhatsApp passa por aqui (novas tentativas com espera crescente)
CREATE TABLE fila_envio (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem_id        uuid        NOT NULL UNIQUE REFERENCES mensagens(id) ON DELETE CASCADE,
  para               text        NOT NULL,       -- telefone cifrado
  conteudo           text        NOT NULL,       -- JSON cifrado: { tipo: 'texto' | 'modelo', ... }
  chave_idempotencia varchar(100) NOT NULL UNIQUE,
  situacao           varchar(12) NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'enviando', 'enviada', 'falhou')),
  tentativas         smallint    NOT NULL DEFAULT 0,
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  ultimo_erro        varchar(500),
  criada_em          timestamptz NOT NULL DEFAULT now(),
  enviada_em         timestamptz
);
CREATE INDEX fila_envio_pendentes ON fila_envio (proxima_tentativa_em) WHERE situacao = 'pendente';

-- Números que escreveram e não são de nenhum candidato (não criam candidato sozinhos)
CREATE TABLE contatos_nao_identificados (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone           text        NOT NULL,      -- cifrado
  telefone_hash      char(64)    NOT NULL UNIQUE,
  telefone_final     char(4)     NOT NULL,
  nome_perfil        varchar(160),              -- nome do perfil do WhatsApp, se a Meta enviar
  ultima_mensagem    text,                      -- cifrado
  mensagens          integer     NOT NULL DEFAULT 1,
  primeira_em        timestamptz NOT NULL DEFAULT now(),
  ultima_em          timestamptz NOT NULL DEFAULT now(),
  vinculado_a        uuid        REFERENCES candidatos(id) ON DELETE SET NULL,
  arquivado_em       timestamptz
);
