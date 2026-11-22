-- CC, lote 5 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (05_chaves.sql).

-- L6-16 (21), parte 1: ato_cirurgico
ALTER TABLE ato_cirurgico
  ADD COLUMN dados_origem JSON NULL COMMENT 'Retrato das colunas do sistema anterior sem destino próprio';

-- L6-16 (21), parte 1: ato_cirurgico_procedimento
ALTER TABLE ato_cirurgico_procedimento
  ADD COLUMN dados_origem JSON NULL COMMENT 'Retrato das colunas do sistema anterior sem destino próprio';

-- L6-16 (21), parte 1: agendamento_cirurgico
ALTER TABLE agendamento_cirurgico
  ADD COLUMN dados_origem JSON NULL COMMENT 'Retrato das colunas do sistema anterior sem destino próprio';
