-- Etapa 12: confirmação da candidatura pelo WhatsApp (decisão D44).
-- O formulário mostra o botão "Confirmar pelo WhatsApp" (texto pronto + protocolo), para o candidato escrever primeiro
-- (menos risco de bloqueio do número). Uma automação só cuida dos dois caminhos:
--   o candidato escreveu em até 10 minutos → responde que a candidatura foi recebida;
--   não escreveu em 10 minutos → o robô envia a mesma confirmação primeiro.

-- Protocolo da candidatura: ajuda a reconhecer quem escreveu quando o WhatsApp não informa o telefone ("@lid").
CREATE TABLE candidatura_protocolos (
  protocolo    varchar(12) PRIMARY KEY,
  candidato_id uuid        NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  usado_em     timestamptz
);
CREATE INDEX candidatura_protocolos_candidato ON candidatura_protocolos (candidato_id);

-- Automação pronta, salva como RASCUNHO (só passa a valer depois de publicada na tela Automações).
INSERT INTO automacoes (nome, descricao, situacao, fluxo_rascunho)
SELECT
  'Confirmar candidatura pelo WhatsApp',
  'Depois da candidatura, espera até 10 minutos o candidato escrever pelo botão "Confirmar pelo WhatsApp". Se escrever, responde na hora; se não escrever, o robô envia a confirmação primeiro.',
  'rascunho',
  jsonb_build_object(
    'nos', jsonb_build_array(
      jsonb_build_object('id', 'gatilho', 'tipo', 'gatilho.candidato_cadastrado', 'params', jsonb_build_object('incluirRepetidas', false),
        'posicao', jsonb_build_object('x', 0, 'y', 0), 'nome', 'Nova candidatura'),
      jsonb_build_object('id', 'espera', 'tipo', 'tempo.aguardar_resposta',
        'params', jsonb_build_object('prazoHoras', 10, 'unidadePrazo', 'minutos', 'canal', 'whatsapp'),
        'posicao', jsonb_build_object('x', 0, 'y', 140), 'nome', 'Esperar o candidato escrever (10 min)'),
      jsonb_build_object('id', 'confirmar', 'tipo', 'acao.whatsapp_mensagem', 'params', jsonb_build_object('texto',
        E'Olá, {nome}! Recebemos sua candidatura para a unidade {unidade} da Hummm! Pizzas.\n\nNossa equipe de RH vai analisar seu cadastro e, se o seu perfil avançar, falaremos com você por aqui mesmo. Se tiver alguma dúvida, é só responder esta mensagem.\n\nObrigado pelo interesse!'),
        'posicao', jsonb_build_object('x', 0, 'y', 300), 'nome', 'Candidatura recebida')
    ),
    'ligacoes', jsonb_build_array(
      jsonb_build_object('id', 'l_gatilho_proximo', 'de', 'gatilho', 'saida', 'proximo', 'para', 'espera'),
      jsonb_build_object('id', 'l_espera_respondeu', 'de', 'espera', 'saida', 'respondeu', 'para', 'confirmar'),
      jsonb_build_object('id', 'l_espera_tempo_esgotado', 'de', 'espera', 'saida', 'tempo_esgotado', 'para', 'confirmar')
    )
  )
WHERE NOT EXISTS (SELECT 1 FROM automacoes WHERE nome = 'Confirmar candidatura pelo WhatsApp' AND excluida_em IS NULL);
