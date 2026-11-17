-- Etapa 12: o candidato confirma a candidatura pelo WhatsApp (decisão D44).
-- Em vez do robô escrever primeiro (mais risco de bloqueio do número), o formulário mostra o botão
-- "Confirmar pelo WhatsApp" com um texto pronto e um protocolo. Quando o candidato escreve, a automação
-- "Confirmar candidatura pelo WhatsApp" responde que a candidatura foi recebida.

-- Protocolo da candidatura: ajuda a reconhecer quem escreveu quando o WhatsApp não informa o telefone ("@lid").
CREATE TABLE candidatura_protocolos (
  protocolo    varchar(12) PRIMARY KEY,
  candidato_id uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  usado_em     timestamptz
);
CREATE INDEX candidatura_protocolos_candidato ON candidatura_protocolos (candidato_id);

-- Tag usada pela automação para responder uma vez só.
INSERT INTO tags (nome, cor)
SELECT 'Candidatura confirmada', '#16A34A'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE lower(nome) = 'candidatura confirmada' AND ativa);

-- Automação pronta, salva como RASCUNHO (só passa a valer depois de publicada na tela Automações).
INSERT INTO automacoes (nome, descricao, situacao, fluxo_rascunho)
SELECT
  'Confirmar candidatura pelo WhatsApp',
  'Quando o candidato escreve pelo WhatsApp pela primeira vez (botão "Confirmar pelo WhatsApp" do formulário), responde que a candidatura foi recebida. Responde uma vez só, pela tag "Candidatura confirmada".',
  'rascunho',
  jsonb_build_object(
    'nos', jsonb_build_array(
      jsonb_build_object('id', 'gatilho', 'tipo', 'gatilho.mensagem_recebida', 'params', jsonb_build_object('canal', 'whatsapp'),
        'posicao', jsonb_build_object('x', 0, 'y', 0), 'nome', 'Candidato escreveu no WhatsApp'),
      jsonb_build_object('id', 'ja_confirmou', 'tipo', 'condicao.tag', 'params', jsonb_build_object('tag', t.id::text),
        'posicao', jsonb_build_object('x', 0, 'y', 140), 'nome', 'Já recebeu a confirmação?'),
      jsonb_build_object('id', 'marcar', 'tipo', 'acao.adicionar_tag', 'params', jsonb_build_object('tag', t.id::text),
        'posicao', jsonb_build_object('x', 180, 'y', 280), 'nome', 'Marcar como confirmada'),
      jsonb_build_object('id', 'responder', 'tipo', 'acao.whatsapp_mensagem', 'params', jsonb_build_object('texto',
        E'Olá, {nome}! Recebemos sua candidatura para a unidade {unidade} da Hummm! Pizzas.\n\nNossa equipe de RH vai analisar seu cadastro e, se o seu perfil avançar, falaremos com você por aqui mesmo.\n\nObrigado pelo interesse!'),
        'posicao', jsonb_build_object('x', 180, 'y', 420), 'nome', 'Candidatura recebida')
    ),
    'ligacoes', jsonb_build_array(
      jsonb_build_object('id', 'l_gatilho_proximo', 'de', 'gatilho', 'saida', 'proximo', 'para', 'ja_confirmou'),
      jsonb_build_object('id', 'l_ja_confirmou_nao', 'de', 'ja_confirmou', 'saida', 'nao', 'para', 'marcar'),
      jsonb_build_object('id', 'l_marcar_proximo', 'de', 'marcar', 'saida', 'proximo', 'para', 'responder')
    )
  )
FROM tags t
WHERE lower(t.nome) = 'candidatura confirmada' AND t.ativa
  AND NOT EXISTS (SELECT 1 FROM automacoes WHERE nome = 'Confirmar candidatura pelo WhatsApp' AND excluida_em IS NULL)
LIMIT 1;
