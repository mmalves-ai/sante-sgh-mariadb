-- SGO, lote 12 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (12_chaves.sql).

-- L8-13 (4)
ALTER TABLE motivo_movimento_cadastral
  ADD COLUMN situacao_cadastral_beneficiario_id BIGINT UNSIGNED NULL COMMENT 'Situação que o movimento deixa no beneficiário',
  ADD KEY ix_motivo_movimento_cadastral_situacao (situacao_cadastral_beneficiario_id);
