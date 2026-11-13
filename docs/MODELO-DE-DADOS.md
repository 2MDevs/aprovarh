# aprovaRH: modelo de dados (PostgreSQL)

Convenções: ids `uuid`; datas `timestamptz` (gravadas em UTC; exibidas e calculadas em `America/Sao_Paulo`); `criado_em`, `atualizado_em`, `criado_por` em todas as tabelas de negócio; exclusão lógica (`excluido_em`) + lixeira padrão de 7 dias onde couber. Campos marcados **🔒** são cifrados com AES-256-GCM.

## 1. Base padrão (igual ao DocSecure)

`usuarios`, `perfis`, `perfil_permissoes`, `sessoes`, `dispositivos`, `codigos_2fa`, `redefinicoes_senha`, `configuracoes` (Banco > .env > padrão, segredos 🔒), `chaves_api`, `webhooks`, `auditoria` (hash do registro + hash do anterior), `arquivos` (caminho, tamanho, tipo, sha256, chave de cifra), `lixeira`, `notificacoes`, `versoes_aplicadas`.

## 2. Unidades e acesso

| Tabela | Campos principais |
|---|---|
| `unidades` | nome, código (ex.: KM32), ativa. *Cadastradas pela Diretoria; lista real "A definir".* |
| `usuario_unidades` | usuario_id, unidade_id (ou flag `todas_unidades` em `usuarios`) |

## 3. Candidatos

| Tabela | Campos principais |
|---|---|
| `candidatos` | codigo (sequencial legível, ex.: C-000123, **nunca usado como acesso**), nome, sobrenome, **cpf 🔒, cpf_hash (único: uma ficha por CPF)**, telefone 🔒, telefone_hash (busca), unidade_id, status_id, candidatura_em, consentimento_lgpd_em, versao_aviso_privacidade, origem (link público), excluido_em |
| `candidaturas` | cada envio do formulário: tipo (nova / repetida / reaberta), nome e telefone 🔒 informados, se diferem da ficha, unidade pedida, arquivos, IP |
| `candidato_arquivos` | candidato_id, tipo (`curriculo`, `foto`, `anexo`), arquivo_id, enviado_por (candidato / gestora) |
| `observacoes` | candidato_id, texto 🔒, autor_id. **Nunca aparecem no portal** |
| `status` | nome, cor, ordem, final (sim/não), chave_sistema (para os 5 iniciais), ativo; **ligação com a linha do tempo**: etapa e situação que o status representa no portal |
| `status_historico` | candidato_id, status_anterior_id, status_novo_id, autor (usuário ou automação/execução), motivo, em |
| `tags` | nome, cor, ativa |
| `candidato_tags` | candidato_id, tag_id, adicionada_por, adicionada_em |
| `tags_historico` | candidato_id, tag_id, ação (adicionada / removida), autor, em |
| `etapas_candidato` | candidato_id, etapa (`candidatura`, `analise`, `entrevista`, `resultado`), situação (`concluida`, `em_andamento`, `aguardando`, `nao_iniciada`), origem (automática / manual), atualizado_por, em |
| `etapas_historico` | registro de cada mudança de etapa |

**Status iniciais (criados na instalação):** Novo candidato, Aguardando entrevista, Pré-aprovado, Aprovado, Reprovado.

## 4. Conversa (uma por candidato)

| Tabela | Campos principais |
|---|---|
| `conversas` | candidato_id **único** (garante que não há conversa duplicada), ultima_mensagem_em, janela_whatsapp_ate |
| `mensagens` | conversa_id, sentido (entrada / saída), canal (`portal`, `whatsapp`, `sistema`), autor_tipo (`candidato`, `gestora`, `chatbot`, `sistema`), autor_usuario_id, execucao_id, texto 🔒, arquivo_id, modelo_whatsapp_id, visivel_ao_candidato, wamid (único), situação_entrega, criado_em |
| `mensagens_lidas` | mensagem_id, usuario_id, lida_em (não lidas por pessoa) |
| `contatos_nao_identificados` | telefone 🔒, telefone_hash, última mensagem, vinculado_a_candidato_id |

## 5. Portal temporário

| Tabela | Campos principais |
|---|---|
| `liberacoes_acesso` | candidato_id, codigo_hash (HMAC, único), liberado_em, expira_em (23:59:59.999 Brasília do dia), revogada_em, revogada_por, motivo, gerada_por (usuário ou execução), mensagem_envio_id, permite_envio_arquivo, situação (`ativa`, `expirada`, `revogada`) |
| `sessoes_portal` | liberacao_id, token_hash, criada_em, ultimo_uso_em, encerrada_em, motivo_encerramento (expirou / revogada / saiu), ip, dispositivo |
| `acessos_portal` | tentativas de entrada (sucesso / falha), ip, em. Alimenta o "Histórico de acesso ao portal" |

## 6. Entrevistas

| Tabela | Campos principais |
|---|---|
| `disponibilidades` | unidade_id, data_inicial, data_final, dias_da_semana, horarios (lista), duracao_minutos, vagas_por_horario, responsavel_id, ativa |
| `disponibilidade_bloqueios` | unidade_id, data (feriado, folga) |
| `entrevistas` | candidato_id, unidade_id, disponibilidade_id, inicio_em, situação (`agendada`, `aguardando_confirmacao`, `confirmada`, `remarcacao_solicitada`, `cancelada`, `realizada`, `nao_compareceu`), responsavel_id, criada_por, confirmada_em |
| `entrevista_eventos` | entrevista_id, tipo (envio, resposta SIM/NÃO, data proposta, esclarecimento pedido), resposta_original, data_interpretada, aceita (sim/não), motivo, em |

A vaga é conferida dentro de uma transação com trava, para que dois candidatos não peguem o mesmo horário além do número de vagas.

## 7. WhatsApp

| Tabela | Campos principais |
|---|---|
| `whatsapp_modelos` | nome na Meta, idioma, categoria, situação na Meta, corpo, variáveis, mapeamento variável → dado do sistema |
| `whatsapp_eventos_entrada` | carga bruta 🔒, assinatura_valida, chave_dedup (wamid/status id, única), processado_em, erro |
| `fila_envio` | mensagem_id, tentativas, proxima_tentativa_em, ultimo_erro, chave_idempotencia (única) |

As credenciais ficam em `configuracoes` (🔒).

## 8. Automações

| Tabela | Campos principais |
|---|---|
| `automacoes` | nome, descrição, situação (`rascunho`, `ativa`, `pausada`, `com_erro`), versao_publicada_id, criada_por, atualizada_em |
| `automacao_versoes` | automacao_id, numero, fluxo (jsonb: nós e ligações), resultado_validacao, publicada_em, publicada_por. **Imutável depois de publicada** |
| `eventos_dominio` | tipo, candidato_id, dados (jsonb), cadeia_origem (execuções que o causaram), criado_em |
| `automacao_execucoes` | versao_id, evento_id, candidato_id, modo (`real` / `teste`), situação (`em_andamento`, `aguardando`, `concluida`, `com_erro`, `interrompida`), chave_unica (versao + evento), profundidade, iniciada_em, finalizada_em |
| `automacao_passos` | execucao_id, no_id, tipo_card, situação, entrada, saida, erro, tentativas, chave_idempotencia, iniciado_em, finalizado_em |
| `automacao_esperas` | execucao_id, no_id, tipo (tempo / data / evento / resposta), retomar_em, filtro_evento, prazo_em, resolvida_em |
| `tarefas` | fila genérica do Worker: tipo, executar_em, travada_em, tentativas, dados |

## 9. Ligação com o Gestão no futuro

`unidades` ↔ `Unit` do Gestão e `usuarios` ↔ `User` do Gestão. Quando a ideia for levada para o Gestão, esses dois cadastros deixam de existir no aplicativo e passam a vir de lá. O restante (candidatos, conversas, entrevistas, automações) vira tabelas do próprio aplicativo.
