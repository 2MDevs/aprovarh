-- aprovaRH · 003 · Central de RH: tags, observações internas, mensagens e leitura.
-- Tags, observações e o status interno NUNCA vão para o portal do candidato.

CREATE TABLE tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          varchar(60)  NOT NULL,
  cor           varchar(9)   NOT NULL DEFAULT '#78716C',
  ativa         boolean      NOT NULL DEFAULT true,
  criada_por    uuid         REFERENCES usuarios(id),
  criado_em     timestamptz  NOT NULL DEFAULT now(),
  atualizado_em timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_nome_unico ON tags (lower(nome)) WHERE ativa;

CREATE TABLE candidato_tags (
  candidato_id  uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  tag_id        uuid        NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  adicionada_por uuid       REFERENCES usuarios(id),
  adicionada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidato_id, tag_id)
);
CREATE INDEX candidato_tags_tag ON candidato_tags (tag_id);

CREATE TABLE tags_historico (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id  uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  tag_id        uuid        NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  acao          varchar(12) NOT NULL CHECK (acao IN ('adicionada', 'removida')),
  autor_tipo    varchar(20) NOT NULL CHECK (autor_tipo IN ('usuario', 'automacao', 'sistema')),
  autor_usuario_id uuid     REFERENCES usuarios(id),
  autor_nome    varchar(160),
  em            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tags_historico_candidato ON tags_historico (candidato_id, em DESC);

CREATE TABLE observacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id  uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  texto         text        NOT NULL,        -- cifrado
  autor_id      uuid        NOT NULL REFERENCES usuarios(id),
  criada_em     timestamptz NOT NULL DEFAULT now(),
  excluida_em   timestamptz
);
CREATE INDEX observacoes_candidato ON observacoes (candidato_id, criada_em DESC) WHERE excluida_em IS NULL;

-- Mensagens da conversa única do candidato (chat do portal, WhatsApp e avisos do sistema)
CREATE TABLE mensagens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id        uuid        NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  sentido            varchar(8)  NOT NULL CHECK (sentido IN ('entrada', 'saida')),
  canal              varchar(12) NOT NULL CHECK (canal IN ('portal', 'whatsapp', 'sistema')),
  autor_tipo         varchar(12) NOT NULL CHECK (autor_tipo IN ('candidato', 'gestora', 'chatbot', 'sistema')),
  autor_usuario_id   uuid        REFERENCES usuarios(id),
  autor_nome         varchar(160),
  execucao_id        uuid,                       -- automação que enviou (etapa 8)
  texto              text,                       -- cifrado
  arquivo_id         uuid        REFERENCES arquivos(id),
  visivel_ao_candidato boolean   NOT NULL DEFAULT true,
  wamid              varchar(128) UNIQUE,         -- id da mensagem no WhatsApp (etapa 7)
  situacao_entrega   varchar(12) CHECK (situacao_entrega IN ('pendente', 'enviada', 'entregue', 'lida', 'falhou')),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  CHECK (texto IS NOT NULL OR arquivo_id IS NOT NULL)
);
CREATE INDEX mensagens_conversa ON mensagens (conversa_id, criado_em DESC);

-- Até onde cada pessoa da equipe leu cada conversa (indicador de não lidas)
CREATE TABLE conversa_leituras (
  conversa_id uuid        NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  usuario_id  uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lida_ate    timestamptz NOT NULL,
  PRIMARY KEY (conversa_id, usuario_id)
);

ALTER TABLE conversas ADD COLUMN ultima_mensagem_id uuid REFERENCES mensagens(id) ON DELETE SET NULL;
