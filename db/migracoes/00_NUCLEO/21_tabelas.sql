-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE arquivo
  ADD COLUMN IF NOT EXISTS versao_objeto VARCHAR(100) NULL COMMENT 'Versão do objeto no armazenamento (a leitura é sempre por ela)' AFTER chave_armazenamento;
