# aprovaRH: checklist final (seção 18 do prompt)

Conferido em 16/11/2026, versão 0.14.0. Legenda:

- **✅ Feito:** está no código e foi testado aqui (banco real, testes automáticos ou Chrome com a API simulada).
- **🟡 Feito, falta configurar:** o código está pronto, mas depende de algo que ainda não foi definido.

Nada foi validado ainda no servidor de produção. Isso é a fase 3 (testes) do Cronograma.

| Item | Situação | Onde está / observação |
|---|---|---|
| Cadastro público funcionando | ✅ | `/candidatura` (etapa 3). Precisa do aviso de privacidade publicado em Integração. |
| Upload de currículo e fotografia | ✅ | PDF, DOC ou DOCX e JPG ou PNG. Tipo conferido pelo conteúdo e arquivos cifrados. |
| Criação automática do perfil | ✅ | Ficha, conversa, status inicial e linha do tempo. Cadastro repetido monitorado pelo **CPF**. |
| Central de RH funcionando | ✅ | Visão geral, Conversas, Candidatos, Entrevistas, Automações, Configurações. |
| Chat em tempo real | ✅ | Server-Sent Events + LISTEN/NOTIFY do PostgreSQL (etapa 4). |
| Tags e status personalizáveis | ✅ | Configurações › Status e Tags. Os 5 status iniciais não são excluídos. |
| Portal temporário funcionando | ✅ | `/acesso` e `/portal` (etapa 5). |
| Código de acesso renovável | ✅ | "Gerar código novo" cancela o anterior. Código guardado só como HMAC. |
| Expiração diária funcionando | ✅ | 23h59min59s em Brasília (fuso IANA). Conferido em cada requisição e na rotina do Worker. |
| Encerramento das sessões expiradas | ✅ | O Worker marca a liberação como expirada e encerra as sessões do portal. |
| Etapas do candidato sincronizadas | ✅ | A linha do tempo segue o status (com ajuste manual), na tela, no portal e nas automações. |
| Integração WhatsApp funcionando | 🟡 | Meta oficial ou Evolution API (etapa 7). **Falta o número e a escolha do provedor (D4).** |
| Agendamento de entrevistas | ✅ | Disponibilidade, vagas e trava contra duas pessoas no mesmo horário (etapa 6). |
| Tratamento de respostas SIM e NÃO | ✅ | Respostas automáticas (etapa 7) e cards de automação. Nunca confirma data indisponível. |
| Construtor visual com arrastar e soltar | ✅ | Etapa 8B. Testado no Chrome com o mouse. |
| Conexões entre cards funcionando | ✅ | Ligações proibidas recusadas com aviso (gatilho, voltas, no próprio card). |
| Condições e ramificações funcionando | ✅ | 19 testes automáticos (`npm run test:automacoes`), incluindo os ramos SIM e NÃO do modelo. |
| Motor de automações funcionando | ✅ | Etapa 8A: eventos, esperas, novas tentativas, sem duplicar, proteção contra laço. |
| Histórico de execuções | ✅ | Aba Execuções, com passos, espera, erro, Interromper e Reprocessar. |
| Auditoria | ✅ | Todas as ações da seção 13, com hash SHA-256 encadeado. Nesta etapa entrou "execução concluída". |
| Permissões no servidor | ✅ | Toda rota confere a permissão (`exigirPermissao`). Esconder o botão não é a proteção. |
| Isolamento de dados | ✅ | Escopo por unidade em listas, perfil, visão geral, automações e contatos não identificados. |
| LGPD | 🟡 | Aviso de privacidade e consentimento, dados cifrados e mascarados, auditoria de visualização e download. **Prazo de guarda dos dados: A definir (D10).** |
| Tema claro e escuro | ✅ | Botão de tema; as telas usam tokens de cor. |
| Responsividade | ✅ | Conversas, construtor e visão geral conferidos no tamanho de celular. |
| PWA | ✅ | Manifest, ícones e service worker com atualização automática. |
| Documentação atualizada | ✅ | Documentação e Cronograma em PDF, este checklist, manual rápido, roteiro, README e `docs/`. |

## Entregas obrigatórias (seção 17)

| Entrega | Onde está |
|---|---|
| Aplicação, front-end e back-end | `src/` (telas), `server/` (API e Worker), `shared/` (permissões e catálogo de automações) |
| Banco PostgreSQL estruturado | `server/db/migrations` (001 a 007) e `docs/MODELO-DE-DADOS.md` |
| Integração WhatsApp preparada e documentada | `docs/WHATSAPP.md` |
| Motor de automações e construtor visual | `docs/AUTOMACOES.md` |
| Central de RH e portal temporário | `docs/TELAS.md` |
| Documentação técnica em PDF | `docs/aprovaRH - Documentacao do Projeto - Hummm Pizzas.pdf` |
| Cronograma e custos em PDF | `docs/aprovaRH - Cronograma e Custos - Hummm Pizzas.pdf` |
| Manual rápido do usuário | `docs/MANUAL-RAPIDO.md` |
| Roteiro de testes | `docs/ROTEIRO-DE-TESTES.md` (por etapa) e o checklist do Cronograma |
| README completo e .env.example | `README.md`, `.env.example` |
| Código no GitHub da 2MDevs | github.com/2MDevs/aprovarh, uma branch e um Pull Request por etapa (#1 a #14) |

## Pendências (A definir)

- **D4:** número e conta do WhatsApp; provedor Meta ou Evolution.
- **D6:** confirmação de presença no dia da entrevista ou antes. O modelo confirma no dia, e o card aceita de 0 a 7 dias antes.
- **D10:** prazo de guarda dos dados de candidatos.
- **D11:** o que é a tela "Processos seletivos". Ainda não foi feita.
- Domínio, data de produção, quem testa, rotina de backup e valores (proposta de orçamento não recebida).
