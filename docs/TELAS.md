# aprovaRH: telas e fluxos

## 1. Mapa das telas

**Público (sem login)**
- `/candidatura` formulário de candidatura → mensagem de confirmação
- `/acesso` "Acesse sua candidatura" (código de acesso + Entrar)
- `/login` login interno (logo oficial da Hummm! Pizzas, nome aprovaRH)

**Portal do candidato** (só com liberação válida)
- `/portal`: à esquerda a **linha do tempo** (Candidatura enviada · Análise do currículo · Entrevista · Resultado, cada uma com Concluída / Em andamento / Aguardando / Não iniciada); no centro o **chat** com o RH, com cartões de entrevista (data, horário, confirmação) e envio de arquivo quando autorizado. No celular, a linha do tempo vira uma faixa recolhível acima do chat.

**Central de RH** (menu lateral)
1. **Visão geral**: indicadores do banco (total, novas, por unidade, aguardando entrevista, entrevistas agendadas, pré-aprovados, aprovados, reprovados, aguardando resposta, não lidas, automações com erro). Cada número leva à lista filtrada.
2. **Conversas**: as três áreas. Navegação | lista estilo WhatsApp Web (foto, nome, unidade, última mensagem, data/hora, tags, status, não lidas; busca e filtros por unidade, status, tags e período) | conversa (balões por autor; selo "Chatbot" e "WhatsApp"; notificações automáticas em linha discreta; arquivos; campo de digitação). Botão para abrir o **perfil lateral**: foto 3x4, nome, telefone, unidade, currículo (ver/baixar), data da candidatura, status, tags, linha do tempo (com ajuste manual), entrevistas, acessos ao portal (liberar código / revogar), histórico de movimentações e observações internas.
3. **Candidatos**: tabela com os mesmos filtros, para quem trabalha em lista e não em conversa.
4. **Processos seletivos**: quadro por status (colunas = status), com arrastar entre colunas que grava no mesmo histórico. *Conteúdo exato a confirmar (D11).*
5. **Entrevistas**: agenda por unidade (dia / semana), entrevistas por situação, e a aba **Disponibilidade** (períodos, dias, horários, vagas, responsável, bloqueios).
6. **Automações**: lista (nome, descrição, criador, última atualização, situação, execuções, última execução; editar, duplicar, pausar, ativar, ver histórico) → **construtor**.
7. **Configurações**: status, tags, textos padrão, modelos do WhatsApp, respostas aceitas como SIM/NÃO, limites de arquivos, aviso de privacidade.
8. Telas padrão: **Sistema**, **Integração** (com o card WhatsApp Business), **Auditoria**, **Dispositivos**, **Segurança da conta**, **Usuários e unidades**.

### WhatsApp nas telas (etapa 7B)

- **Integração › WhatsApp** (Desenvolvedor): escolha do provedor (Meta ou Evolution), situação e o que falta, endereço do webhook com botão copiar, dados do provedor, modelos aprovados da Meta (sincronizar e escolher), teste de conexão, respostas automáticas e tentativas de envio.
- **Conversa:** com o WhatsApp configurado, a gestora escolhe **Portal** ou **WhatsApp** acima da caixa de texto. Na Meta, mostra até quando a janela de 24 h está aberta e bloqueia o texto livre quando fechou. Arquivos continuam só pelo portal. Mensagens na fila mostram um relógio.
- **Liberar acesso ao portal:** opção "Enviar pelo WhatsApp" (ligada por padrão). Enviado assim, o código não aparece na tela.
- **Agendar/remarcar entrevista:** opção "Enviar pelo WhatsApp" (ligada por padrão), com a pergunta SIM ou NÃO.
- **Contatos não identificados:** ícone no topo da lista de Conversas, só para quem enxerga todas as unidades. Mostra nome do perfil, número, última mensagem; copiar número e arquivar.

### Visão geral (etapa 9A)

Primeira tela de quem tem `dashboard.ver`. Filtros de período (hoje, 7, 30 ou 90 dias) e de unidade.

- **Pede atenção:** Aguardando resposta, Mensagens não lidas, Automações com erro. Cada um destaca quando é maior que zero e leva à tela certa.
- **Indicadores:** total de candidatos, novas candidaturas no período, aguardando entrevista, entrevistas agendadas (daqui para frente), pré-aprovados, aprovados, reprovados, e as entrevistas por situação.
- **Gráficos:**
  - novas candidaturas por dia (dica ao passar o mouse; tabela para leitor de tela);
  - candidatos por unidade (total e em andamento);
  - candidatos por status.
- **Próximas entrevistas:** as 6 próximas, com link para a conversa.
- Os números se atualizam sozinhos (tempo real). Sem dados, aparece 0: nada é inventado.

## 2. Construtor de automações

```
┌──────────────┬─────────────────────────────────────────┬──────────────────┐
│ Biblioteca   │  Área de construção (zoom, mover,       │ Configurações    │
│ ▸ Gatilhos   │  minimapa, organizar)                   │ do card          │
│ ▸ Condições  │   [Gatilho]──▶[Ação]──▶[Condição]─SIM─▶ │ nome, descrição, │
│ ▸ Ações      │                         └──NÃO─▶[...]   │ parâmetros,      │
│ ▸ Tempo      │                                         │ entradas/saídas, │
│ busca        │  barra: Salvar rascunho · Testar ·      │ situação, erros  │
│              │  Publicar · versão · validação          │                  │
└──────────────┴─────────────────────────────────────────┴──────────────────┘
```

- Cores por categoria: Gatilho (amarelo), Condição (grafite), Ação (vermelho), Tempo (creme com borda). Ligações com seta no sentido da execução e rótulo nas saídas (SIM / NÃO / Tempo esgotado).
- Card com problema mostra um selo vermelho; o painel de validação lista tudo o que impede a publicação, e clicar no item leva ao card.
- **Testar** abre um painel para preencher dados simulados (unidade, resposta SIM/NÃO, data proposta…) e mostra o caminho percorrido, passo a passo, com "nada foi enviado".
- O **fluxo de referência** (Data da entrevista chegou → Gerar código → Enviar link e código → Confirmou presença? → ramos SIM/NÃO) vem como **modelo** para duplicar, nunca ativo.

### Construtor (etapa 8B)

- **Automações** (menu): cards com nome, descrição, situação, gatilho, execuções, última execução, quem criou e a última atualização.
  - Ações: Editar, Histórico, Duplicar, Pausar ou Ativar, Excluir.
  - Botões no topo: "Nova automação" e "Criar a partir do modelo".
- **Construtor** (`/automacoes/:id`, tela cheia), com as abas Fluxo, Execuções e Versões.
  - **Biblioteca:** busca e categorias com cor. Arraste o card ou clique nele. O gatilho fica bloqueado quando o fluxo já tem um.
  - **Área de construção:**
    - Mover a área: arrastar o fundo, ou a roda do mouse.
    - Zoom: Ctrl + roda, ou os botões.
    - Ver tudo, Organizar e minimapa.
    - Ligar: puxe a bolinha de uma saída até o próximo card. Ligações proibidas (para o gatilho, em volta, no próprio card) avisam e não acontecem.
  - **Configurações do card:** nome no fluxo, descrição, categoria, campos de cada card (com as variáveis para clicar), entradas e saídas, situação e erros. Botões Duplicar e Excluir.
  - **Validação:** botão "N problema(s)". Clicar num item leva ao card, e o card com erro mostra um selo vermelho.
  - **Barra:** Desfazer e Refazer (Ctrl+Z e Ctrl+Y), Salvar rascunho (Ctrl+S), Testar, Pausar ou Ativar, Publicar. Publicar fica bloqueado com erros e pede confirmação. Avisa ao sair sem salvar.
  - **Testar:** candidato simulado (unidade, status, tags, entrevista, acesso, janela da Meta, respostas em ordem). Mostra o caminho passo a passo e como o candidato terminaria, e destaca o caminho na área.
  - **Execuções:** filtro por situação, tabela e detalhe com a linha do tempo dos passos, a espera atual e o erro. Botões Reprocessar e Interromper, e link para a conversa.
  - **Versões:** lista das publicadas; ver uma versão (somente leitura) e "Usar como rascunho".
- **Perfil do candidato:** seção "Automações" com as execuções dele.
- **Celular:** a biblioteca e as configurações abrem por cima da área, e os botões mostram só o ícone.

## 3. Fluxos principais

**Candidato**
1. Abre o link público → preenche → envia → vê a confirmação. Não recebe acesso ao portal.
2. Recebe pelo WhatsApp (ou da gestora) o código e o link → entra no portal → vê a linha do tempo e conversa → o acesso acaba às 23h59min59s.
3. Recebe a mensagem da entrevista → responde SIM (confirmada) ou NÃO (recebe o período disponível → informa uma data → o sistema confere a vaga → confirma ou pede esclarecimento).

**Gestora**
1. Recebe a candidatura nova na lista (não lida) → abre o perfil → vê o currículo → muda status e tags → escreve observações.
2. Agenda a entrevista dentro da disponibilidade → o candidato recebe a mensagem (manual até a etapa 8, depois por automação).
3. Libera ou revoga o acesso ao portal quando precisar.
4. Monta automações, testa, publica e acompanha as execuções e os erros.

**Quando o chatbot confirma uma entrevista** (exemplo da seção 10 do prompt), tudo acontece em uma transação: entrevista "confirmada" → status atualizado → tag atualizada → etapa "Entrevista" atualizada na linha do tempo → mensagem gravada na conversa → notificação à gestora → passo gravado na execução → auditoria.
