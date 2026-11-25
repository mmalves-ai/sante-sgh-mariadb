-- Encerramento e anulação da suspensão do processo tributário (07-FIN linha 111, F3.8, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-financeiro, reinf-eventos.ts:
-- conferirEncerramentoSuspensao e fimDaSuspensao) e na operação financeiro.reinf_encerrar_suspensao
-- (apps/api/src/modulos/financeiro/reinf-eventos-propria.ts). A suspensão cuja decisão caiu vale até a data do
-- encerramento; a lançada por engano fica anulada e nunca vale. Nada é apagado: a linha continua, com o motivo.
ALTER TABLE suspensao_processo_tributario
  ADD COLUMN IF NOT EXISTS encerrada_em DATE NULL COMMENT 'Último dia em que a suspensão vale (a decisão caiu); vazio: segue a vigência do processo',
  ADD COLUMN IF NOT EXISTS anulada BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Lançada por engano: nunca vale na apuração',
  ADD COLUMN IF NOT EXISTS motivo_encerramento VARCHAR(200) NULL COMMENT 'Motivo do encerramento ou da anulação';

ALTER TABLE suspensao_processo_tributario
  ADD CONSTRAINT IF NOT EXISTS ck_suspensao_processo_tributario_encerramento CHECK ((encerrada_em IS NULL AND anulada = FALSE) OR motivo_encerramento IS NOT NULL),
  ADD CONSTRAINT IF NOT EXISTS ck_suspensao_processo_tributario_anulada CHECK (anulada = FALSE OR encerrada_em IS NULL);
