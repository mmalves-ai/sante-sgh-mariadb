-- Kit de cobrança disparado pelo item (06-FAT linha 16, F3.7, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho no banco; a regra fica no domínio (@sgh/dominio-faturamento, conta/movimentos.ts: kitsDoGatilho)
-- e na operação do lançamento do item (apps/api/src/modulos/faturamento/kit-lancamento.ts).
--   - kit_cobranca.item_gatilho_id: o item cujo lançamento na conta lança o kit junto. Nulo: o kit só entra pela tela.
--     Distinto de item_faturavel_id (o item que cobra o kit fechado): o gatilho nunca é cobrado pelo próprio kit.

ALTER TABLE kit_cobranca
  ADD COLUMN IF NOT EXISTS item_gatilho_id BIGINT UNSIGNED NULL COMMENT 'Item cujo lançamento na conta lança o kit junto' AFTER item_faturavel_id;

ALTER TABLE kit_cobranca
  ADD INDEX IF NOT EXISTS ix_kit_cobranca_item_gatilho (item_gatilho_id, ativo);
