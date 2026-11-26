-- Cancelamento da exceção da regra de lançamento automático antes de ela valer (06-FAT linha 16, F3.7, C1-090,
-- 25/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho no banco; a regra fica no domínio
-- (@sgh/dominio-faturamento, conta/excecao-regra-lancamento.ts: cancelamentoExcecaoRegra) e na porta
-- (apps/api/src/modulos/faturamento/regra-excecao-propria.ts). A linha nunca se apaga: o cancelamento grava quando,
-- quem e por quê, e a apuração da conta passa a ignorar a exceção cancelada.
--   - cancelada_em / cancelada_por / motivo_cancelamento: os três juntos (CHECK); nulos enquanto a exceção vale.

ALTER TABLE regra_lancamento_excecao
  ADD COLUMN IF NOT EXISTS cancelada_em DATETIME(3) NULL COMMENT 'Quando a exceção foi cancelada antes de valer; nulo: não cancelada' AFTER motivo,
  ADD COLUMN IF NOT EXISTS cancelada_por BIGINT UNSIGNED NULL COMMENT 'Usuário que cancelou a exceção' AFTER cancelada_em,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500) NULL COMMENT 'Por que a exceção foi cancelada' AFTER cancelada_por;

ALTER TABLE regra_lancamento_excecao
  ADD CONSTRAINT IF NOT EXISTS ck_regra_lancamento_excecao_cancelamento CHECK ((cancelada_em IS NULL AND cancelada_por IS NULL AND motivo_cancelamento IS NULL) OR (cancelada_em IS NOT NULL AND cancelada_por IS NOT NULL AND motivo_cancelamento IS NOT NULL));
