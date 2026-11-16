# aprovaRH: automações

As automações são fluxos de cards montados pela gestora. Eles ficam guardados no PostgreSQL (JSON) e são interpretados por um motor no servidor (Worker). Nenhuma automação é escrita direto no código.

- **Catálogo de cards e validação:** `shared/automacoes.ts`. A tela e o servidor usam o mesmo arquivo.
- **O que cada card faz:** `server/modules/automacoes/cards.ts`. Não fala com o banco; passa pelos "efeitos".
- **Efeitos reais:** `efeitos.ts`. Usam os mesmos serviços das telas: status, tags, portal, entrevistas e WhatsApp.
- **Motor:** `motor.ts`. Cuida de eventos, esperas, passos, novas tentativas e gatilhos agendados.
- **API:** `routes.ts`. Veja [API-BASE.md](API-BASE.md).
- **Testes sem banco:** `npm run test:automacoes`.

## Cards

| Categoria | Cards |
|---|---|
| **Gatilhos** | Novo candidato cadastrado · Nova mensagem recebida · Candidato respondeu SIM · Candidato respondeu NÃO · Data da entrevista chegou · Data programada chegou · Horário programado chegou · Status alterado · Tag adicionada · Entrevista agendada · Entrevista cancelada · Acesso temporário liberado · Acesso expirado |
| **Condições** | Se / Então · Verificar resposta SIM ou NÃO (saídas SIM, NÃO e "Não entendi") · Verificar unidade · Verificar status · Verificar tag · Verificar data · Verificar disponibilidade · Verificar se o código está válido · Verificar se a entrevista foi confirmada |
| **Ações** | Enviar mensagem pelo WhatsApp · Enviar mensagem pelo chat interno · Gerar código de acesso · Enviar link de acesso · Liberar acesso (os dois juntos) · Revogar acesso · Alterar status · Adicionar tag · Remover tag · Consultar disponibilidade · Agendar entrevista · Pedir confirmação da entrevista · Atualizar entrevista (confirmar, pediu outra data, cancelar, realizada, falta) · Registrar resposta · Notificar gestora |
| **Tempo** | Aguardar um período · Aguardar uma data · Aguardar horário · Aguardar resposta (saídas Respondeu e Tempo esgotado) · Executar em determinado dia · Expirar autorização · Repetir tentativa |

"Atualizar etapa do candidato" não é um card separado. A etapa da linha do tempo acompanha o status (decisão D31), então o card **Alterar status** já atualiza a etapa.

**Variáveis nos textos:** `{nome}`, `{unidade}`, `{data_entrevista}`, `{horario_entrevista}`, `{periodo_inicio}`, `{periodo_fim}` e `{link}`. O código de acesso nunca entra num texto livre: ele só vai pelo card "Enviar link de acesso".

## Validação antes de publicar

A tela e o servidor conferem as mesmas regras:
- O fluxo tem exatamente um gatilho, e nada liga para ele.
- Não há card solto: todo card é alcançado a partir do gatilho.
- Não há ciclo. Para repetir, use o card "Repetir tentativa", que só volta para um card anterior e tem limite de 1 a 10.
- Cada saída liga em um card só, e as saídas existem no card.
- Os campos obrigatórios estão preenchidos e dentro dos limites. Status, tags e unidades escolhidos existem.
- **Dados que dependem de outro card**, em todos os caminhos até ele:
  - "Verificar SIM/NÃO" precisa de uma resposta antes.
  - "Enviar link" precisa de "Gerar código" antes.
  - "Agendar" precisa de "Verificar disponibilidade" (saída SIM) antes.
  - `{periodo_*}` precisa de "Consultar disponibilidade" antes.
  - `{data_entrevista}` precisa de uma entrevista antes.
- Os cards que enviam pelo WhatsApp precisam do WhatsApp configurado.
- **Avisos**, que não impedem a publicação:
  - texto livre na Meta (só sai com a janela de 24 h aberta);
  - saída de condição sem continuação (o fluxo termina ali).

## Como o motor roda

1. Um fato acontece (candidatura, mensagem, status, tag, entrevista, acesso) e vira um **evento de domínio**.
2. O Worker lê o evento e procura as automações **Ativas** (ou "Com erro") cujo gatilho aceita esse evento, dentro das unidades da automação.
3. Para cada uma, cria uma **execução**:
   - **Sem duplicar:** a chave é a versão mais o evento.
   - **Sem concorrência:** só uma execução ativa por automação e candidato. Se o candidato já tem uma em andamento, o novo evento não abre outra (D32).
4. A execução roda **um card por transação**: o card e o registro do passo entram juntos, ou nada entra.
5. **Esperas** viram registros:
   - "Aguardar..." continua no horário marcado.
   - "Aguardar resposta" continua quando o candidato escreve, ou por "Tempo esgotado".
6. **Erro no passo:**
   - Erro temporário: novas tentativas em 2, 4 e 8 min.
   - Erro de regra (ex.: "o candidato não tem entrevista") ou fim das tentativas: a execução fica **Com erro**, a automação também, e a gestora recebe um aviso.
   - Dá para **reprocessar** a partir do passo que falhou ou **interromper**.
7. **Proteções:**
   - Limite de 100 passos por execução.
   - Uma automação não se dispara a partir dela mesma.
   - Uma cadeia de automações (A dispara B, que dispara C) para no 3º nível.
   - Automação pausada não anda.
   - Nada é enviado se a automação não estiver ativa, publicada e válida.
8. **Versões:** publicar cria uma versão que nunca muda. Editar mexe só no rascunho, e as execuções em andamento terminam na versão em que começaram.

**Gatilhos agendados.** O Worker confere a cada minuto. Cada disparo tem uma chave única e nunca se repete.
- **Data da entrevista chegou:** no dia da entrevista, menos os dias escolhidos, a partir do horário do card. Vale só para entrevistas ainda por acontecer.
- **Data programada:** uma vez, até 24 h depois do horário, para os candidatos nos status escolhidos.
- **Horário programado:** nos dias escolhidos, até 2 h depois do horário. Assim, ativar à tarde não dispara o horário da manhã.

**Respostas automáticas da etapa 7.** Enquanto um fluxo com "Aguardar resposta" está ativo para o candidato, as respostas automáticas da entrevista ficam caladas. Assim o candidato não recebe duas respostas diferentes (D30).

## Modo de teste

**Testar** roda o mesmo código do motor com um candidato simulado: você informa unidade, status, tags, entrevista, respostas e se a janela da Meta está aberta. Nada é enviado nem gravado. A única coisa lida de verdade são os horários livres da unidade, sem alterar nada.

O resultado mostra o caminho percorrido, passo a passo, e como o candidato terminaria (status, tags, entrevista, acesso). As esperas seguem direto, e "Aguardar resposta" usa a próxima resposta simulada, ou "Tempo esgotado" se acabarem.

## Fluxo de referência (modelo)

O botão "Criar a partir do modelo" monta um rascunho com o exemplo da seção 9.4:

> Data da entrevista chegou → Gerar código → Enviar link e código → Perguntar se confirma presença → Aguardar resposta (4 h) → Confirmou?
> - **SIM:** Confirmar entrevista → Atualizar status → Atualizar tag → Notificar gestora
> - **NÃO:** Marcar "pediu outra data" → Consultar datas da unidade → Solicitar outra data → Aguardar resposta (24 h) → Validar a data → Verificar disponibilidade → Atualizar agendamento → Gerar nova confirmação → Notificar gestora
> - **Data inválida ou sem vaga:** pede outra data, até 2 vezes, e depois chama a equipe
> - **Resposta confusa, sem resposta, sem datas:** notifica a gestora

O modelo nunca nasce ativo. Status e tag ficam em branco de propósito: a validação aponta, e a gestora escolhe antes de publicar. O horário (08:00) e o "dia da entrevista" podem ser trocados. A pergunta D6 continua em aberto: confirmar no próprio dia ou X dias antes.
