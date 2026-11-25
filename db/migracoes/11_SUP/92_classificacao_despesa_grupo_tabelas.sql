-- Suprimentos, a classificação de despesa do grupo do insumo (F3.6, 05-SUP linha 3, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- O item do estoque recebe a classificação de despesa (taxa, diária, gás, material, medicamento, com o código de
-- despesa da TISS) pelo seu grupo. Com ela, a concessão do usuário só por classificação de despesa
-- (usuario_estoque_classificacao.classificacao_despesa_id, que atravessa grupos) passa a conceder e a restringir o
-- que ele requisita, movimenta e compra. Grupo sem classificação: o item não é coberto por concessão só de despesa.
-- A decisão é do domínio (conferirClassificacaoDoUsuario); o banco só guarda o cadastro.
ALTER TABLE grupo_insumo
  ADD COLUMN IF NOT EXISTS classificacao_despesa_id BIGINT UNSIGNED NULL
    COMMENT 'Classificação de despesa dos insumos do grupo (código de despesa da TISS); nula quando não ligada'
    AFTER codigo_tiss;
CREATE INDEX IF NOT EXISTS ix_grupo_insumo_classificacao_despesa ON grupo_insumo (classificacao_despesa_id);
