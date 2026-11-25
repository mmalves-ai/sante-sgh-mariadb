-- Cancelamento da compensação do tributo retido pelos tomadores (07-FIN linha 109, F3.8, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-financeiro, retencao-sofrida.ts:
-- conferirCancelamentoCompensacao, o cancelamento exige motivo e não se repete) e na operação
-- (apps/api/src/modulos/financeiro/retencao-sofrida-propria.ts). A apuração cancelada nunca é apagada: fica com a
-- situação "cancelada", quem cancelou, quando e por quê; os itens ficam, e o crédito volta ao saldo a compensar.
ALTER TABLE apuracao_retencao
  ADD COLUMN IF NOT EXISTS cancelado_em DATETIME(3) NULL COMMENT 'Quando a apuração foi cancelada' AFTER fechador_usuario_id,
  ADD COLUMN IF NOT EXISTS cancelado_por BIGINT UNSIGNED NULL COMMENT 'Usuário que cancelou a apuração' AFTER cancelado_em,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(300) NULL COMMENT 'Por que a apuração foi cancelada (competência errada, crédito usado por engano)' AFTER cancelado_por;
