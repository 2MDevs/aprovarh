-- aprovaRH · 004 · portal temporário do candidato.
-- O candidato não tem conta: entra só com um código válido até 23:59:59 (Brasília) do dia da liberação.

CREATE TABLE liberacoes_acesso (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id       uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  codigo_hash        char(64)    NOT NULL UNIQUE,      -- HMAC do código; o código nunca é guardado
  liberado_em        timestamptz NOT NULL DEFAULT now(),
  expira_em          timestamptz NOT NULL,             -- 23:59:59.999 do dia, em America/Sao_Paulo
  situacao           varchar(12) NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'expirada', 'revogada')),
  revogada_em        timestamptz,
  revogada_por       uuid        REFERENCES usuarios(id),
  motivo             varchar(120),
  origem             varchar(12) NOT NULL CHECK (origem IN ('usuario', 'automacao')),
  liberada_por       uuid        REFERENCES usuarios(id),
  execucao_id        uuid,                             -- automação que gerou (etapa 8)
  permite_arquivo    boolean     NOT NULL DEFAULT false,
  primeiro_uso_em    timestamptz,
  CHECK (expira_em > liberado_em)
);
-- Uma liberação ativa por candidato
CREATE UNIQUE INDEX liberacoes_uma_ativa ON liberacoes_acesso (candidato_id) WHERE situacao = 'ativa';
CREATE INDEX liberacoes_vencendo ON liberacoes_acesso (expira_em) WHERE situacao = 'ativa';

CREATE TABLE sessoes_portal (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liberacao_id        uuid        NOT NULL REFERENCES liberacoes_acesso(id) ON DELETE CASCADE,
  candidato_id        uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  token_hash          char(64)    NOT NULL UNIQUE,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em       timestamptz NOT NULL DEFAULT now(),
  encerrada_em        timestamptz,
  motivo_encerramento varchar(30),
  ip                  varchar(64),
  dispositivo         varchar(160)
);
CREATE INDEX sessoes_portal_liberacao ON sessoes_portal (liberacao_id) WHERE encerrada_em IS NULL;

-- Tentativas de entrada (sucesso e falha): "Histórico de acesso ao portal" e proteção contra tentativa e erro
CREATE TABLE acessos_portal (
  id            bigserial   PRIMARY KEY,
  candidato_id  uuid        REFERENCES candidatos(id) ON DELETE CASCADE,  -- nulo quando o código não existe
  liberacao_id  uuid        REFERENCES liberacoes_acesso(id) ON DELETE SET NULL,
  resultado     varchar(20) NOT NULL CHECK (resultado IN ('sucesso', 'codigo_invalido', 'expirado', 'revogado')),
  ip            varchar(64),
  dispositivo   varchar(160),
  em            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acessos_portal_candidato ON acessos_portal (candidato_id, em DESC);
CREATE INDEX acessos_portal_recentes ON acessos_portal (em) WHERE resultado <> 'sucesso';

-- Até onde o candidato leu a conversa (marca as mensagens da equipe como lidas)
ALTER TABLE conversas ADD COLUMN candidato_lida_ate timestamptz;
