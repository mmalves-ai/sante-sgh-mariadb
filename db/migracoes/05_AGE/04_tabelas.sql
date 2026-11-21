-- AGE, lote 04 (F2.2 onda 2; pedidos dos lotes 02-14): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (04_chaves.sql).

ALTER TABLE recurso_agendavel
  ADD COLUMN idade_minima_anos SMALLINT UNSIGNED NULL COMMENT 'Idade mínima do paciente aceita',
  ADD COLUMN idade_maxima_anos SMALLINT UNSIGNED NULL COMMENT 'Idade máxima do paciente aceita',
  ADD CONSTRAINT ck_recurso_agendavel_idade CHECK (idade_minima_anos IS NULL OR idade_maxima_anos IS NULL OR idade_maxima_anos >= idade_minima_anos);
