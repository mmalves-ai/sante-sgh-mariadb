-- Glosa e recurso por item (06-FAT linha 34, F3.7, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, glosa/recurso-lote.ts) e na operação
-- (apps/api/src/modulos/tiss/operacoes-glosa.ts).
--   - recurso_glosa_item.numero_demonstrativo_retorno: o demonstrativo da operadora que trouxe o retorno do item.
--   - recurso_glosa_item.motivo_retorno_glosa_id: o motivo informado no retorno (negado ou acatado em parte); nulo
--     quando a operadora não informou.
--   - recurso_glosa_item.retornado_em / retornado_por_usuario_id: quando e quem registrou o retorno.
--   Cada retorno é gravado uma vez no item do recurso; nenhum valor anterior é sobrescrito nem apagado.

ALTER TABLE recurso_glosa_item
  ADD COLUMN IF NOT EXISTS numero_demonstrativo_retorno VARCHAR(20) NULL COMMENT 'Demonstrativo da operadora que trouxe o retorno do item' AFTER justificativa_operadora,
  ADD COLUMN IF NOT EXISTS motivo_retorno_glosa_id BIGINT UNSIGNED NULL COMMENT 'Motivo informado no retorno (nulo = não informado)' AFTER numero_demonstrativo_retorno,
  ADD COLUMN IF NOT EXISTS retornado_em DATE NULL COMMENT 'Data do retorno da operadora para o item' AFTER motivo_retorno_glosa_id,
  ADD COLUMN IF NOT EXISTS retornado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem registrou o retorno' AFTER retornado_em,
  ADD KEY IF NOT EXISTS ix_recurso_glosa_item_motivo_retorno (motivo_retorno_glosa_id),
  ADD KEY IF NOT EXISTS ix_recurso_glosa_item_retornado_por (retornado_por_usuario_id);

ALTER TABLE recurso_glosa_item
  ADD CONSTRAINT IF NOT EXISTS ck_recurso_glosa_item_retorno CHECK ((valor_acatado IS NULL AND retornado_em IS NULL) OR (valor_acatado IS NOT NULL AND retornado_em IS NOT NULL AND numero_demonstrativo_retorno IS NOT NULL));
