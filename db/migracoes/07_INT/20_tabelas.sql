-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE fechamento_censo
  ADD COLUMN IF NOT EXISTS versao_calculo SMALLINT UNSIGNED NULL COMMENT 'Versão do cálculo do censo usada no fechamento',
  ADD COLUMN IF NOT EXISTS hora_fechamento TINYINT UNSIGNED NULL COMMENT 'Hora do corte do censo (24 = meia-noite do dia)',
  DROP CONSTRAINT IF EXISTS ck_fechamento_censo_hora,
  ADD CONSTRAINT ck_fechamento_censo_hora CHECK (hora_fechamento IS NULL OR hora_fechamento BETWEEN 1 AND 24);

