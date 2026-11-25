-- CC, hemodinâmica (F8, 04-CC linha 107; 25/11/2026): um registro VIGENTE por exame pedido. O procedimento
-- interrompido (registro cancelado) fica como histórico e libera um novo registro do mesmo exame (refazer). A chave
-- única passa da coluna do exame para a coluna gerada que só tem valor no registro vigente (não cancelado, não
-- excluído). Roda depois de todas as tabelas (arquivo de chaves). Idempotente.
ALTER TABLE registro_hemodinamica
  ADD COLUMN IF NOT EXISTS exame_item_vigente_id BIGINT UNSIGNED AS (IF(situacao <> 'cancelado' AND excluido_em IS NULL, exame_item_id, NULL)) PERSISTENT COMMENT 'Só para a unicidade: o exame pedido do registro vigente' AFTER exame_item_id,
  ADD KEY IF NOT EXISTS ix_registro_hemodinamica_exame_item (exame_item_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_registro_hemodinamica_exame_item_vigente (exame_item_vigente_id);
ALTER TABLE registro_hemodinamica DROP INDEX IF EXISTS uq_registro_hemodinamica_exame_item;
