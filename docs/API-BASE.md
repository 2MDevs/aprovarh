# aprovaRH: rotas da base (etapa 2A)

Todas as respostas são JSON. Erros sempre vêm como `{ "erro": "mensagem simples", "codigo": "identificador" }`.
Pedidos que alteram dados, vindos do navegador, precisam ter a origem igual ao `APP_URL`.

| Código | Significado para a tela |
|---|---|
| `sem_sessao` (401) | Sessão terminou: voltar para o login |
| `sessao_bloqueada` (423) | Mostrar a tela de desbloqueio (PIN ou senha) |
| `trocar_senha` (403) | Levar para a troca de senha obrigatória |
| `reautenticar` (403) | Pedir a senha de novo (tela Integração) |
| `sem_permissao` (403) | Mostrar "Você não tem permissão" |

## Público
| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/health` | Banco no ar? (indicador "Conectado" e atualizador) |
| GET | `/api/publico/formulario` | Formulário de candidatura: aberto ou não, unidades ativas, aviso de privacidade (texto e versão), limites de arquivo |
| POST | `/api/publico/candidaturas` | `multipart/form-data`: nome, sobrenome, cpf, telefone, unidadeId, aceite, avisoVersao, curriculo, foto. Limite de 5 envios bem-sucedidos por hora por IP. Resposta sempre `{ok:true}` (não revela CPF repetido) |

## Acesso (`/api/auth`)
| Método | Rota | O que faz |
|---|---|---|
| POST | `/login` | `{email, senha}` → `{etapa:'ok'}` (dispositivo confiável ou modo de configuração) ou `{etapa:'2fa', desafio, emailMascarado, reenvioEmSegundos}` |
| POST | `/2fa/verificar` | `{desafio, codigo}` → abre a sessão e confia no dispositivo por 30 dias |
| POST | `/2fa/reenviar` | `{desafio}`, liberado após 60 s |
| GET | `/sessao` | Quem está logado, permissões, se a tela está bloqueada, se precisa trocar a senha, modo de configuração |
| POST | `/sair` | Encerra a sessão no banco |
| POST | `/bloquear` · `/desbloquear` | Bloqueio manual · `{pin}` ou `{senha}` (erros demais encerram a sessão) |
| POST | `/reautenticar` | `{senha}`: libera a tela Integração por 10 min |
| POST | `/trocar-senha` | `{atual, nova}`: encerra as outras sessões |
| POST | `/esqueci-senha` | `{email}`: resposta sempre igual (não revela quem tem conta) |
| POST | `/redefinir-senha` | `{token, senha}`: link de uso único, 60 min |

## Minha conta (`/api/conta`)
`PUT /pin` `{senha, pin}` · `DELETE /pin` · `GET /sessoes` · `DELETE /sessoes/:id` · `POST /sessoes/encerrar-outras`

## Administração
| Área | Rotas | Permissão |
|---|---|---|
| Usuários | `GET/POST /api/usuarios`, `PUT/DELETE /api/usuarios/:id`, `POST /:id/bloquear`, `/:id/desbloquear`, `/:id/enviar-redefinicao` | `usuarios.gerenciar` |
| Perfis | `GET /api/perfis` (usuarios.gerenciar), `POST`, `PUT /:id`, `DELETE /:id` | `perfis.gerenciar` |
| Unidades | `GET /api/unidades` (as unidades que a pessoa enxerga; aceita chave de API com escopo `unidades.ler`), `POST`, `PUT /:id`, `DELETE /:id` | `unidades.gerenciar` |
| Dispositivos | `GET /api/dispositivos`, `POST /:id/aprovar · bloquear · revogar`, `DELETE /:id` | os próprios; todos com `dispositivos.gerenciar` |
| Auditoria | `GET /api/auditoria` (filtros: de, ate, usuarioId, setor, acao, resultado, busca, pagina), `GET /exportar.csv`, `GET /verificar`, `GET /opcoes` | `auditoria.ver` |
| Notificações | `GET /api/notificacoes`, `GET /contagem`, `POST /lidas` | qualquer pessoa logada (só as suas) |

## Sistema (`/api/sistema`, permissão `sistema.ver`)
`GET /recursos` (projeto × servidor) · `GET /servidor` · `GET /artefatos` · `GET /artefatos/:arquivo` (`?baixar=1` para baixar; auditado)

**API & Webhooks** (`/api/sistema/api`, mais `api.gerenciar`): `GET /escopos` · `GET/POST /chaves` · `POST /chaves/:id/revogar` · `GET/POST /webhooks` · `PUT/DELETE /webhooks/:id` · `POST /webhooks/:id/testar`

## Integração (`/api/integracao`, só Desenvolvedor, senha reconfirmada a cada 10 min)
`GET /cards` · `GET/PUT /config/smtp` · `GET/PUT /config/seguranca` · `GET/PUT /config/arquivos` · `GET/PUT /config/privacidade` · `POST /smtp/teste` `{para}` · `GET /env` · `GET /admin` · `POST /admin/enviar-redefinicao`

## Atualização (`/api/atualizacao`)
`GET /aviso` (todos: há versão nova?) · só Desenvolvedor: `GET /status` · `POST /verificar` · `POST /atualizar` `{senha}`

## Como conectar outro sistema (chave de API)
```bash
curl -H "Authorization: Bearer aprh_live_SUA_CHAVE" https://ENDERECO_DO_APROVARH/api/unidades
```

## Central de RH (etapa 4A)

Todas exigem `candidatos.ver` e respeitam as unidades da pessoa: candidato de outra unidade responde "não encontrado".

| Método | Rota | O que faz | Permissão extra |
|---|---|---|---|
| GET | `/api/central/candidatos` | Lista estilo WhatsApp Web. Filtros: `busca` (nome, código; CPF ou telefone completos são comparados pelo hash), `unidadeId`, `statusId`, `tagId`, `de`, `ate`, `naoLidas=1`, `pagina` | |
| GET | `/api/central/candidatos/:id` | Perfil lateral: dados, telefone, CPF mascarado, status, tags, linha do tempo, histórico de status, tags e candidaturas, arquivos e observações (auditado) | observações: `observacoes.ver` |
| POST | `/api/central/candidatos/:id/cpf` | Mostra o CPF completo (auditado) | `candidatos.editar` |
| GET | `/api/central/candidatos/:id/arquivos/:arquivoId` | Abre (`?baixar=1` baixa) currículo, foto ou anexo; confere o SHA-256; auditado. `?miniatura=1` (só foto) não gera registro | currículo/anexo: `candidatos.curriculo.baixar` |
| PUT | `/api/central/candidatos/:id` | Corrige nome, sobrenome, telefone e unidade | `candidatos.editar` |
| POST | `/api/central/candidatos/:id/status` | `{statusId, motivo?}`: grava o histórico (anterior, novo, quem, quando) e recalcula a linha do tempo | `status.alterar` |
| POST | `/api/central/candidatos/:id/tags/adicionar` · `/tags/remover` | `{tagId}` com histórico | `status.alterar` |
| PUT | `/api/central/candidatos/:id/etapas/:etapa` | Ajuste manual da linha do tempo (vale até a próxima mudança de status) | `status.alterar` |
| POST / DELETE | `/api/central/candidatos/:id/observacoes[/:obsId]` | Observação interna (cifrada; cada pessoa exclui só as suas) | `observacoes.ver` |
| GET | `/api/central/candidatos/:id/mensagens?antes=&limite=` | Mensagens da conversa única, em páginas | |
| POST | `/api/central/candidatos/:id/mensagens` | `{texto}`: mensagem da gestora no chat interno | `conversas.responder` |
| POST | `/api/central/candidatos/:id/mensagens/arquivo` | multipart `arquivo` (+ `legenda`): PDF, DOC, DOCX, JPG ou PNG | `conversas.responder` |
| POST | `/api/central/candidatos/:id/lida` | Marca a conversa como lida (não lidas são por pessoa) | |
| GET | `/api/central/config/status` · `/tags` | Status e tags disponíveis | |
| POST / PUT / DELETE | `/api/central/config/status[/:id]` · `/tags[/:id]` | Criar, editar e excluir. Os 5 status iniciais não são excluídos | `status.configurar` |
| GET | `/api/eventos` | Tempo real (Server-Sent Events): `mensagem.nova`, `candidato.atualizado`, `candidatura.nova`, `conversa.lida`. Só ids; os dados vêm das rotas acima | |

> **Nginx:** para o tempo real, a rota `/api/eventos` não pode ficar presa no buffer. O servidor já envia `X-Accel-Buffering: no`; se o Nginx tiver `proxy_read_timeout` baixo, use pelo menos `75s`.

## Portal do candidato (etapa 5)

Sessão própria (cookie `arh_portal`), separada da área interna. Toda rota usa o candidato da sessão; nenhuma aceita id de candidato vindo do navegador.

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/portal/entrar` | `{codigo}` (ex.: `ABCD-EF23`). Resposta de erro sempre "Código inválido ou expirado." Limite de 10 tentativas por IP a cada 15 min e trava geral se houver mais de 300 falhas em 10 min |
| GET | `/api/portal/sessao` | Primeiro nome, validade (23:59:59 de Brasília), se pode enviar arquivo e as 4 etapas |
| GET | `/api/portal/mensagens` | Só as mensagens visíveis ao candidato; marca as da equipe como lidas |
| POST | `/api/portal/mensagens` · `/mensagens/arquivo` | Mensagem do candidato (arquivo só se a liberação permitir) |
| GET | `/api/portal/arquivos/:id` | Arquivo da própria conversa |
| POST | `/api/portal/sair` | Encerra a sessão |

**Central:** `POST /api/central/candidatos/:id/acesso` `{permiteArquivo}` gera o código do dia (mostrado uma única vez) · `POST /api/central/candidatos/:id/acesso/revogar` (permissão `portal.liberar`). O perfil traz `portal.ativo`, `portal.liberacoes` e `portal.acessos`.

## Entrevistas (etapa 6)

Todas exigem `candidatos.ver` e respeitam as unidades da pessoa.

| Método | Rota | O que faz | Permissão extra |
|---|---|---|---|
| GET | `/api/entrevistas/disponibilidades?unidadeId=` | Períodos (datas, dias da semana, horários, duração, vagas, responsável, local) | |
| POST / PUT / DELETE | `/api/entrevistas/disponibilidades[/:id]` | Cadastrar, editar e excluir período (entrevistas já marcadas continuam valendo) | `disponibilidade.configurar` |
| GET / POST / DELETE | `/api/entrevistas/bloqueios[/:id]` | Dias sem entrevista (feriado, folga) | `disponibilidade.configurar` |
| GET | `/api/entrevistas/responsaveis` | Pessoas que podem ser responsáveis | |
| GET | `/api/entrevistas/horarios?unidadeId=&de=&ate=` | Horários futuros com vagas livres (padrão: 60 dias; máximo 120) | |
| GET | `/api/entrevistas?de=&ate=&unidadeId=&situacao=` | Agenda | |
| GET | `/api/entrevistas/candidato/:id` | Entrevistas do candidato, com os eventos | |
| POST | `/api/entrevistas/candidato/:id` | `{inicioEm}`: agenda (confere disponibilidade e vaga com trava por unidade) | `entrevistas.agendar` |
| POST | `/api/entrevistas/:id/confirmar` · `/cancelar` · `/realizada` · `/nao-compareceu` | `{motivo?}` | `entrevistas.agendar` |
| POST | `/api/entrevistas/:id/remarcar` | `{inicioEm, motivo?}` | `entrevistas.agendar` |

O portal (`GET /api/portal/sessao`) passa a mandar `entrevista`: data, horário, duração, unidade, local e se está confirmada.

## WhatsApp (etapa 7A) — detalhes em [WHATSAPP.md](WHATSAPP.md)

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/webhooks/whatsapp` | Meta: verificação do webhook (`hub.verify_token`) |
| POST | `/api/webhooks/whatsapp` | Meta: mensagens e situação de entrega (assinatura `X-Hub-Signature-256`) |
| POST | `/api/webhooks/evolution` (ou `/evolution/:evento`) | Evolution: `messages.upsert` e `messages.update` (cabeçalho `x-aprovarh-token`) |
| GET | `/api/integracao/whatsapp/situacao` | Provedor, configurado, o que falta, endereço do webhook, fila e eventos (Desenvolvedor) |
| POST | `/api/integracao/whatsapp/testar` | Teste de conexão (Meta: dados do número; Evolution: instância conectada) |
| POST / GET | `/api/integracao/whatsapp/modelos[/sincronizar]` | Modelos da conta Meta |
| GET | `/api/central/whatsapp/candidatos/:id` | Configurado? Janela aberta? Pode escrever texto livre? |
| POST | `/api/central/whatsapp/candidatos/:id/mensagens` | `{texto}` pela fila (`conversas.responder`) |
| GET | `/api/central/whatsapp/nao-identificados` · POST `/:id/arquivar` | Números que escreveram e não são de candidatos |

Opções novas: `POST /api/central/candidatos/:id/acesso` aceita `enviarWhatsapp`; `POST /api/entrevistas/candidato/:id` e `/api/entrevistas/:id/remarcar` aceitam `enviarWhatsapp`.
