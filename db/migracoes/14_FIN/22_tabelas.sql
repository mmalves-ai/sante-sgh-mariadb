-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

-- Cota de depreciação: o retrato do cálculo (a cota antiga não muda de leitura se o bem for alterado depois).
ALTER TABLE cota_depreciacao
  ADD COLUMN IF NOT EXISTS vida_util_meses SMALLINT UNSIGNED NULL COMMENT 'Vida útil usada no cálculo' AFTER taxa_anual_percentual,
  ADD COLUMN IF NOT EXISTS coeficiente_turno DECIMAL(7,4) NULL COMMENT 'Coeficiente de turnos de uso aplicado' AFTER vida_util_meses,
  ADD COLUMN IF NOT EXISTS centro_custo_id BIGINT UNSIGNED NULL COMMENT 'Centro de custo do bem na competência' AFTER coeficiente_turno,
  ADD COLUMN IF NOT EXISTS valor_residual_bem DECIMAL(15,2) NULL COMMENT 'Valor residual do bem usado no cálculo' AFTER centro_custo_id,
  ADD KEY IF NOT EXISTS ix_cota_depreciacao_centro_custo_id (centro_custo_id),
  DROP CONSTRAINT IF EXISTS ck_cota_depreciacao_retrato,
  ADD CONSTRAINT ck_cota_depreciacao_retrato CHECK ((vida_util_meses IS NULL OR vida_util_meses > 0) AND (coeficiente_turno IS NULL OR coeficiente_turno > 0) AND (valor_residual_bem IS NULL OR valor_residual_bem >= 0));
