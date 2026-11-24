-- Tipo da ligação tarifada gravado no registro (06-FAT linha 23, F8, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, conta/regras-comerciais.ts)
-- e na operação (apps/api/src/modulos/faturamento/regras-comerciais-propria.ts).
--   - ligacao_tarifada.tipo_ligacao_tarifada_id: o tipo cadastrado da ligação. O lançamento na conta acha a regra
--     vigente pelo tipo e pelo estabelecimento, e não pela regra gravada no registro: a ligação registrada antes de
--     o faturista criar a regra do tipo entra na conta assim que a regra existir.
--   - Linhas antigas com regra gravada recebem o tipo dessa regra (só onde a coluna ainda está nula).

ALTER TABLE ligacao_tarifada
  ADD COLUMN IF NOT EXISTS tipo_ligacao_tarifada_id BIGINT UNSIGNED NULL COMMENT 'Tipo cadastrado da ligação (acha a regra no lançamento)' AFTER regra_cobranca_ligacao_id;

ALTER TABLE ligacao_tarifada
  ADD KEY IF NOT EXISTS ix_ligacao_tarifada_tipo_ligacao_tarifada (tipo_ligacao_tarifada_id);

UPDATE ligacao_tarifada l
  JOIN regra_cobranca_ligacao r ON r.id = l.regra_cobranca_ligacao_id
   SET l.tipo_ligacao_tarifada_id = r.tipo_ligacao_tarifada_id
 WHERE l.tipo_ligacao_tarifada_id IS NULL;
