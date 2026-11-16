-- Etapa 10: WhatsApp só pela Evolution API e tela "Conexão do WhatsApp" (decisão D40).
-- Permissão nova "whatsapp.conectar": entra no perfil Diretoria / Administrador de instalações que já existem.
-- (O Desenvolvedor recebe todas as permissões sozinho; em instalação nova, a Diretoria já nasce com ela.)
UPDATE perfis
   SET permissoes = array_append(permissoes, 'whatsapp.conectar'), atualizado_em = now()
 WHERE chave = 'diretoria' AND NOT ('whatsapp.conectar' = ANY (permissoes));

-- O provedor passou a ser sempre a Evolution: o valor antigo deixa de valer.
DELETE FROM configuracoes WHERE chave = 'whatsapp.provedor';
