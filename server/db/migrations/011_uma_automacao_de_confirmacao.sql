-- Ajuste da decisão D44, a pedido da TI: a confirmação da candidatura fica em UMA automação só.
-- 1) Exclui as duas automações criadas pela migração 010 ("Confirmar candidatura pelo WhatsApp" e
--    "Confirmar candidatura se o candidato não escrever"). Se alguma foi publicada, também é pausada.
UPDATE automacoes
   SET excluida_em = now(), situacao = CASE WHEN situacao = 'ativa' THEN 'pausada' ELSE situacao END, atualizada_em = now()
 WHERE excluida_em IS NULL
   AND nome IN ('Confirmar candidatura pelo WhatsApp', 'Confirmar candidatura se o candidato não escrever');

-- Execuções delas que ainda estavam esperando param aqui.
UPDATE automacao_execucoes e
   SET situacao = 'interrompida', erro = 'Automação substituída (migração 011).', atualizada_em = now()
  FROM automacoes a
 WHERE a.id = e.automacao_id AND a.excluida_em IS NOT NULL
   AND a.nome IN ('Confirmar candidatura pelo WhatsApp', 'Confirmar candidatura se o candidato não escrever')
   AND e.situacao IN ('em_andamento', 'aguardando');

UPDATE automacao_esperas w
   SET resolvida_em = now(), resolucao = 'interrompida'
  FROM automacao_execucoes e JOIN automacoes a ON a.id = e.automacao_id
 WHERE w.execucao_id = e.id AND w.resolvida_em IS NULL AND a.excluida_em IS NOT NULL
   AND a.nome IN ('Confirmar candidatura pelo WhatsApp', 'Confirmar candidatura se o candidato não escrever');

-- 2) A tag "Candidatura confirmada" não é mais usada: sai da lista se nenhum candidato estiver com ela.
UPDATE tags SET ativa = false, atualizado_em = now()
 WHERE lower(nome) = 'candidatura confirmada' AND ativa
   AND NOT EXISTS (SELECT 1 FROM candidato_tags ct WHERE ct.tag_id = tags.id);

-- 3) A automação única: nova candidatura → aguarda até 10 minutos o candidato escrever → confirma nos dois casos.
-- Salva como RASCUNHO (só passa a valer depois de publicada na tela Automações).
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
