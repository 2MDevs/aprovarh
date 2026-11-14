-- aprovaRH · 005 · disponibilidade das unidades e entrevistas.
-- Horários sempre no fuso de Brasília; nunca se agenda fora da disponibilidade nem acima das vagas.

CREATE TABLE disponibilidades (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id         uuid        NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  data_inicial       date        NOT NULL,
  data_final         date        NOT NULL,
  dias_semana        smallint[]  NOT NULL,          -- 0 = domingo … 6 = sábado
  horarios           text[]      NOT NULL,          -- 'HH:MM'
  duracao_minutos    smallint    NOT NULL DEFAULT 30 CHECK (duracao_minutos BETWEEN 5 AND 480),
  vagas_por_horario  smallint    NOT NULL DEFAULT 1 CHECK (vagas_por_horario BETWEEN 1 AND 50),
  responsavel_id     uuid        REFERENCES usuarios(id),
  local_texto        varchar(255),                  -- endereço ou instrução para o candidato (opcional)
  ativa              boolean     NOT NULL DEFAULT true,
  criada_por         uuid        REFERENCES usuarios(id),
  criada_em          timestamptz NOT NULL DEFAULT now(),
  atualizada_em      timestamptz NOT NULL DEFAULT now(),
  CHECK (data_final >= data_inicial),
  CHECK (data_final - data_inicial <= 366),
  CHECK (cardinality(dias_semana) BETWEEN 1 AND 7),
  CHECK (cardinality(horarios) BETWEEN 1 AND 48)
);
CREATE INDEX disponibilidades_unidade ON disponibilidades (unidade_id, data_final) WHERE ativa;

CREATE TABLE disponibilidade_bloqueios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id  uuid        NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  data        date        NOT NULL,
  motivo      varchar(120),
  criado_por  uuid        REFERENCES usuarios(id),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unidade_id, data)
);

CREATE TABLE entrevistas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id       uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  unidade_id         uuid        NOT NULL REFERENCES unidades(id),
  disponibilidade_id uuid        REFERENCES disponibilidades(id) ON DELETE SET NULL,
  inicio_em          timestamptz NOT NULL,
  duracao_minutos    smallint    NOT NULL,
  situacao           varchar(24) NOT NULL DEFAULT 'aguardando_confirmacao'
                     CHECK (situacao IN ('aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada', 'cancelada', 'remarcada', 'realizada', 'nao_compareceu')),
  responsavel_id     uuid        REFERENCES usuarios(id),
  local_texto        varchar(255),
  criada_por_tipo    varchar(12) NOT NULL CHECK (criada_por_tipo IN ('usuario', 'automacao', 'candidato')),
  criada_por         uuid        REFERENCES usuarios(id),
  confirmada_em      timestamptz,
  encerrada_em       timestamptz,
  motivo             varchar(255),
  substituida_por    uuid        REFERENCES entrevistas(id),
  criada_em          timestamptz NOT NULL DEFAULT now()
);
-- No máximo uma entrevista em aberto por candidato
CREATE UNIQUE INDEX entrevistas_uma_aberta ON entrevistas (candidato_id) WHERE situacao IN ('aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada');
CREATE INDEX entrevistas_agenda ON entrevistas (unidade_id, inicio_em) WHERE situacao IN ('aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada');

-- Tudo o que acontece com a entrevista: agendamento, respostas (inclusive o texto original do candidato), confirmações
CREATE TABLE entrevista_eventos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entrevista_id      uuid        NOT NULL REFERENCES entrevistas(id) ON DELETE CASCADE,
  tipo               varchar(30) NOT NULL,      -- agendada, confirmada, cancelada, remarcada, resposta_sim, resposta_nao, data_proposta, esclarecimento_pedido, realizada, nao_compareceu
  resposta_original  text,                      -- cifrado (o que o candidato escreveu)
  data_interpretada  timestamptz,
  aceita             boolean,
  motivo             varchar(255),
  autor_tipo         varchar(12) NOT NULL CHECK (autor_tipo IN ('usuario', 'automacao', 'candidato', 'sistema')),
  autor_usuario_id   uuid        REFERENCES usuarios(id),
  autor_nome         varchar(160),
  em                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entrevista_eventos_entrevista ON entrevista_eventos (entrevista_id, em);
