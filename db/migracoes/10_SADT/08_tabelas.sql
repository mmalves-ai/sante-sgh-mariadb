-- SADT, lote 08 (F2.2 ondas finais, onda 5c; pedido do lote 05-16). Convenções do ADR 0002 (parte 2). Só para frente.

-- 05-16: um só item vigente da lista de trabalho de imagem por item de exame. A porta já garante pela trava do exame
-- e pela idempotência; a chave fecha a corrida também para a tela e para a carga. O item 'sem_modalidade' conta como
-- vigente: só o cancelado, o descontinuado e o excluído liberam o exame para um item novo.
ALTER TABLE item_lista_trabalho_imagem
  ADD COLUMN exame_item_vigente_id BIGINT UNSIGNED AS (IF(excluido_em IS NULL AND situacao NOT IN ('cancelado','descontinuado'), exame_item_id, NULL)) PERSISTENT
    COMMENT 'Apoio à unicidade do item vigente por exame (nulo quando o item não está vigente)' AFTER exame_item_id,
  ADD UNIQUE KEY uq_item_lista_trabalho_imagem_exame_vigente (exame_item_vigente_id);
