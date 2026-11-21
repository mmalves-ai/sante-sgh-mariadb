-- CAD, lote 06 (F2.2 onda 2; pedidos dos lotes 02-13): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (06_chaves.sql).

ALTER TABLE suspeita_duplicidade
  ADD COLUMN criterio_cns BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Mesmo cartão nacional de saúde' AFTER criterio_cpf;

ALTER TABLE estabelecimento
  ADD CONSTRAINT ck_estabelecimento_codigo_formato CHECK (codigo REGEXP '^[a-z][a-z0-9]{1,9}$');
