-- Remuneração variável por faixa (06-FAT linha 48, F8, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; a regra fica no domínio (@sgh/dominio-repasse, variavel-faixa.ts) e na porta
-- (apps/api/src/modulos/repasse/variavel-faixa-propria.ts).
--   - regra_repasse_variavel.evento_desconto_repasse_id: o evento (natureza desconto) usado quando a medida cai numa
--     faixa de desconto; o evento_repasse_id da regra fica para o acréscimo. Sem ele, a faixa de desconto não é aceita.

ALTER TABLE regra_repasse_variavel
  ADD COLUMN IF NOT EXISTS evento_desconto_repasse_id BIGINT UNSIGNED NULL COMMENT 'Evento do ajuste nas faixas de desconto' AFTER evento_repasse_id,
  ADD KEY IF NOT EXISTS ix_regra_repasse_variavel_evento_desconto_repasse_id (evento_desconto_repasse_id);
