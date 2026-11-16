-- Etapa 11.
-- 1) Contas novas do WhatsApp chegam identificadas por um código ("@lid") no lugar do telefone.
--    Aqui fica o vínculo código → candidato, aprendido quando o WhatsApp confirma a entrega de uma mensagem nossa.
CREATE TABLE whatsapp_lids (
  lid          varchar(80) PRIMARY KEY,
  candidato_id uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_lids_candidato ON whatsapp_lids (candidato_id);

-- 2) Bloqueio de tela por inatividade desligado a pedido da TI (0 = nunca bloquear). Pode ser religado em Integração › Segurança & Sessão.
INSERT INTO configuracoes (chave, valor, segredo) VALUES ('seguranca.bloqueio_minutos', '0', false)
ON CONFLICT (chave) DO UPDATE SET valor = '0', atualizado_em = now();
