# aprovaRH: roteiro de testes

Marque cada item ao testar. Se algo não sair como esperado, registre: **o que você fez**, **o que esperava**, **o que aconteceu** e um **print da tela**.

## Etapa 2: base padrão

### Primeiro acesso
- [ ] Sem SMTP configurado, a tela de login mostra o aviso "Configuração inicial".
- [ ] O administrador inicial (`ADMIN_EMAIL`) entra sem código por e-mail e precisa trocar a senha.
- [ ] A senha nova recusa menos de 10 caracteres ou sem números.
- [ ] Cadastrar o desenvolvedor (e-mail de `DEVELOPER_EMAILS`): ele aparece com o perfil Desenvolvedor e setor TI.
- [ ] Um usuário comum não consegue entrar enquanto o SMTP não está configurado.

### E-mail e 2FA
- [ ] Integração pede a senha de novo; depois de 10 minutos, pede outra vez.
- [ ] Integração › E-mail (SMTP): salvar e "Enviar teste" chega na caixa de entrada.
- [ ] Depois do SMTP, entrar em outro navegador pede o código de 6 números por e-mail.
- [ ] "Reenviar código" só libera após 60 segundos.
- [ ] Código errado 5 vezes invalida o código.
- [ ] Depois do código, o mesmo navegador entra direto por 30 dias.
- [ ] 5 senhas erradas bloqueiam a conta por 15 minutos.
- [ ] "Esqueci minha senha" envia o link; o link só funciona uma vez.

### Sessão e bloqueio
- [ ] Ficar parado pelo tempo de bloqueio (padrão 10 min) mostra a tela bloqueada.
- [ ] Desbloquear com PIN (criado em Minha conta) e com senha.
- [ ] Errar o PIN o número máximo de vezes encerra a sessão.
- [ ] Minha conta › Sessões: "Encerrar" derruba a sessão de outro navegador.

### Administração
- [ ] Criar, editar, bloquear (a pessoa sai na hora), liberar e excluir usuário.
- [ ] Criar unidade, desativar e excluir.
- [ ] Editar as permissões da Gestora de RH; um perfil sem `Ver a tela Sistema` não abre /sistema nem pelo endereço.
- [ ] Dispositivos: revogar o dispositivo de alguém pede o código no próximo acesso dele.

### Auditoria e sistema
- [ ] Cada ação acima aparece na Auditoria com pessoa, IP e resultado.
- [ ] "Verificar integridade" informa a corrente íntegra.
- [ ] "Exportar CSV" abre no Excel com acentos corretos.
- [ ] Sistema mostra memória, disco e banco do aprovaRH e da VPS.
- [ ] API & Webhooks: criar chave (mostrada uma vez), testar com o `curl` do guia, revogar (para de funcionar).
- [ ] Atualização: "Verificar" mostra as melhorias; "Atualizar" aplica e o sistema volta sozinho.

### Celular, tema e PWA
- [ ] Telas funcionam no celular (menu em gaveta, modais subindo de baixo).
- [ ] Tema claro, escuro e do aparelho.
- [ ] "Instalar aplicativo" no Chrome/Android e "Adicionar à Tela de Início" no iPhone; o ícone não fica preto.

## Etapa 3: cadastro público do candidato

### Preparação
- [ ] Sem aviso de privacidade publicado, `/candidatura` mostra "temporariamente indisponível".
- [ ] Integração › Aviso de privacidade: publicar o texto aprovado pelo RH; o card passa para "Publicado".
- [ ] Usuários e unidades › Unidades: "Copiar" o link geral e o link de uma unidade (abre com a loja escolhida).

### Formulário
- [ ] Botão "Enviar" só libera com tudo preenchido e o aviso aceito.
- [ ] CPF inválido (ex.: 111.111.111-11) é recusado.
- [ ] Telefone sem DDD é recusado.
- [ ] Currículo em PDF, DOC e DOCX é aceito; outro tipo (ex.: .xlsx, ou um .txt renomeado para .pdf) é recusado.
- [ ] Foto JPG e PNG é aceita, com prévia; acima do limite de MB é recusada.
- [ ] Depois de enviar, aparece a mensagem de confirmação e **não** há acesso ao portal.
- [ ] Funciona no celular, inclusive tirando a foto pela câmera.

### Registro
- [ ] A gestora da unidade recebe no sino "Nova candidatura" com nome, código (C-000001) e unidade.
- [ ] Auditoria registra "candidatura.recebida" sem mostrar CPF nem telefone.
- [ ] Mesmo CPF de novo, com outro telefone: a mensagem para o candidato é a mesma, **não** cria outra ficha, e o sino avisa "Candidatura enviada de novo · atenção: telefone diferente do cadastro".
- [ ] Mais de 5 envios bem-sucedidos na mesma hora, da mesma conexão, são bloqueados.
- [ ] Na pasta `STORAGE_DIR/arquivos` os arquivos não abrem (estão cifrados).

## Etapa 4: Central de RH

### Conversas
- [ ] Menu mostra Conversas, Candidatos e Configurações para quem tem "Ver candidatos".
- [ ] Com a tela Conversas aberta em um computador, enviar uma candidatura pelo celular: ela aparece no topo da lista **sem recarregar**, com o indicador verde de não lida, e o sino conta +1.
- [ ] A lista mostra foto, nome, unidade, última mensagem, horário, status e tags.
- [ ] Buscar por nome, pelo código (C-000001), pelo CPF completo e pelo celular completo.
- [ ] Filtros por unidade, status, tag, período e "Só não lidas"; "Limpar filtros".
- [ ] Abrir a conversa zera o indicador de não lidas (só para você; outra pessoa da equipe continua vendo como não lida).
- [ ] Enviar mensagem (Enter envia, Shift+Enter quebra linha) e anexar PDF/JPG; com duas pessoas abertas na mesma conversa, a mensagem aparece para a outra na hora.
- [ ] O aviso "Candidatura recebida" aparece no centro da conversa com o ícone de "não aparece para o candidato".
- [ ] No celular: lista → conversa em tela cheia → seta para voltar.

### Perfil lateral
- [ ] Botão de informação abre o perfil (no celular por cima da conversa).
- [ ] "Ver currículo" abre o arquivo; baixar também. Os dois aparecem na Auditoria.
- [ ] CPF aparece mascarado; "mostrar" revela e fica na Auditoria (só para quem edita candidatos).
- [ ] Mudar o status pede confirmação, aceita motivo e aparece no Histórico com nome, data e horário.
- [ ] Mudar o status atualiza as "Etapas no portal do candidato".
- [ ] Adicionar e tirar tags; aparecem na lista e no Histórico.
- [ ] Observação interna: adicionar, ver o autor e excluir só as próprias.
- [ ] Candidato que se candidatou de novo com outro telefone mostra o aviso amarelo no perfil.
- [ ] "Corrigir dados": trocar telefone e unidade; uma gestora sem acesso à unidade nova deixa de ver o candidato.

### Configurações
- [ ] Criar status novo com cor, ordem e como aparece no portal; editar; excluir (recusado se houver candidato nele).
- [ ] Os 5 status iniciais podem ser renomeados, mas não excluídos.
- [ ] Criar, editar e excluir tags; excluir uma tag tira ela de todos os candidatos.
- [ ] Perfil sem "Criar e editar status e tags" vê as listas, mas sem os botões.

### Permissões e unidades
- [ ] Gestora com acesso só à unidade A não vê candidatos da unidade B nem pelo endereço direto (/conversas?c=...).
- [ ] Perfil sem "Ver e baixar currículo" não consegue abrir o currículo (nem pelo endereço).

## Etapa 5: portal temporário do candidato

### Liberação
- [ ] Perfil do candidato › Acesso ao portal mostra "Sem acesso liberado hoje".
- [ ] "Liberar acesso" gera um código no formato XXXX-XXXX, válido até 23h59 de hoje, com a mensagem pronta para copiar.
- [ ] Fechar o aviso: o código não aparece de novo em lugar nenhum (nem no banco: só o hash).
- [ ] "Gerar código novo": o código anterior para de funcionar e quem estava no portal sai.
- [ ] "Revogar": o candidato sai na hora; o código não volta a valer.

### Entrada
- [ ] `/acesso` mostra só "Acesse sua candidatura", o campo do código e "Entrar". Não há cadastro, senha ou "esqueci".
- [ ] Código errado, vencido ou revogado: sempre "Código inválido ou expirado."
- [ ] Digitar em minúsculas ou sem o traço também funciona.
- [ ] Mais de 10 tentativas em 15 minutos no mesmo aparelho são bloqueadas.
- [ ] `/portal` sem ter entrado mostra "Seu acesso terminou".

### Portal
- [ ] Não há lista de contatos: à esquerda (ou no topo, no celular) fica a linha do tempo com as 4 etapas.
- [ ] Mudar o status na Central atualiza as etapas no portal em até 10 segundos.
- [ ] O portal **não mostra** status interno, tags, observações, telefone completo, CPF nem nomes da equipe.
- [ ] Mensagem da gestora aparece no portal; a resposta do candidato aparece na Central na hora, como não lida.
- [ ] Na Central, a mensagem da gestora fica com o sinal de "lida" quando o candidato abre o portal.
- [ ] O aviso "Candidatura recebida" (do sistema) não aparece no portal.
- [ ] Clipe de anexo só aparece quando a liberação permitiu arquivos.

### Expiração
- [ ] Com o portal aberto, às 23h59min59s a tela muda para "Seu acesso terminou" (mesmo sem tocar em nada).
- [ ] Depois da meia-noite, o mesmo código é recusado e o perfil mostra o acesso como "expirou".
- [ ] As mensagens continuam guardadas e aparecem de novo com um código novo.
- [ ] Histórico de acesso no perfil mostra entradas, tentativas recusadas, dispositivo e IP.

## Etapa 6: agendamento de entrevistas

### Disponibilidade
- [ ] Entrevistas › Disponibilidade: escolher a unidade e criar um período (datas, dias da semana, horários, duração, vagas, responsável, local).
- [ ] Recusa data final antes da inicial, nenhum dia da semana ou nenhum horário.
- [ ] Bloquear um dia (ex.: feriado): ele some dos horários oferecidos.
- [ ] Excluir o período: os horários somem, mas entrevistas já marcadas continuam.

### Agendamento
- [ ] Perfil do candidato › Entrevista › "Agendar entrevista" mostra só dias e horários da disponibilidade, futuros e com vaga.
- [ ] Unidade sem período: aparece o aviso para cadastrar a disponibilidade.
- [ ] Agendar: o status muda para "Aguardando entrevista", com registro no histórico; a conversa ganha o aviso com data e horário.
- [ ] Com 1 vaga por horário, um segundo candidato não consegue o mesmo horário (aparece "lotado"; tentando ao mesmo tempo, um dos dois recebe "sem vaga").
- [ ] Um candidato não pode ter duas entrevistas em aberto.
- [ ] Remarcar: o horário antigo fica livre, o novo é conferido e o histórico mostra "Remarcada".
- [ ] Confirmar, Realizada, Não veio e Cancelar ficam no histórico com quem e quando.

### Agenda
- [ ] Entrevistas › Agenda mostra a semana, por dia, com horário, candidato, unidade, responsável e situação; semana anterior/próxima e "Hoje".
- [ ] Clicar abre a conversa do candidato.
- [ ] Filtro por unidade; gestora de uma unidade não vê entrevistas de outra.

### Portal
- [ ] O candidato vê o cartão "Sua entrevista" com data, horário, unidade e local, e "Aguardando sua confirmação" ou "Confirmada".
- [ ] Os avisos de agendamento, remarcação, confirmação e cancelamento aparecem no chat do portal.
