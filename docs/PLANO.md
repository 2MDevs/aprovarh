# aprovaRH: plano de desenvolvimento por etapas

Plataforma de recrutamento da Hummm! Pizzas, desenvolvida por **Marcos Monteiro (TI - Tecnologia da Informação da Hummm! Pizzas)**.
Repositório: `2MDevs/aprovarh`.

O aprovaRH é uma plataforma própria, que segue a **infraestrutura padrão** da Hummm! Pizzas (o modelo é o DocSecure). Mais tarde a ideia será refeita dentro do Gestão (gestaomultiunidade) como aplicativo nativo, do mesmo jeito que o DocSecure virou o aplicativo "Documentos". Por isso o aprovaRH não copia a tecnologia do Gestão. Ele só mantém os conceitos com nomes parecidos (unidade, perfil, permissão) para facilitar essa adaptação depois. Veja a decisão D1 em [DECISOES.md](DECISOES.md).

## Regras que valem para todas as etapas

- Uma etapa por vez. Cada etapa vira uma branch e um Pull Request próprio, e só começa depois do merge da anterior.
- Cada etapa termina com algo testável de verdade, sem telas de mentira, dados fictícios ou botões sem função.
- Toda etapa atualiza o README, o `.env.example`, a auditoria e o roteiro de testes do que entrou.
- O que depende de decisão futura fica "A definir" (lista em [DECISOES.md](DECISOES.md)).

## Etapas

| # | Etapa | Entrega | Critério de conclusão |
|---|---|---|---|
| 1 | **Planejamento e arquitetura** (este PR) | [ARQUITETURA.md](ARQUITETURA.md), [MODELO-DE-DADOS.md](MODELO-DE-DADOS.md), [TELAS.md](TELAS.md), [DECISOES.md](DECISOES.md) e este plano | Marcos aprova o plano e responde as dúvidas abertas |
| 2 | **Base padrão**, em duas partes: **2A** servidor e banco · **2B** telas | Projeto React + Vite + Tailwind / Express + tsx / PostgreSQL com migrations; login, 2FA por e-mail, dispositivos confiáveis, sessão e bloqueio por PIN; perfis e permissões no servidor; auditoria encadeada com SHA-256; AES-256-GCM; telas Sistema, Integração (cards), Auditoria, Dispositivos e Segurança da conta; botão "Atualizar sistema"; PWA; tema claro e escuro; cadastro de **unidades** e de **usuários internos** com acesso por unidade | Marcos entra como desenvolvedor, configura o SMTP, cadastra unidades e usuários e atualiza o sistema pelo GitHub |
| 3 | **Cadastro público do candidato** | Link público com formulário (nome, sobrenome, telefone com DDD, unidade, currículo, foto 3x4); validação de campos e de arquivos; arquivos cifrados; criação do perfil, da conversa única, do status inicial e da etapa "Candidatura enviada"; mensagem de confirmação; proteção contra abuso | Marcos envia uma candidatura real pelo link e confere o registro e a auditoria |
| 4 | **Central de RH** | Layout em três áreas (navegação, lista estilo WhatsApp Web, conversa) + perfil lateral; chat em tempo real; não lidas; tags e status personalizáveis com histórico; observações internas; visualizar e baixar currículo (com auditoria); pesquisa e filtros por unidade, status, tag e período | A gestora atende, troca status e tags, e cada mudança aparece no histórico e na auditoria |
| 5 | **Portal temporário do candidato** | Geração de código (só hash no banco), liberação manual pela gestora, tela "Acesse sua candidatura", sessão do candidato, linha do tempo das 4 etapas, chat com o mesmo histórico da gestora, envio de arquivo quando autorizado, expiração às 23h59min59s (Brasília) com encerramento das sessões, revogação | Marcos libera um código, entra no portal, conversa, revoga, e confere a expiração na virada do dia |
| 6 | **Agendamento de entrevistas** | Períodos de disponibilidade por unidade (datas, dias, horários, vagas por horário, responsável), bloqueio de datas, agendamento pela gestora, histórico de entrevistas, impedimento de horário indisponível | A gestora configura uma unidade, agenda e o sistema recusa horários fora da disponibilidade |
| 7 | **Integração WhatsApp (API oficial)** | Card "WhatsApp Business" na tela Integração; envio de texto e de modelos (templates) aprovados; webhook com assinatura conferida; descarte de duplicadas; fila com novas tentativas; situação de entrega; respostas SIM/NÃO e de datas ligadas à entrevista; contatos não identificados. Fica como **"Não configurada"** até existir o número | Sem número: a tela mostra o que falta configurar. Com número: teste real autorizado por Marcos |
| 8 | **Motor e construtor de automações** | Motor no servidor (eventos, execuções, esperas, ramificações, novas tentativas, travas contra duplicidade, laço infinito e concorrência); construtor visual (biblioteca, área com zoom, configurações do card, validação, rascunho, versões, publicação); modo de teste sem envio real; tela de gestão e histórico de execuções; fluxo de referência montado como modelo | A gestora monta o fluxo de referência, testa em simulação e publica |
| 9 | **Visão geral e entregas finais** | Dashboard com indicadores do banco; Documentação e Cronograma e Custos em PDF; manual rápido; roteiro de testes completo; README final; checklist final do prompt | Todos os itens do checklist conferidos |

## Por que essa ordem

- **A base vem antes de tudo** (etapa 2), porque a segurança não pode ser encaixada depois.
- **Cadastro → Central → Portal** (3, 4, 5) segue o caminho real do candidato, e cada etapa usa o que a anterior criou.
- **Agendamento antes do WhatsApp** (6, 7): as respostas SIM/NÃO e as datas que chegam pelo WhatsApp precisam de entrevistas e disponibilidades já existentes.
- **Automações por último** (8): cada card do construtor chama uma função que já existe e já foi testada. Assim nenhum card fica "de enfeite". Até a etapa 8, as ações (liberar código, enviar mensagem, agendar) são feitas manualmente pela gestora, pelos mesmos serviços que o motor vai usar depois.

## Depois do aprovaRH

Quando a plataforma estiver estável, levar a ideia para o Gestão como aplicativo nativo. Nesse momento: unidades e pessoas passam a vir do cadastro do Gestão, o login vem do Gestão, e as regras de negócio descritas aqui são reimplementadas na tecnologia de lá. O que deve ser aproveitado: este planejamento, o modelo de dados (conceitos), as regras do portal temporário, o formato dos fluxos de automação (JSON) e os textos das telas.
