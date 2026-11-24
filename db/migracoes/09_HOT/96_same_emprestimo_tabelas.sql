-- SAME: solicitação e empréstimo de prontuário (F3.9, fatia F3.9-5, 04-HOT L128, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-hotelaria, same-tramite) e na
-- porta (adt/same-tramite-propria).
--   - emprestimo_prontuario: a solicitação que o empréstimo atendeu (o pedido fica atendido ou parcial pelos empréstimos).
--   - motivo_solicitacao_prontuario: os motivos padrão do produto, com a finalidade e o prazo de devolução. Todo cliente
--     novo nasce com eles; o de-para da origem fica no conector.
ALTER TABLE emprestimo_prontuario
  ADD COLUMN IF NOT EXISTS solicitacao_prontuario_id BIGINT UNSIGNED NULL COMMENT 'Solicitação atendida pelo empréstimo' AFTER motivo_solicitacao_prontuario_id;
ALTER TABLE emprestimo_prontuario ADD INDEX IF NOT EXISTS ix_emprestimo_prontuario_solicitacao (solicitacao_prontuario_id);

INSERT INTO motivo_solicitacao_prontuario
  (codigo, descricao, ativo, finalidade, urgente, exige_autorizacao, baixa_pendencias, prazo_devolucao_dias, criado_em) VALUES
  ('assistencia', 'Assistência ao paciente (consulta ou internação)', TRUE, 'assistencia', FALSE, FALSE, FALSE, 2, NOW(3)),
  ('urgencia', 'Atendimento de urgência', TRUE, 'assistencia', TRUE, FALSE, FALSE, 1, NOW(3)),
  ('auditoria', 'Auditoria de contas ou da qualidade', TRUE, 'auditoria', FALSE, FALSE, FALSE, 5, NOW(3)),
  ('faturamento', 'Conferência do faturamento', TRUE, 'faturamento', FALSE, FALSE, TRUE, 5, NOW(3)),
  ('pesquisa', 'Pesquisa científica aprovada', TRUE, 'pesquisa', FALSE, TRUE, FALSE, 15, NOW(3)),
  ('judicial', 'Processo judicial ou pedido do paciente', TRUE, 'processo_judicial', FALSE, TRUE, FALSE, 10, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;

-- Correção F3.9-5 (custódia única com a guarda, 24/11/2026): o empréstimo fica preso ao movimento de saída da guarda
-- (a posse do volume tem uma fonte só) e guarda a situação do volume antes da saída, para a devolução restaurá-la. O
-- item da solicitação ganha a observação de por que saiu da fila (não localizado ou cancelado).
ALTER TABLE emprestimo_prontuario
  ADD COLUMN IF NOT EXISTS movimento_prontuario_id BIGINT UNSIGNED NULL COMMENT 'Movimento de saída da guarda que levou o volume' AFTER solicitacao_prontuario_id,
  ADD COLUMN IF NOT EXISTS situacao_anterior_volume VARCHAR(20) NULL COMMENT 'Situação do volume antes da saída (a devolução a restaura)' AFTER movimento_prontuario_id;
ALTER TABLE emprestimo_prontuario ADD INDEX IF NOT EXISTS ix_emprestimo_prontuario_movimento (movimento_prontuario_id);
ALTER TABLE emprestimo_prontuario DROP CONSTRAINT IF EXISTS ck_emprestimo_prontuario_situacao_anterior;
ALTER TABLE emprestimo_prontuario ADD CONSTRAINT ck_emprestimo_prontuario_situacao_anterior
  CHECK (situacao_anterior_volume IS NULL OR situacao_anterior_volume IN ('aberto','encerrado','arquivado'));
ALTER TABLE solicitacao_prontuario_item
  ADD COLUMN IF NOT EXISTS observacao VARCHAR(500) NULL COMMENT 'Por que o item saiu da fila sem entrega (não localizado, cancelado)' AFTER movimento_prontuario_id;
