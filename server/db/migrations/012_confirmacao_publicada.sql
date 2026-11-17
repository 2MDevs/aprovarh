-- A pedido da TI: troca a automação de confirmação por uma nova, que já entra PUBLICADA (ativa).
-- 1) Exclui "Confirmar candidatura pelo WhatsApp" (migração 011) e encerra o que estava esperando.
UPDATE automacao_esperas w
   SET resolvida_em = now(), resolucao = 'interrompida'
  FROM automacao_execucoes e JOIN automacoes a ON a.id = e.automacao_id
 WHERE w.execucao_id = e.id AND w.resolvida_em IS NULL AND a.nome = 'Confirmar candidatura pelo WhatsApp';
UPDATE automacao_execucoes e
   SET situacao = 'interrompida', erro = 'Automação substituída (migração 012).', atualizada_em = now()
  FROM automacoes a
 WHERE a.id = e.automacao_id AND a.nome = 'Confirmar candidatura pelo WhatsApp' AND e.situacao IN ('em_andamento', 'aguardando');
UPDATE automacoes
   SET excluida_em = now(), situacao = CASE WHEN situacao = 'ativa' THEN 'pausada' ELSE situacao END, atualizada_em = now()
 WHERE excluida_em IS NULL AND nome = 'Confirmar candidatura pelo WhatsApp';

-- 2) Pausa a "Boas Vindas Candidato" (o robô escrevia logo após a candidatura; agora quem confirma é a automação nova).
UPDATE automacoes SET situacao = 'pausada', atualizada_em = now()
 WHERE excluida_em IS NULL AND situacao = 'ativa' AND lower(trim(nome)) = 'boas vindas candidato';

-- 3) Automação nova, já publicada: nova candidatura → espera até 10 minutos o candidato escrever pelo WhatsApp
--    → respondeu ou acabou o tempo → envia a confirmação (uma mensagem só).
INSERT INTO automacoes (nome, descricao, situacao, fluxo_rascunho)
SELECT
  'Confirmação da candidatura (WhatsApp)',
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
WHERE NOT EXISTS (SELECT 1 FROM automacoes WHERE nome = 'Confirmação da candidatura (WhatsApp)' AND excluida_em IS NULL);

-- Publica a versão 1 (o mesmo que o botão Publicar faz).
INSERT INTO automacao_versoes (automacao_id, numero, fluxo, gatilho, espera_resposta)
SELECT a.id, 1, a.fluxo_rascunho, 'gatilho.candidato_cadastrado', true
  FROM automacoes a
 WHERE a.nome = 'Confirmação da candidatura (WhatsApp)' AND a.excluida_em IS NULL AND a.versao_publicada_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM automacao_versoes v WHERE v.automacao_id = a.id);

UPDATE automacoes a
   SET versao_publicada_id = v.id, situacao = 'ativa', atualizada_em = now()
  FROM automacao_versoes v
 WHERE v.automacao_id = a.id AND v.numero = 1
   AND a.nome = 'Confirmação da candidatura (WhatsApp)' AND a.excluida_em IS NULL AND a.versao_publicada_id IS NULL;
