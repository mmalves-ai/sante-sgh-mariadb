-- Suprimentos, ata de registro de preços e nota de empenho na porta própria (C2-030, 05-SUP linha 26, 25/11/2026): só
-- para frente e idempotente (ADR 0002, parte 2). A ata, os itens e o empenho já estavam no modelo; faltava a ligação
-- que devolve o saldo à ata na anulação e o registro da anulação (nada é apagado):
-- 1) no empenho: a ata de origem, o motivo da anulação e quem anulou (o instante já é cancelado_em);
-- 2) no item do empenho: o item da ata cujo saldo ele consome.
-- A regra é do domínio (regras-suprimentos/ata-empenho); o banco só guarda.
ALTER TABLE empenho
  ADD COLUMN IF NOT EXISTS ata_registro_preco_id BIGINT UNSIGNED NULL COMMENT 'Ata de registro de preços cujo saldo o empenho consome',
  ADD COLUMN IF NOT EXISTS motivo_anulacao VARCHAR(500) NULL COMMENT 'Motivo da anulação do empenho',
  ADD COLUMN IF NOT EXISTS anulado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem anulou o empenho',
  ADD INDEX IF NOT EXISTS ix_empenho_ata_registro_preco (ata_registro_preco_id),
  ADD INDEX IF NOT EXISTS ix_empenho_anulado_por_usuario (anulado_por_usuario_id);

ALTER TABLE empenho_item
  ADD COLUMN IF NOT EXISTS ata_registro_preco_item_id BIGINT UNSIGNED NULL COMMENT 'Item da ata cujo saldo o item empenhado consome',
  ADD INDEX IF NOT EXISTS ix_empenho_item_ata_registro_preco_item (ata_registro_preco_item_id);
