-- Etapa 13: pré-cadastro feito pelo RH e convite pelo WhatsApp (decisão D47).
-- O RH cadastra quem mandou só o currículo (nome, telefone, unidade e currículo). A ficha fica "pendente" até o
-- candidato abrir o link do convite e completar o formulário (CPF e aceite do aviso de privacidade). Depois disso,
-- o portal abre sozinho.

-- Enquanto a ficha está pendente, ainda não há CPF nem aceite do aviso.
ALTER TABLE candidatos ALTER COLUMN cpf DROP NOT NULL;
ALTER TABLE candidatos ALTER COLUMN cpf_hash DROP NOT NULL;
ALTER TABLE candidatos ALTER COLUMN cpf_final DROP NOT NULL;
ALTER TABLE candidatos ALTER COLUMN consentimento_em DROP NOT NULL;
ALTER TABLE candidatos ALTER COLUMN aviso_versao DROP NOT NULL;

ALTER TABLE candidatos
  ADD COLUMN origem              varchar(12) NOT NULL DEFAULT 'formulario' CHECK (origem IN ('formulario', 'rh')),
  ADD COLUMN cadastro_pendente   boolean     NOT NULL DEFAULT false,
  ADD COLUMN pre_cadastrado_por  uuid        REFERENCES usuarios(id),
  ADD COLUMN convite_token_hash  char(64)    UNIQUE,
  ADD COLUMN convite_expira_em   timestamptz,
  ADD COLUMN convite_enviado_em  timestamptz,
  ADD COLUMN convite_enviado_por uuid        REFERENCES usuarios(id),
  ADD COLUMN convite_agendado_para timestamptz,
  ADD COLUMN cadastro_completo_em timestamptz;

-- Ficha completa sempre tem CPF e aceite do aviso.
ALTER TABLE candidatos ADD CONSTRAINT candidatos_cadastro_completo CHECK (
  cadastro_pendente OR (cpf IS NOT NULL AND cpf_hash IS NOT NULL AND cpf_final IS NOT NULL AND consentimento_em IS NOT NULL AND aviso_versao IS NOT NULL)
);
CREATE INDEX candidatos_pendentes ON candidatos (unidade_id) WHERE cadastro_pendente AND excluido_em IS NULL;

-- Um pré-cadastro unificado com uma ficha que já existia (mesmo CPF) fica registrado.
ALTER TABLE candidaturas DROP CONSTRAINT IF EXISTS candidaturas_tipo_check;
ALTER TABLE candidaturas ADD CONSTRAINT candidaturas_tipo_check CHECK (tipo IN ('nova', 'repetida', 'reaberta', 'convite'));
