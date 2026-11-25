-- Fechamento parcial da conta por período (06-FAT linha 12, F3.7, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, conta/periodos-conta.ts) e na operação
-- (apps/api/src/modulos/faturamento/conta-periodos-propria.ts).
--   - conta_hospitalar_periodo.fechado_em / fechado_por: o período fechado não aceita lançamento com data dentro da
--     sua faixa nem é retirado; a reabertura limpa as duas colunas e o motivo fica na trilha. Nada se apaga.

ALTER TABLE conta_hospitalar_periodo
  ADD COLUMN IF NOT EXISTS fechado_em DATETIME(3) NULL COMMENT 'Quando o período foi fechado (faturado em separado); nulo: aberto' AFTER origem;

ALTER TABLE conta_hospitalar_periodo
  ADD COLUMN IF NOT EXISTS fechado_por BIGINT UNSIGNED NULL COMMENT 'Usuário que fechou o período' AFTER fechado_em;

ALTER TABLE conta_hospitalar_periodo
  ADD CONSTRAINT IF NOT EXISTS ck_conta_hospitalar_periodo_fechado CHECK (fechado_por IS NULL OR fechado_em IS NOT NULL);
