-- Etapa 8: motor de automações.
-- O fluxo (nós e ligações) fica em JSON. A versão publicada nunca muda; editar mexe só no rascunho.
-- Execuções, passos e esperas guardam todo o histórico. O contexto da execução fica cifrado
-- (pode ter a resposta do candidato e, por instantes, o código de acesso antes do envio).

CREATE TABLE automacoes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                 varchar(120) NOT NULL,
  descricao            varchar(500),
  situacao             varchar(12) NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'ativa', 'pausada', 'com_erro')),
  unidades             uuid[],                         -- NULL = todas as unidades
  fluxo_rascunho       jsonb       NOT NULL DEFAULT '{"nos":[],"ligacoes":[]}'::jsonb,
  rascunho_alterado_em timestamptz NOT NULL DEFAULT now(),
  versao_publicada_id  uuid,
  criada_por           uuid        REFERENCES usuarios(id),
  criada_em            timestamptz NOT NULL DEFAULT now(),
  atualizada_por       uuid        REFERENCES usuarios(id),
  atualizada_em        timestamptz NOT NULL DEFAULT now(),
  excluida_em          timestamptz
);

CREATE TABLE automacao_versoes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automacao_id    uuid        NOT NULL REFERENCES automacoes(id),
  numero          int         NOT NULL,
  fluxo           jsonb       NOT NULL,
  gatilho         varchar(60) NOT NULL,                -- tipo do card de gatilho (busca rápida)
  espera_resposta boolean     NOT NULL DEFAULT false,  -- tem "Aguardar resposta": cala as respostas automáticas da etapa 7
  publicada_em    timestamptz NOT NULL DEFAULT now(),
  publicada_por   uuid        REFERENCES usuarios(id),
  UNIQUE (automacao_id, numero)
);
ALTER TABLE automacoes ADD CONSTRAINT automacoes_versao_fk FOREIGN KEY (versao_publicada_id) REFERENCES automacao_versoes(id);

-- Versão publicada é imutável.
CREATE FUNCTION automacao_versao_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Versão publicada de automação não pode ser alterada nem apagada';
END $$;
CREATE TRIGGER automacao_versoes_imutavel BEFORE UPDATE OR DELETE ON automacao_versoes
  FOR EACH ROW EXECUTE FUNCTION automacao_versao_imutavel();

CREATE TABLE automacao_execucoes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              bigserial   UNIQUE,                -- "execução nº" para as pessoas
  automacao_id        uuid        NOT NULL REFERENCES automacoes(id),
  versao_id           uuid        NOT NULL REFERENCES automacao_versoes(id),
  evento_id           bigint      REFERENCES eventos_dominio(id),
  candidato_id        uuid        NOT NULL REFERENCES candidatos(id),
  situacao            varchar(14) NOT NULL DEFAULT 'em_andamento'
                        CHECK (situacao IN ('em_andamento', 'aguardando', 'concluida', 'com_erro', 'interrompida')),
  no_atual            varchar(40),
  contexto            text,                              -- cifrado (JSON)
  cadeia_origem       uuid[]      NOT NULL DEFAULT '{}', -- execuções que causaram o evento (proteção contra laço)
  passos              int         NOT NULL DEFAULT 0,
  tentativas_no       int         NOT NULL DEFAULT 0,
  proxima_tentativa_em timestamptz,
  erro                varchar(500),
  iniciada_em         timestamptz NOT NULL DEFAULT now(),
  atualizada_em       timestamptz NOT NULL DEFAULT now(),
  finalizada_em       timestamptz,
  interrompida_por    uuid        REFERENCES usuarios(id),
  UNIQUE (versao_id, evento_id)                          -- o mesmo evento nunca cria duas execuções
);
-- Sem concorrência: uma execução ativa por automação e candidato.
CREATE UNIQUE INDEX automacao_execucoes_uma_ativa ON automacao_execucoes (automacao_id, candidato_id)
  WHERE situacao IN ('em_andamento', 'aguardando');
CREATE INDEX automacao_execucoes_prontas ON automacao_execucoes (proxima_tentativa_em) WHERE situacao = 'em_andamento';
CREATE INDEX automacao_execucoes_por_automacao ON automacao_execucoes (automacao_id, iniciada_em DESC);
CREATE INDEX automacao_execucoes_por_candidato ON automacao_execucoes (candidato_id, iniciada_em DESC);

CREATE TABLE automacao_passos (
  id            bigserial   PRIMARY KEY,
  execucao_id   uuid        NOT NULL REFERENCES automacao_execucoes(id),
  no_id         varchar(40) NOT NULL,
  tipo_card     varchar(60) NOT NULL,
  situacao      varchar(12) NOT NULL CHECK (situacao IN ('concluido', 'aguardando', 'erro')),
  saida         varchar(30),
  resumo        varchar(500),                          -- o que aconteceu, sem dados pessoais
  erro          varchar(500),
  tentativa     int         NOT NULL DEFAULT 1,
  em            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automacao_passos_execucao ON automacao_passos (execucao_id, id);

CREATE TABLE automacao_esperas (
  id            bigserial   PRIMARY KEY,
  execucao_id   uuid        NOT NULL REFERENCES automacao_execucoes(id),
  candidato_id  uuid        NOT NULL REFERENCES candidatos(id),
  no_id         varchar(40) NOT NULL,
  tipo          varchar(10) NOT NULL CHECK (tipo IN ('tempo', 'resposta')),
  retomar_em    timestamptz,                           -- tempo: quando continuar
  prazo_em      timestamptz,                           -- resposta: até quando esperar
  saida_tempo   varchar(30) NOT NULL,                  -- saída usada quando o tempo vence
  canal         varchar(10),                           -- resposta: qualquer / whatsapp / portal
  criada_em     timestamptz NOT NULL DEFAULT now(),
  resolvida_em  timestamptz,
  resolucao     varchar(20)                            -- tempo, resposta, interrompida
);
CREATE INDEX automacao_esperas_abertas ON automacao_esperas (COALESCE(retomar_em, prazo_em)) WHERE resolvida_em IS NULL;
CREATE INDEX automacao_esperas_resposta ON automacao_esperas (candidato_id) WHERE resolvida_em IS NULL AND tipo = 'resposta';

-- Eventos de domínio: chave única para os disparos agendados (data da entrevista, horário programado).
ALTER TABLE eventos_dominio ADD COLUMN chave_unica varchar(200);
CREATE UNIQUE INDEX eventos_dominio_chave_unica ON eventos_dominio (chave_unica) WHERE chave_unica IS NOT NULL;

-- Proteção contra laço: o evento criado dentro de um passo de automação herda a cadeia de execuções
-- (o motor define "aprovarh.cadeia" na transação do passo; os serviços não precisam saber disso).
CREATE FUNCTION eventos_dominio_cadeia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c text := current_setting('aprovarh.cadeia', true);
BEGIN
  IF c IS NOT NULL AND c <> '' AND cardinality(NEW.cadeia_origem) = 0 THEN
    NEW.cadeia_origem := string_to_array(c, ',')::uuid[];
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER eventos_dominio_cadeia BEFORE INSERT ON eventos_dominio FOR EACH ROW EXECUTE FUNCTION eventos_dominio_cadeia();

-- Os eventos gravados desde a etapa 2 não disparam nada: o motor começa a partir daqui.
UPDATE eventos_dominio SET processado_em = now() WHERE processado_em IS NULL;
