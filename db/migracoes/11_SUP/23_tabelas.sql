-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Balanço do inventário num documento só (itens com o sentido pela natureza do movimento).
ALTER TABLE documento_estoque
  DROP CONSTRAINT IF EXISTS ck_documento_estoque_tipo,
  ADD CONSTRAINT ck_documento_estoque_tipo CHECK (tipo IN ('transferencia','devolucao_interna','saida_setor','saida_paciente','acerto_entrada','acerto_saida','baixa','doacao','venda','saida_terceiro','balanco'));

-- Devolução: o item aponta o item da saída que desfaz.
ALTER TABLE documento_estoque_item
  ADD COLUMN IF NOT EXISTS origem_documento_estoque_item_id BIGINT UNSIGNED NULL COMMENT 'Item da saída que esta devolução desfaz' AFTER movimento_estoque_id,
  ADD KEY IF NOT EXISTS ix_documento_estoque_item_origem (origem_documento_estoque_item_id);

-- Alçada própria para autorizar a requisição do local.
ALTER TABLE local_estoque_usuario
  ADD COLUMN IF NOT EXISTS pode_autorizar_requisicao BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Autoriza as requisições do local' AFTER pode_atender;

-- Inventário: o lote contado (a sobra de item com lote entra no saldo do lote). A chave única passa a ser por
-- contagem, insumo e lote (0 para o item sem lote, pela coluna gerada).
ALTER TABLE inventario_estoque_item
  ADD COLUMN IF NOT EXISTS lote_insumo_id BIGINT UNSIGNED NULL COMMENT 'Lote contado (item que controla lote)' AFTER insumo_id,
  ADD COLUMN IF NOT EXISTS lote_chave BIGINT UNSIGNED AS (IFNULL(lote_insumo_id, 0)) PERSISTENT COMMENT 'Só para a unicidade: o lote (0 sem lote)' AFTER lote_insumo_id,
  ADD UNIQUE KEY IF NOT EXISTS uq_inventario_estoque_item_contagem_insumo_lote (inventario_estoque_contagem_id, insumo_id, lote_chave),
  ADD KEY IF NOT EXISTS ix_inventario_estoque_item_lote (lote_insumo_id);
ALTER TABLE inventario_estoque_item
  DROP INDEX IF EXISTS uq_inventario_estoque_item_contagem_insumo;
