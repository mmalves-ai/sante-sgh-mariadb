-- REC, lote 4 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (04_chaves.sql).

-- L6-01 (6): regra de impressão restrita a uma clínica
ALTER TABLE regra_impressao_ficha
  ADD COLUMN clinica_assistencial_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para todas as clínicas',
  ADD KEY ix_regra_impressao_ficha_clinica_assistencial_id (clinica_assistencial_id);
