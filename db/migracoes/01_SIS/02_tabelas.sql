-- SIS, lote 02 (F2.2 onda 2; pedidos dos lotes 02-08): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (02_chaves.sql).

CREATE TABLE migracao_aplicada (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  numero INT UNSIGNED NOT NULL COMMENT 'Posição do arquivo na ordem de db/migracoes (pasta e arquivo)',
  arquivo VARCHAR(200) NOT NULL COMMENT 'Pasta/arquivo da migração',
  hash CHAR(64) NOT NULL COMMENT 'SHA-256 do conteúdo do arquivo',
  aplicada_em DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_migracao_aplicada_hash CHECK (hash REGEXP '^[0-9a-f]{64}$'),
  UNIQUE KEY uq_migracao_aplicada_numero (numero),
  UNIQUE KEY uq_migracao_aplicada_arquivo (arquivo)
) COMMENT='Registro das migrações aplicadas no banco do cliente (conferência da instalação)';
