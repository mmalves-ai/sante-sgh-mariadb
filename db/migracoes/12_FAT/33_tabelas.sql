-- Repasse por grupo de ato (rodada conta-itens-2, mudança compartilhada). Só para frente; FOREIGN KEY em 33_chaves.sql.
--
-- O critério "ato" da regra de repasse da origem é o GRUPO de ato do procedimento (o mesmo grupo_ato do item
-- faturável), não a função do profissional na equipe (funcao_equipe_cobranca_id, que continua para o repasse por
-- função). A regra com grupo de ato casa a produção pelo grupo de ato do item faturável do item da conta. Nulo: vale
-- para qualquer grupo de ato.
ALTER TABLE regra_repasse_item
  ADD COLUMN IF NOT EXISTS grupo_ato_id BIGINT UNSIGNED NULL
    COMMENT 'Grupo de ato do procedimento (casa com item_faturavel.grupo_ato_id); nulo: qualquer grupo'
    AFTER funcao_equipe_cobranca_id,
  ADD INDEX IF NOT EXISTS ix_regra_repasse_item_grupo_ato (grupo_ato_id);

-- O mesmo "ato" no item incluso do pacote (honorário): o grupo de ato coberto, ao lado da função da equipe coberta.
ALTER TABLE pacote_item_incluso
  ADD COLUMN IF NOT EXISTS grupo_ato_id BIGINT UNSIGNED NULL
    COMMENT 'Grupo de ato coberto (honorário incluído); nulo: qualquer grupo'
    AFTER funcao_equipe_cobranca_id,
  ADD INDEX IF NOT EXISTS ix_pacote_item_incluso_grupo_ato (grupo_ato_id);
