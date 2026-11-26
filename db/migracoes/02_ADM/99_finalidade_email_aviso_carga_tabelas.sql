-- E-mail do sistema (01-ADM L77, função C1-063, 25/11/2026): finalidade de e-mail do aviso do sistema (o e-mail que o
-- despachante de notificações manda com a contagem de avisos pendentes do usuário), só para frente e idempotente
-- (ADR 0002, parte 2). Com ela o cliente cadastra servidor e modelo próprios para esse e-mail (marcadores
-- aviso.quantidade, aviso.assunto, aviso.texto). Sem gatilho: a escolha fica no domínio (@sgh/dominio-acesso,
-- email-saida) e no worker (email-saida-propria, notificacao-despacho.service). Sem dado clínico nem nominal no texto.
-- A finalidade que o cliente já tiver com o mesmo código fica como está.
INSERT INTO finalidade_email
  (codigo, descricao, ativo, envia_sms, guarda_registro_envio, exige_consentimento, contem_dado_sensivel, criado_em) VALUES
  ('AVISO_SISTEMA', 'Aviso de pendências no sistema (contagem de avisos do usuário)', TRUE, FALSE, TRUE, FALSE, FALSE, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;
