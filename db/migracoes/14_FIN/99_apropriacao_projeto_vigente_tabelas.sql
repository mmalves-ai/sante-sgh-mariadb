-- Projeto como centro de resultado (07-FIN linha 128, C2-107, F8, 25/11/2026): o estorno da apropriação ao projeto é
-- histórico e nunca é sobrescrito. A apropriação de novo do mesmo documento no mesmo projeto entra em linha nova; a
-- unicidade por projeto e documento vale só entre as apropriações não estornadas (vigente_chave). Só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho: a regra fica na porta
-- (apps/api/src/modulos/orcamento/projeto-resultado-propria.ts).
ALTER TABLE apropriacao_projeto
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não estornada',
  ADD UNIQUE KEY IF NOT EXISTS uq_apropriacao_projeto_titulo_vigente (projeto_id, titulo_pagar_id, vigente_chave),
  ADD UNIQUE KEY IF NOT EXISTS uq_apropriacao_projeto_titulo_receber_vigente (projeto_id, titulo_receber_id, vigente_chave),
  ADD UNIQUE KEY IF NOT EXISTS uq_apropriacao_projeto_lancamento_vigente (projeto_id, lancamento_contabil_id, vigente_chave),
  ADD UNIQUE KEY IF NOT EXISTS uq_apropriacao_projeto_consumo_vigente (projeto_id, movimento_estoque_id, vigente_chave),
  ADD UNIQUE KEY IF NOT EXISTS uq_apropriacao_projeto_contrato_vigente (projeto_id, contrato_fornecedor_id, vigente_chave);

ALTER TABLE apropriacao_projeto
  DROP INDEX IF EXISTS uq_apropriacao_projeto_titulo,
  DROP INDEX IF EXISTS uq_apropriacao_projeto_titulo_receber,
  DROP INDEX IF EXISTS uq_apropriacao_projeto_lancamento,
  DROP INDEX IF EXISTS uq_apropriacao_projeto_consumo,
  DROP INDEX IF EXISTS uq_apropriacao_projeto_contrato;
