# aprovaRH: arquitetura

## 1. Visão geral

```
 Navegador da gestora / diretoria          Navegador do candidato
 (Central de RH, Automações, Sistema)      (cadastro público e portal temporário)
              │  HTTPS, cookie de sessão interna       │  HTTPS, cookie de sessão do portal
              ▼                                        ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  API (Express + tsx)                                             │
 │  /api/*         rotas internas (login, 2FA, permissões)          │
 │  /api/publico/* cadastro público (sem login, com limites)        │
 │  /api/portal/*  portal do candidato (sessão do código)           │
 │  /api/webhooks/whatsapp  entrada do WhatsApp (assinatura Meta)   │
 │  /api/eventos   tempo real (Server-Sent Events)                  │
 └───────┬──────────────────────────────────────────┬───────────────┘
         │ SQL                                      │ LISTEN/NOTIFY
         ▼                                          ▼
 ┌──────────────┐                       ┌──────────────────────────┐
 │ PostgreSQL   │◀──────────────────────│ Worker (mesmo código)    │
 │ fonte única  │                       │ • motor de automações    │
 │ de verdade   │                       │ • fila de envio WhatsApp │
 └──────────────┘                       │ • expiração diária 00:00 │
                                        │ • lixeira / temporários  │
 Arquivos cifrados (AES-256-GCM)        └──────────────────────────┘
 em pasta própria do projeto            Atualizador (systemd, padrão)
```

- **Três processos**: API, Worker e Atualizador (o mesmo mecanismo do DocSecure). A API e o Worker usam o mesmo código e o mesmo banco.
- **Sem Redis e sem Firebase.** A fila de tarefas e as esperas das automações ficam em tabelas do PostgreSQL, com `SELECT … FOR UPDATE SKIP LOCKED`. Isso mantém a infraestrutura padrão e evita outro serviço na VPS compartilhada.
- **Tempo real** por Server-Sent Events (SSE): o navegador abre `/api/eventos` e recebe "nova mensagem", "status mudou" etc. O Worker avisa a API por `LISTEN/NOTIFY` do PostgreSQL. O envio de mensagens continua sendo um POST comum. O SSE funciona com o cookie de sessão e não exige biblioteca extra.

## 2. Tecnologias

| Camada | Escolha |
|---|---|
| Front | React + Vite + Tailwind CSS, React Router, TanStack Query; **React Flow (@xyflow/react, licença MIT)** para o construtor de automações; PWA (vite-plugin-pwa) |
| Servidor | Node.js + Express, executado com tsx; Zod para validar entradas; helmet; express-rate-limit |
| Banco | PostgreSQL, migrations SQL versionadas no repositório |
| Senhas e códigos | bcrypt para senhas e PIN (padrão); HMAC-SHA-256 com chave do servidor para os códigos do portal (explicação na seção 6) |
| Criptografia | AES-256-GCM com `SETTINGS_ENCRYPTION_KEY` para arquivos, segredos e dados pessoais sensíveis |
| E-mail | SMTP (Nodemailer), configurado na tela Integração |
| WhatsApp | WhatsApp Business Platform, **Cloud API oficial da Meta** (seção 7) |

## 3. Organização do código

```
apps/
  server/
    src/
      main.ts            # inicia a API
      worker.ts          # inicia o Worker
      config/            # leitura de variáveis (.env) e configurações (Banco > .env > padrão)
      db/                # conexão, migrations, transações
      lib/               # crypto, hash, datas (America/Sao_Paulo), arquivos, erros
      middleware/        # sessão, permissões, CSRF, limites, auditoria
      core/              # auditoria encadeada, eventos de domínio, fila de tarefas, tempo real
      modules/
        auth/            # login, 2FA, dispositivos, PIN, sessões
        usuarios/        # usuários internos, perfis, acesso por unidade
        unidades/
        candidatos/      # cadastro público, perfil, arquivos, observações
        status-tags/
        etapas/          # linha do tempo do candidato
        conversas/       # conversa única por candidato, mensagens, não lidas
        portal/          # códigos, liberações, sessão do candidato
        entrevistas/     # disponibilidade, agendamento, confirmações
        whatsapp/        # provedor, modelos, webhook, fila de envio
        automacoes/      # catálogo de cards, validação, versões, motor
        dashboard/
        sistema/         # recursos, servidor, API & webhooks, artefatos
        integracao/      # tela de integração em cards
        auditoria/
      (cada módulo: routes.ts · controller.ts · service.ts · schemas.ts · repository.ts)
  web/
    src/
      app/               # layout, rotas, tema, sessão
      areas/rh/          # Central de RH
      areas/portal/      # portal do candidato (layout próprio, pacote separado de rotas)
      areas/publico/     # formulário de candidatura
      areas/automacoes/  # construtor visual
      areas/sistema/
      components/
packages/
  shared/                # catálogo de permissões, catálogo de cards, tipos, textos de status
docs/
scripts/                 # update.sh, install-auto-update.sh (padrão)
```

O **catálogo de cards** das automações fica em `packages/shared`. O construtor (front) e o motor (servidor) leem a mesma definição de cada card: entradas, saídas, parâmetros e validação. Assim o que a tela aceita é o que o motor executa.

## 4. Perfis e permissões

| Perfil | O que faz |
|---|---|
| **Desenvolvedor** | Tudo, inclusive Integração e Atualização do sistema (`DEVELOPER_EMAILS`) |
| **Diretoria / Administrador** | Sistema, Auditoria, Dispositivos, usuários, unidades, permissões; vê todos os candidatos das unidades a que tem acesso; não altera a infraestrutura |
| **Gestora de RH** | Central de RH, candidatos, conversas, tags, status, entrevistas, disponibilidade, liberação de acesso, automações, nas unidades a que tem acesso |
| **Colaborador autorizado** | Permissões escolhidas pelo administrador (ver D7) |
| **Candidato** | Fora do sistema de usuários: só entra no portal com um código válido e vê apenas o próprio processo |

- **Escopo por unidade:** cada usuário interno tem uma lista de unidades (ou "todas"). Toda consulta de candidato, conversa, entrevista e indicador é filtrada no servidor por essa lista. O padrão fala em isolamento "por setor". Aqui o setor continua existindo no cadastro do usuário (RH, TI, Diretoria), mas o recorte dos dados é a **unidade**, que é o que o prompt pede (ver D8).
- **Permissões por chave**, por exemplo: `candidatos.ver`, `candidatos.editar`, `candidatos.curriculo.baixar`, `conversas.responder`, `status.alterar`, `status.configurar`, `tags.gerenciar`, `observacoes.ver`, `portal.liberar`, `portal.revogar`, `entrevistas.agendar`, `disponibilidade.configurar`, `automacoes.ver`, `automacoes.editar`, `automacoes.publicar`, `dashboard.ver`, `unidades.gerenciar`, `usuarios.gerenciar`, `auditoria.ver`, `sistema.ver`, `integracao.gerenciar`. Elas ficam em `packages/shared`, e o servidor confere em toda rota.
- **Rotas do portal** usam outro cookie e outro middleware. A sessão do candidato carrega só o `candidato_id` e a `liberacao_id`, e toda consulta do portal usa esse id da sessão, nunca um id enviado pelo navegador. Isso impede que um candidato veja o perfil de outro.
- **O que o portal nunca devolve:** tags, observações internas, status interno, nome do status, histórico administrativo, mensagens marcadas como internas, dados de outros candidatos. As respostas do portal são montadas por um "formatador do portal" próprio. Não se reaproveita a resposta da Central filtrando campos.

## 5. Eventos de domínio (a "cola" entre os módulos)

Toda mudança importante grava, **na mesma transação**, um registro em `eventos_dominio`: candidato cadastrado, mensagem recebida, status alterado, tag adicionada, entrevista agendada, confirmada ou cancelada, resposta SIM ou NÃO, acesso liberado ou expirado. Depois disso:

1. o tempo real avisa as telas abertas;
2. a linha do tempo do candidato é recalculada;
3. o motor de automações procura fluxos ativos com aquele gatilho;
4. a auditoria já foi gravada na transação.

Assim existe **um único status, um único histórico e uma única conversa**. Não há sistemas paralelos (seção 10 do prompt).

## 6. Portal temporário: como o código funciona

- **Formato:** 8 caracteres de um alfabeto sem caracteres confusos (sem 0/O, 1/I/L), gerados com `crypto.randomInt`. São cerca de 1 trilhão de combinações. Nunca usa telefone nem id.
- **Guardado só como hash:** `HMAC-SHA-256(código, chave do servidor)`. Como a tela pede **só o código** (sem telefone), o sistema precisa achar a liberação pelo próprio hash. O bcrypt não serve para isso, porque gera um hash diferente a cada vez. O HMAC com chave secreta resolve, e quem copiar o banco sem a chave não consegue testar códigos.
- **Uma liberação por vez:** gerar um código novo revoga o anterior do mesmo candidato. Cada liberação guarda quem gerou (pessoa ou automação), quando, a validade e como foi entregue.
- **Validade:** `expira_em` = 23:59:59.999 do dia da liberação no fuso `America/Sao_Paulo`. A conferência acontece **em toda requisição** do portal, então o acesso termina na hora certa mesmo que a rotina atrase. À 00:00 o Worker encerra as sessões ainda abertas, marca a liberação como expirada e gera o evento "Acesso expirado".
- **Proteção contra tentativa e erro:** limite por IP e um limite geral de códigos errados por minuto, com a mensagem única "Código inválido ou expirado" (não diz se o código existiu).
- **Mensagens e dados** continuam guardados depois da expiração. Só o acesso termina.

## 7. Integração com o WhatsApp

**Provedor:** WhatsApp Business Platform (Cloud API oficial da Meta). O número fica **"A definir"** e a tela Integração mostra "Não configurada" até ele existir.

**Dados de configuração** (cifrados, nunca voltam para a tela): número de telefone (Phone Number ID), conta business (WABA ID), token de acesso, App Secret (para conferir a assinatura do webhook) e token de verificação do webhook.

**Regras da Meta que mudam o desenho** (verificadas em 13/11/2026):

1. **Para iniciar uma conversa é obrigatório usar um modelo (template) aprovado pela Meta.** Mensagem livre só pode ser enviada dentro da "janela de atendimento" de 24 horas, que abre quando o candidato escreve. A mensagem "Sua entrevista foi agendada para…", o envio do código e o link do portal são enviados **antes** de o candidato responder. Por isso precisam ser modelos cadastrados e aprovados na Meta, com variáveis ([DATA], [HORÁRIO], código, link).
2. **Desde 1º/10/2026 as respostas dentro da janela de 24 horas também são cobradas** por mensagem entregue, depois de 1.000 mensagens livres por mês por número. Os modelos de utilidade também passaram a ser cobrados dentro da janela. O custo entra no Cronograma e custos (valores "A definir" até a contratação).

**Como fica no sistema:**

- Tela de **Modelos do WhatsApp**: lista os modelos da conta (nome, idioma, categoria, situação na Meta) e permite ligar cada variável a um dado do sistema. O card "Enviar mensagem pelo WhatsApp" escolhe um modelo quando a janela está fechada e só permite texto livre quando ela está aberta. O construtor avisa isso.
- **Webhook** `/api/webhooks/whatsapp`: confere a assinatura `X-Hub-Signature-256` com o App Secret; grava o evento bruto; descarta duplicadas pelo id da mensagem da Meta (`wamid`); processa de forma assíncrona e responde 200 rápido.
- **Fila de envio** no banco: novas tentativas com espera crescente e limite configurável; situação enviada / entregue / lida / falhou vinda do webhook de status.
- **Identificação do candidato** pela comparação do telefone (guardado cifrado, mais um hash do número normalizado em formato internacional para busca).
- **Número que não é de candidato** vai para a lista "Contatos não identificados" e não cria candidato sozinho.
- Toda mensagem que entra ou sai pelo WhatsApp é gravada na **mesma conversa** do candidato, marcada com o canal (WhatsApp / portal), o autor (candidato / gestora / chatbot / sistema) e, se veio de automação, a execução que a enviou.
- **Entender SIM/NÃO:** a resposta é normalizada (maiúsculas, acentos, espaços) e comparada com uma lista configurável (ex.: SIM, S; NÃO, NAO, N). Os botões de resposta rápida do modelo, quando usados, chegam como SIM/NÃO exatos. O que não se encaixa é tratado como "resposta ambígua" e o sistema pede esclarecimento.
- **Entender a data:** leitor de datas próprio, sem IA, para formatos como `20/11`, `20/11/2026`, `dia 20`, `quinta`, `quinta-feira`. A data só é aceita se estiver dentro do período e tiver vaga. Se a resposta for ambígua, o sistema pergunta de novo. Usar IA (Gemini) aqui é opcional (D5).
- **Ambiente de produção nunca simula** o WhatsApp. O modo de teste das automações usa um "provedor de teste" que só registra o que seria enviado.

## 8. Motor de automações

**Formato do fluxo:** JSON com `nós` (id, tipo do card, parâmetros, posição) e `ligações` (de nó/saída → para nó). Fica em `automacao_versoes`. **Versão publicada não muda mais**: editar cria um rascunho novo, e as execuções em andamento terminam na versão em que começaram.

**Validação antes de publicar** (a mesma no front e no servidor):

- exatamente um gatilho, no início, sem entrada;
- todo card configurado, com parâmetros válidos;
- cada saída ligada a um card compatível (ex.: a saída "Respondeu SIM/NÃO" só existe depois de um card que espera resposta);
- sem cards soltos e sem ciclos. O fluxo é um grafo dirigido acíclico; repetir é feito pelo card "Repetir tentativa", que tem limite obrigatório;
- mensagens só com modelo aprovado ou dentro da janela, e WhatsApp configurado.

**Execução:**

1. Um evento de domínio chega → o motor encontra os fluxos **ativos** com aquele gatilho e cria uma execução por candidato.
2. **Sem disparo duplicado:** a execução tem uma chave única (versão do fluxo + evento). O mesmo evento nunca cria duas execuções.
3. **Sem concorrência no mesmo candidato:** uma trava por (fluxo, candidato) garante que dois passos do mesmo fluxo não rodem ao mesmo tempo para a mesma pessoa.
4. **Cada passo é gravado** (início, fim, entrada, saída, erro, tentativas). Ações com efeito externo, como enviar mensagem, usam uma chave de idempotência, então o reprocessamento não envia de novo o que já foi enviado.
5. **Esperas** ("aguardar 2 dias", "aguardar resposta", "aguardar data") viram registros em `automacao_esperas`, retomados pelo Worker no horário certo ou quando o evento esperado chega. "Aguardar resposta" tem prazo e uma saída "Tempo esgotado".
6. **Proteção contra laço infinito:** além de o fluxo não poder ter ciclos, existe um limite de passos por execução e um limite de "profundidade": um evento criado por uma automação carrega a cadeia de origem, e a cadeia é interrompida acima do limite. Isso impede que um fluxo A dispare B e B dispare A sem fim.
7. **Erros:** o passo falha → novas tentativas conforme o card → se esgotar, a execução fica "Com erro", a automação passa a mostrar "Com erro" e a gestora é notificada. É possível **interromper** uma execução e **reprocessar** a partir do passo que falhou.
8. **Modo de teste:** roda o mesmo motor com dados simulados, digitados na hora e **não gravados como candidato**, e com provedores de teste (WhatsApp, chat, e-mail). Mostra passo a passo o que aconteceria, sem enviar nada e sem alterar dados reais.

**Regra de segurança:** nenhuma automação envia mensagem se não estiver **Ativa**, com a versão publicada válida e o WhatsApp configurado (seção 16 do prompt).

## 9. Segurança específica do aprovaRH (além do padrão)

- **Cadastro público:** limite por IP; campo-armadilha contra robôs; conferência do tipo real do arquivo pelo conteúdo, não só pela extensão; limites de tamanho configuráveis; nome do arquivo saneado; arquivos cifrados e com hash SHA-256; nenhum arquivo público por URL, apenas download autenticado e auditado.
- **Dados pessoais (LGPD):** telefone cifrado e mascarado nas listas onde não precisa aparecer inteiro; aviso de privacidade e consentimento no formulário (D9); prazo de guarda dos dados de candidatos "A definir" (D10), com rotina de exclusão definitiva quando for decidido; registro de toda visualização e download de currículo e foto.
- **Portal:** cookie próprio (HttpOnly, Secure, SameSite=Lax), ligado à liberação; encerrado na expiração ou na revogação; nenhuma rota interna aceita a sessão do portal, e vice-versa.
- **Webhook do WhatsApp:** assinatura obrigatória; sem assinatura válida, o pedido é recusado e auditado.

## 10. Auditoria

Usa a auditoria padrão (registro imutável, hash SHA-256 encadeado, exportação CSV) com estas ações próprias: candidatura recebida, dados alterados, currículo/foto visualizado ou baixado, status alterado, tag adicionada/removida, observação criada, mensagem enviada/recebida (registra o fato, não o texto), entrevista agendada/confirmada/remarcada/cancelada, código gerado, acesso liberado/revogado/expirado, entrada no portal (sucesso e falha), automação criada/editada/publicada/pausada, execução iniciada/concluída/com erro/interrompida/reprocessada, configuração do WhatsApp alterada. Ações do chatbot aparecem como "Automação: nome (execução nº)".
