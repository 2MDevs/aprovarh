-- A pedido da TI: a "Confirmação da candidatura (WhatsApp)" passa a ter o desenho combinado (versão nova, já publicada):
--   Candidatura realizada → "Candidato enviou mensagem?"
--     SIM → envia "candidatura recebida" (não espera os 10 minutos)
--     NÃO → aguarda até 10 minutos → mandou mensagem → envia "candidatura recebida"
--                                   → não mandou     → envia "candidatura recebida" (o robô escreve primeiro)
-- Execuções que já começaram terminam na versão em que começaram.

CREATE TEMP TABLE _fluxo_013 AS
SELECT jsonb_build_object(
  'nos', jsonb_build_array(
    jsonb_build_object('id', 'gatilho', 'tipo', 'gatilho.candidato_cadastrado', 'params', jsonb_build_object('incluirRepetidas', false),
      'posicao', jsonb_build_object('x', 0, 'y', 0), 'nome', 'Candidatura realizada'),
    jsonb_build_object('id', 'enviou', 'tipo', 'condicao.enviou_mensagem', 'params', jsonb_build_object('canal', 'whatsapp', 'desde', 'candidatura'),
      'posicao', jsonb_build_object('x', 0, 'y', 150), 'nome', 'Candidato enviou mensagem?'),
    jsonb_build_object('id', 'espera', 'tipo', 'tempo.aguardar_resposta', 'params', jsonb_build_object('prazoHoras', 10, 'unidadePrazo', 'minutos', 'canal', 'whatsapp'),
      'posicao', jsonb_build_object('x', 320, 'y', 300), 'nome', 'Aguardar 10 minutos (mandou mensagem?)'),
    jsonb_build_object('id', 'confirmar', 'tipo', 'acao.whatsapp_mensagem', 'params', jsonb_build_object('texto',
      E'Olá, {nome}! Recebemos sua candidatura para a unidade {unidade} da Hummm! Pizzas.\n\nNossa equipe de RH vai analisar seu cadastro e, se o seu perfil avançar, falaremos com você por aqui mesmo. Se tiver alguma dúvida, é só responder esta mensagem.\n\nObrigado pelo interesse!'),
      'posicao', jsonb_build_object('x', 0, 'y', 470), 'nome', 'Candidatura recebida')
  ),
  'ligacoes', jsonb_build_array(
    jsonb_build_object('id', 'l_gatilho_proximo', 'de', 'gatilho', 'saida', 'proximo', 'para', 'enviou'),
    jsonb_build_object('id', 'l_enviou_sim', 'de', 'enviou', 'saida', 'sim', 'para', 'confirmar'),
    jsonb_build_object('id', 'l_enviou_nao', 'de', 'enviou', 'saida', 'nao', 'para', 'espera'),
    jsonb_build_object('id', 'l_espera_respondeu', 'de', 'espera', 'saida', 'respondeu', 'para', 'confirmar'),
    jsonb_build_object('id', 'l_espera_tempo_esgotado', 'de', 'espera', 'saida', 'tempo_esgotado', 'para', 'confirmar')
  )
) AS fluxo;

-- Se a automação não existir mais (foi excluída), cria de novo.
INSERT INTO automacoes (nome, descricao, situacao, fluxo_rascunho)
SELECT 'Confirmação da candidatura (WhatsApp)', '', 'rascunho', f.fluxo FROM _fluxo_013 f
WHERE NOT EXISTS (SELECT 1 FROM automacoes WHERE nome = 'Confirmação da candidatura (WhatsApp)' AND excluida_em IS NULL);

UPDATE automacoes a
   SET fluxo_rascunho = f.fluxo, rascunho_alterado_em = now(), atualizada_em = now(),
       descricao = 'Candidatura realizada: se o candidato já mandou mensagem pelo WhatsApp, confirma na hora; se não, espera até 10 minutos. Mandou nesse tempo: confirma na hora. Não mandou: o robô envia a confirmação primeiro.'
  FROM _fluxo_013 f
 WHERE a.nome = 'Confirmação da candidatura (WhatsApp)' AND a.excluida_em IS NULL;

INSERT INTO automacao_versoes (automacao_id, numero, fluxo, gatilho, espera_resposta)
SELECT a.id, COALESCE((SELECT max(numero) FROM automacao_versoes v WHERE v.automacao_id = a.id), 0) + 1, a.fluxo_rascunho, 'gatilho.candidato_cadastrado', true
  FROM automacoes a
 WHERE a.nome = 'Confirmação da candidatura (WhatsApp)' AND a.excluida_em IS NULL;

UPDATE automacoes a
   SET versao_publicada_id = v.id, situacao = 'ativa', atualizada_em = now()
  FROM automacao_versoes v
 WHERE v.automacao_id = a.id AND a.nome = 'Confirmação da candidatura (WhatsApp)' AND a.excluida_em IS NULL
   AND v.numero = (SELECT max(numero) FROM automacao_versoes x WHERE x.automacao_id = a.id);

DROP TABLE _fluxo_013;
