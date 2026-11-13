-- aprovaRH · 002 · candidatos, candidaturas, arquivos cifrados, status, etapas, conversa e eventos.
-- Regra de cadastro repetido: uma pessoa = um CPF = uma ficha (candidatos.cpf_hash é único).

-- ── Arquivos (conteúdo cifrado em disco, fora da pasta pública) ────────────
CREATE TABLE arquivos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_original varchar(255) NOT NULL,       -- nome saneado
  tipo_mime     varchar(100) NOT NULL,       -- conferido pelo conteúdo, não pela extensão
  extensao      varchar(10)  NOT NULL,
  tamanho       bigint       NOT NULL,
  sha256        char(64)     NOT NULL,       -- do conteúdo original, conferido ao baixar
  caminho       varchar(255) NOT NULL UNIQUE,-- relativo a STORAGE_DIR/arquivos
  enviado_em    timestamptz  NOT NULL DEFAULT now(),
  excluido_em   timestamptz
);

-- ── Status do processo seletivo (personalizáveis na etapa 4) ───────────────
CREATE TABLE status (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           varchar(60)  NOT NULL,
  cor            varchar(9)   NOT NULL DEFAULT '#78716C',
  ordem          integer      NOT NULL DEFAULT 0,
  final          boolean      NOT NULL DEFAULT false,  -- encerra a candidatura (Aprovado, Reprovado)
  chave_sistema  varchar(40)  UNIQUE,                  -- os 5 iniciais; nunca excluídos
  -- Como o status aparece na linha do tempo do portal (etapa 5)
  etapa_portal   varchar(20)  NOT NULL DEFAULT 'analise' CHECK (etapa_portal IN ('candidatura', 'analise', 'entrevista', 'resultado')),
  situacao_portal varchar(20) NOT NULL DEFAULT 'em_andamento' CHECK (situacao_portal IN ('concluida', 'em_andamento', 'aguardando', 'nao_iniciada')),
  ativo          boolean      NOT NULL DEFAULT true,
  criado_em      timestamptz  NOT NULL DEFAULT now(),
  atualizado_em  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX status_nome_unico ON status (lower(nome)) WHERE ativo;

INSERT INTO status (nome, cor, ordem, final, chave_sistema, etapa_portal, situacao_portal) VALUES
  ('Novo candidato',        '#F6D35C', 1, false, 'novo',                 'analise',    'em_andamento'),
  ('Aguardando entrevista', '#E9A23B', 2, false, 'aguardando_entrevista','entrevista', 'aguardando'),
  ('Pré-aprovado',          '#3B82F6', 3, false, 'pre_aprovado',         'entrevista', 'concluida'),
  ('Aprovado',              '#1F7A4D', 4, true,  'aprovado',             'resultado',  'concluida'),
  ('Reprovado',             '#EA3324', 5, true,  'reprovado',            'resultado',  'concluida');

-- ── Candidatos (uma ficha por CPF) ─────────────────────────────────────────
CREATE SEQUENCE candidatos_codigo_seq START 1;

CREATE TABLE candidatos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo             varchar(12)  NOT NULL UNIQUE DEFAULT ('C-' || lpad(nextval('candidatos_codigo_seq')::text, 6, '0')),
  nome               varchar(80)  NOT NULL,
  sobrenome          varchar(120) NOT NULL,
  cpf                text         NOT NULL,          -- cifrado (AES-256-GCM)
  cpf_hash           char(64)     NOT NULL,          -- HMAC: identifica cadastro repetido sem guardar o CPF aberto
  cpf_final          char(2)      NOT NULL,          -- 2 últimos dígitos, para mostrar mascarado
  telefone           text         NOT NULL,          -- cifrado, formato +55DDDNUMERO
  telefone_hash      char(64)     NOT NULL,          -- HMAC: achar o candidato pelo WhatsApp (etapa 7)
  telefone_final     char(4)      NOT NULL,
  unidade_id         uuid         NOT NULL REFERENCES unidades(id),
  status_id          uuid         NOT NULL REFERENCES status(id),
  foto_id            uuid         REFERENCES arquivos(id),
  curriculo_id       uuid         REFERENCES arquivos(id),
  candidatura_em     timestamptz  NOT NULL DEFAULT now(),   -- última candidatura recebida
  consentimento_em   timestamptz  NOT NULL,
  aviso_versao       char(12)     NOT NULL,          -- versão (hash) do aviso de privacidade aceito
  ultima_interacao_em timestamptz NOT NULL DEFAULT now(),
  criado_em          timestamptz  NOT NULL DEFAULT now(),
  atualizado_em      timestamptz  NOT NULL DEFAULT now(),
  excluido_em        timestamptz
);
CREATE UNIQUE INDEX candidatos_cpf_unico ON candidatos (cpf_hash) WHERE excluido_em IS NULL;
CREATE INDEX candidatos_telefone ON candidatos (telefone_hash) WHERE excluido_em IS NULL;
CREATE INDEX candidatos_unidade ON candidatos (unidade_id, ultima_interacao_em DESC) WHERE excluido_em IS NULL;

-- Cada envio do formulário (inclusive os repetidos) fica registrado.
-- Um envio repetido NUNCA altera nome, telefone ou unidade da ficha: quem souber o CPF de outra pessoa
-- não consegue desviar o contato dela. A diferença fica registrada aqui para a gestora decidir.
CREATE TABLE candidaturas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id  uuid         NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  unidade_id    uuid         NOT NULL REFERENCES unidades(id),   -- unidade pedida neste envio
  tipo          varchar(20)  NOT NULL CHECK (tipo IN ('nova', 'repetida', 'reaberta')),
  nome_informado varchar(210) NOT NULL,
  telefone_informado text     NOT NULL,                          -- cifrado
  telefone_diferente boolean  NOT NULL DEFAULT false,
  unidade_diferente  boolean  NOT NULL DEFAULT false,
  curriculo_id  uuid         REFERENCES arquivos(id),
  foto_id       uuid         REFERENCES arquivos(id),
  ip            varchar(64),
  recebida_em   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX candidaturas_candidato ON candidaturas (candidato_id, recebida_em DESC);

-- Todos os arquivos da ficha (histórico: currículos e fotos anteriores continuam guardados)
CREATE TABLE candidato_arquivos (
  candidato_id uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  arquivo_id   uuid        NOT NULL REFERENCES arquivos(id),
  tipo         varchar(20) NOT NULL CHECK (tipo IN ('curriculo', 'foto', 'anexo')),
  enviado_por  varchar(20) NOT NULL DEFAULT 'candidato' CHECK (enviado_por IN ('candidato', 'gestora')),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidato_id, arquivo_id)
);

CREATE TABLE status_historico (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id     uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  status_anterior_id uuid      REFERENCES status(id),
  status_novo_id   uuid        NOT NULL REFERENCES status(id),
  autor_tipo       varchar(20) NOT NULL CHECK (autor_tipo IN ('usuario', 'automacao', 'sistema')),
  autor_usuario_id uuid        REFERENCES usuarios(id),
  autor_nome       varchar(160),
  motivo           varchar(255),
  em               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_historico_candidato ON status_historico (candidato_id, em DESC);

-- Linha do tempo do portal (4 etapas)
CREATE TABLE etapas_candidato (
  candidato_id  uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  etapa         varchar(20) NOT NULL CHECK (etapa IN ('candidatura', 'analise', 'entrevista', 'resultado')),
  situacao      varchar(20) NOT NULL CHECK (situacao IN ('concluida', 'em_andamento', 'aguardando', 'nao_iniciada')),
  origem        varchar(20) NOT NULL DEFAULT 'automatica' CHECK (origem IN ('automatica', 'manual')),
  atualizado_por uuid       REFERENCES usuarios(id),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidato_id, etapa)
);

-- ── Conversa: uma por candidato (as mensagens chegam na etapa 4) ───────────
CREATE TABLE conversas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id       uuid        NOT NULL UNIQUE REFERENCES candidatos(id) ON DELETE CASCADE,
  ultima_mensagem_em timestamptz,
  criada_em          timestamptz NOT NULL DEFAULT now()
);

-- ── Eventos de domínio (a "cola" entre os módulos; o motor de automações lê daqui na etapa 8) ──
CREATE TABLE eventos_dominio (
  id            bigserial   PRIMARY KEY,
  tipo          varchar(60) NOT NULL,
  candidato_id  uuid        REFERENCES candidatos(id) ON DELETE SET NULL,
  dados         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  cadeia_origem uuid[]      NOT NULL DEFAULT '{}',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz
);
CREATE INDEX eventos_dominio_pendentes ON eventos_dominio (id) WHERE processado_em IS NULL;
