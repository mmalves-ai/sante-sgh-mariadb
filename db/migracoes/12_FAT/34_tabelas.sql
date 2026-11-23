-- Material e medicamento na conta pelo item da tabela de preço (rodada conta-itens-3, proposta B). Só para frente;
-- FOREIGN KEY em 34_chaves.sql.
--
-- O item faturável de mat/med pode apontar o produto de estoque (insumo_id) OU o item da tabela de referência de preço
-- de mat/med (item_referencia_matmed_id): no mercado (TISS) o mat/med é cobrado pelo código da tabela de referência, e o
-- hospital nem sempre declara o produto de estoque do item que cobra. Nunca nenhum dos dois. Um item de referência tem no
-- máximo um item faturável (UNIQUE): o item faturável é do cliente, o item de referência pode ser do espelho padrão.
ALTER TABLE item_faturavel
  ADD COLUMN IF NOT EXISTS item_referencia_matmed_id BIGINT UNSIGNED NULL
    COMMENT 'Item da tabela de referência de preço de mat/med cobrado (alternativa ao insumo)'
    AFTER insumo_id,
  ADD UNIQUE KEY IF NOT EXISTS uq_item_faturavel_item_referencia_matmed (item_referencia_matmed_id);

ALTER TABLE item_faturavel DROP CONSTRAINT IF EXISTS ck_item_faturavel_insumo;
ALTER TABLE item_faturavel
  ADD CONSTRAINT ck_item_faturavel_insumo CHECK (tipo_item NOT IN ('material','medicamento','opme')
    OR insumo_id IS NOT NULL OR item_referencia_matmed_id IS NOT NULL);
