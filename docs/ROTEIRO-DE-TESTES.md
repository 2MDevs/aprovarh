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
