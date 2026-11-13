# aprovaRH: decisões, conflitos e pendências

Situação: **D** = decidido · **P** = proposta aguardando aprovação · **A definir** = depende de informação que ainda não existe.

| # | Assunto | Situação | Detalhe |
|---|---|---|---|
| D1 | Plataforma própria × Gestão | **D** | O aprovaRH é uma plataforma própria, na infraestrutura padrão (Express + tsx + PostgreSQL). Depois a **ideia** será refeita dentro do Gestão (gestaomultiunidade), como aplicativo nativo. Observação: o Gestão usa outra tecnologia (Fastify, Prisma, Redis/BullMQ, argon2). Então a adaptação será uma reimplementação aproveitando regras, modelo e textos, não uma cópia de código. |
| D2 | Nome | **D** | aprovaRH. Repositório `2MDevs/aprovarh`. |
| D3 | Firebase (Estrutura-Painel.txt) × autenticação própria | **P** | Seguir só a infraestrutura padrão: autenticação própria com Node + PostgreSQL. **Firebase não será usado** sem autorização expressa. |
| D4 | Número e conta do WhatsApp | **A definir** | Número empresarial, conta Meta Business, aprovação dos modelos e custo por mensagem. Desde 1º/10/2026 a Meta cobra também as respostas dentro da janela de 24 h (após 1.000/mês por número). |
| D5 | Uso de IA para entender datas escritas | **P** | Começar com leitor de datas próprio, sem IA. Gemini como opção futura, ligada pela tela Integração. |
| D6 | Fluxo de referência: confirmação no próprio dia | **Dúvida** | O exemplo pede confirmação de presença quando "a data da entrevista chegou", e se a resposta for NÃO, oferece outra data. Faz sentido assim, ou a confirmação deve sair X dias antes? Isso não muda o motor, só o modelo de fluxo. |
| D7 | Perfil "Colaborador autorizado" | **Dúvida** | O que ele pode fazer? Proposta: o administrador marca as permissões dele (ex.: só ver e conversar). |
| D8 | Isolamento "por setor" (padrão) × "por unidade" (prompt) | **P** | O setor fica no cadastro do usuário (RH, TI, Diretoria), e o recorte dos dados de candidatos é por **unidade**. |
| D9 | Consentimento LGPD no formulário | **D** (etapa 3, aguardando o texto) | O prompt não lista o aceite do aviso de privacidade, mas a LGPD pede que o candidato seja informado de como os dados serão usados. Caixa obrigatória "Li e concordo com o aviso de privacidade", com o texto aberto em janela. O texto é publicado em Integração › Aviso de privacidade e cada candidatura guarda a versão aceita. **Enquanto o texto não for publicado, o formulário fica fechado.** Texto: A definir (RH/jurídico). |
| D10 | Prazo de guarda dos dados de candidatos | **A definir** | Por quanto tempo guardar currículo e foto de quem não foi aprovado? Até decidir, nada é apagado automaticamente. |
| D11 | Tela "Processos seletivos" | **Dúvida** | Ela é o quadro por status (proposta) ou existirão "vagas/processos" (ex.: "Atendente KM32, dezembro") com candidatos ligados a eles? Se forem vagas, entra uma tabela `processos` no modelo. |
| D12 | Cadastro repetido | **D** (Marcos, 13/11/2026) | **Controlado pelo CPF**: uma pessoa = um CPF = uma ficha. CPF incluído no formulário (obrigatório, validado). Mesmo CPF com processo em andamento: não cria outra ficha, registra o envio e os arquivos e avisa a gestora. Mesmo CPF com processo encerrado: reabre a ficha com o status inicial. **Um envio repetido nunca altera nome, telefone ou unidade da ficha** (quem souber o CPF de outra pessoa não consegue desviar o contato dela); as diferenças ficam registradas para a gestora. O candidato vê sempre a mesma mensagem. CPF guardado cifrado, com hash para a comparação. |
| D13 | Etapa "Resultado" para reprovados | **Dúvida** | O candidato vê "Resultado: Concluída" com uma mensagem neutra padrão, ou nada até a gestora escrever? Texto: A definir. |
| D14 | Mensagens da gestora também pelo WhatsApp | **Dúvida** | O chat interno é o canal da gestora. As mensagens dela ficam só no portal (o candidato vê quando tiver acesso), ou a gestora pode escolher "enviar também pelo WhatsApp"? Isso tem custo por mensagem. |
| D15 | Tipos e tamanhos de arquivo | **D** (proposta adotada) | Currículo: PDF, DOC ou DOCX, até 10 MB. Foto: JPG ou PNG, até 5 MB. Ajustáveis em Integração › Arquivos do candidato. Tipo conferido pelo conteúdo do arquivo. |
| D16 | Lista de unidades e responsáveis pelas entrevistas | **A definir** | Cadastradas na plataforma pela Diretoria; o prompt só cita KM32 como exemplo. |
| D17 | Domínio e servidor de produção | **A definir** | Endereço do aprovaRH e porta na VPS compartilhada. |
| D18 | Cronograma, custos e responsável pelos testes | **A definir** | Para o PDF de Cronograma e custos. |
| D19 | Onde fica o aviso de privacidade | **P** | Por enquanto na tela Integração (só Desenvolvedor). Na etapa 4, a tela Configurações da Central de RH pode receber essa edição, se o RH for o responsável pelo texto. |
| D20 | Linha do tempo × ajuste manual | **P** | A gestora pode ajustar uma etapa à mão; a próxima mudança de status recalcula todas as etapas a partir do status (o status é a fonte única). |
| D21 | Auditoria da foto | **P** | Abrir ou baixar currículo, foto e anexos fica na auditoria. A miniatura da foto na lista e no perfil não gera registro (senão cada rolagem da lista viraria dezenas de registros). Abrir o perfil do candidato gera registro. |
