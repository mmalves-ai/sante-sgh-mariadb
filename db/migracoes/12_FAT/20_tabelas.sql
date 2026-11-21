-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE lote_tiss_conta
  ADD COLUMN IF NOT EXISTS guia_tiss_chave BIGINT UNSIGNED AS (COALESCE(guia_tiss_id, 0)) PERSISTENT COMMENT 'Só para a unicidade: a guia nula conta como uma',
  ADD UNIQUE KEY IF NOT EXISTS uq_lote_tiss_conta_conta_guia_chave (lote_tiss_id, conta_hospitalar_id, guia_tiss_chave),
  DROP INDEX IF EXISTS uq_lote_tiss_conta_conta_guia;

