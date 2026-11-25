-- E-mail do sistema (01-ADM L77, função C1-063, 25/11/2026): carga inicial das finalidades de e-mail, só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho: a escolha do servidor e do modelo fica no domínio
-- (@sgh/dominio-acesso, email-saida) e no worker (email-saida-propria).
--   - Os alertas da fila de e-mail (quebra de vidro, sessão do suporte, leitura do prontuário, chamado) têm cada um a sua
--     finalidade, para o cliente cadastrar um modelo e um servidor próprios por alerta.
--   - Relatório agendado e laudo, as outras saídas de e-mail do produto (o laudo leva dado de saúde: anexo protegido,
--     sem dado no corpo).
-- Todo cliente nasce com elas; a finalidade que o cliente já tiver com o mesmo código fica como está.
INSERT INTO finalidade_email
  (codigo, descricao, ativo, envia_sms, guarda_registro_envio, exige_consentimento, contem_dado_sensivel, criado_em) VALUES
  ('ALERTA_EMERGENCIA', 'Alerta de acesso de emergência (quebra de vidro) ao Auditor', TRUE, FALSE, TRUE, FALSE, FALSE, NOW(3)),
  ('ALERTA_SUPORTE', 'Alerta de entrada do suporte técnico em nome de um usuário', TRUE, FALSE, TRUE, FALSE, FALSE, NOW(3)),
  ('ALERTA_LEITURA', 'Alerta de leitura do prontuário fora do padrão', TRUE, FALSE, TRUE, FALSE, FALSE, NOW(3)),
  ('ALERTA_CHAMADO', 'Aviso de chamado crítico ou com dado pessoal', TRUE, FALSE, TRUE, FALSE, FALSE, NOW(3)),
  ('RELATORIO_AGENDADO', 'Envio de relatório agendado', TRUE, FALSE, TRUE, FALSE, FALSE, NOW(3)),
  ('LAUDO', 'Envio de laudo ao paciente ou ao solicitante', TRUE, FALSE, TRUE, TRUE, TRUE, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;
