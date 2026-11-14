# aprovaRH: integração com o WhatsApp

O aprovaRH fala com o WhatsApp por **um de dois provedores**, escolhido em Integração › WhatsApp (ou `WHATSAPP_PROVIDER` no `.env`):

| | **Meta (Cloud API oficial)** | **Evolution API** |
|---|---|---|
| O que é | API oficial do WhatsApp Business, da Meta | Servidor próprio que conecta um número ao **WhatsApp Web** (QR Code) |
| Oficial? | Sim | **Não**. O WhatsApp pode restringir ou banir o número (ver D27) |
| Iniciar conversa | Só com **modelo aprovado** pela Meta | Texto livre |
| Responder | Texto livre até 24 h depois da última mensagem do candidato | Texto livre |
| Custo | Por mensagem, cobrado pela Meta (inclusive dentro da janela de 24 h, desde 1º/10/2026) | Sem cobrança por mensagem; custo do servidor da Evolution |
| Número | A definir | A definir |

O resto do sistema é igual nos dois: fila de envio com novas tentativas, histórico na conversa única, situação de entrega (enviada, entregue, lida, falhou), respostas SIM/NÃO e datas da entrevista, contatos não identificados e auditoria.

## O que o aprovaRH envia

| Quando | Mensagem | Meta | Evolution |
|---|---|---|---|
| Gestora libera o acesso ao portal e marca "Enviar pelo WhatsApp" | Código do dia + link | Modelo `whatsapp.modelo_codigo` (`{{1}}` nome, `{{2}}` código, `{{3}}` link) | Texto `whatsapp.texto_codigo` (`{nome}`, `{codigo}`, `{link}`) |
| Gestora agenda ou remarca e marca "Enviar pelo WhatsApp" | "Olá! Sua entrevista foi agendada para o dia [DATA], às [HORÁRIO]. Você estaria disponível nessa data? Responda SIM ou NÃO." | Modelo `whatsapp.modelo_entrevista` (`{{1}}` data, `{{2}}` horário, botões SIM e NÃO) | Texto `whatsapp.texto_entrevista` (`{data}`, `{horario}`); o padrão já é o texto do prompt |
| Candidato responde SIM | "Perfeito! Sua entrevista está confirmada para ..." | Texto (janela aberta) | Texto |
| Candidato responde NÃO | "Sem problemas! Temos outras datas disponíveis... Entre os dias [INICIAL] e [FINAL], qual seria o melhor dia para você?" | Texto | Texto |
| Candidato informa uma data | Confere disponibilidade e vaga. Se valer: remarca, confirma e avisa. Se não: pede outra data ou o horário | Texto | Texto |
| Resposta confusa | Pede esclarecimento | Texto | Texto |
| Gestora escreve pelo WhatsApp (chat) | Texto da gestora | Só com a janela de 24 h aberta | Sempre |

**O código de acesso nunca fica guardado:** ele vai cifrado para a fila e é apagado assim que é enviado. Na conversa aparece mascarado (`••••-••••`).

**O chatbot não envia nada fora dessas regras.** As respostas automáticas só acontecem quando há uma entrevista esperando resposta e podem ser desligadas em Integração › WhatsApp.

## Configurar: Meta (Cloud API)

1. No [Meta for Developers](https://developers.facebook.com/), crie um app do tipo Business com o produto WhatsApp, ligado à conta do WhatsApp Business da empresa.
2. Cadastre o número da empresa (A definir) e anote o **Phone Number ID** e o **WABA ID**.
3. Crie um **usuário do sistema** no Business Manager, dê acesso ao app e gere um **token permanente** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
4. Anote o **App Secret** (Configurações do app › Básico).
5. Escolha um **token de verificação** (qualquer texto longo e aleatório).
6. Em Integração › WhatsApp: provedor `meta`, cole os dados acima e salve. Use "Testar conexão".
7. No painel da Meta, em WhatsApp › Configuração › Webhook:
   - URL: `https://ENDERECO_DO_APROVARH/api/webhooks/whatsapp`
   - Token de verificação: o mesmo do passo 5
   - Assine o campo **messages**
8. Crie e envie para aprovação os dois modelos (categoria **Utilidade**, idioma pt_BR). Depois use "Sincronizar modelos" e escolha cada um no formato `nome|pt_BR`.
   - Código de acesso: corpo com `{{1}}`, `{{2}}` e `{{3}}`.
   - Entrevista: corpo com `{{1}}` e `{{2}}` e dois botões de **resposta rápida**, "SIM" e "NÃO".

## Configurar: Evolution API

1. Tenha um servidor da Evolution API v2 publicado com **HTTPS** (A definir: na VPS ou em serviço contratado).
2. Crie uma instância e conecte o número lendo o QR Code no painel da Evolution.
3. Escolha um **token do webhook** (qualquer texto longo e aleatório).
4. Configure o webhook da instância:
   ```bash
   curl -X POST https://SERVIDOR_EVOLUTION/webhook/set/NOME_DA_INSTANCIA \
     -H "apikey: CHAVE_DA_EVOLUTION" -H "Content-Type: application/json" \
     -d '{
       "webhook": {
         "enabled": true,
         "url": "https://ENDERECO_DO_APROVARH/api/webhooks/evolution",
         "byEvents": false,
         "base64": false,
         "headers": { "x-aprovarh-token": "TOKEN_DO_WEBHOOK" },
         "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE"]
       }
     }'
   ```
5. Em Integração › WhatsApp: provedor `evolution`, endereço do servidor (https), nome da instância, apikey e o token do webhook. Use "Testar conexão": ele confere se a instância está **conectada** ao WhatsApp.
6. Se quiser, ajuste os textos do código de acesso e da entrevista.

## Segurança

- **Meta:** cada chamada do webhook tem a assinatura `X-Hub-Signature-256` conferida com o App Secret sobre o corpo bruto. Sem assinatura válida, a chamada é recusada e registrada na auditoria.
- **Evolution:** cada chamada precisa do cabeçalho `x-aprovarh-token` correto e da instância configurada. Senão, é recusada e registrada.
- **Credenciais:** tokens, App Secret e apikey ficam cifrados (AES-256-GCM) e nunca voltam para a tela.
- **Eventos recebidos:** ficam guardados cifrados, **sem duplicar** (pelo id da mensagem), e são processados pelo Worker. Se o processamento falhar, o evento é tentado de novo (até 5 vezes).
- **Número que não é de candidato:** vai para "Contatos não identificados" e não cria candidato sozinho.
- **Envio:** passa pela fila. Falhas temporárias (sem conexão, limite da Meta, erro do servidor) são tentadas de novo em 2, 4, 8, 16, 32 e 60 minutos, até o limite configurado. Falhas definitivas aparecem como "Falhou" na conversa.
- **Duplicidade:** a chave de idempotência impede que a mesma confirmação ou o mesmo código seja enviado duas vezes.

## Limitações conhecidas

- Imagens, áudios e documentos **recebidos** pelo WhatsApp aparecem como aviso na conversa ("[Imagem recebida pelo WhatsApp]"); o arquivo não é baixado nesta versão.
- O envio de arquivos pela gestora continua pelo chat do portal.
- Se o Worker cair exatamente durante um envio, a mensagem pode ser reenviada depois de 10 minutos (o caso mais raro; aceito para não perder mensagens).
