-- CAD, lote 05 (F2.2 onda 1): chaves de busca do nome, ocupações do profissional e prontuário sigiloso.
-- Sem FOREIGN KEY aqui (05_chaves.sql).

CREATE TABLE chave_busca_nome (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entidade           VARCHAR(20) NOT NULL,
  registro_id        BIGINT UNSIGNED NOT NULL COMMENT 'Id do paciente, profissional ou solicitante (conforme entidade); índice derivado, sem FK',
  campo              VARCHAR(20) NOT NULL,
  palavra            VARCHAR(40) NOT NULL COMMENT 'Palavra normalizada do nome',
  fonetica           VARCHAR(40) NOT NULL COMMENT 'Chave fonética da palavra (regra no domínio do cadastro)',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_chave_busca_nome_entidade CHECK (entidade IN ('paciente','profissional','solicitante')),
  CONSTRAINT ck_chave_busca_nome_campo CHECK (campo IN ('nome','social','mae')),
  UNIQUE KEY uq_chave_busca_nome_palavra (entidade, registro_id, campo, palavra),
  KEY ix_chave_busca_nome_entidade_palavra (entidade, palavra),
  KEY ix_chave_busca_nome_entidade_fonetica (entidade, fonetica)
) COMMENT='Palavras e chaves fonéticas dos nomes para a busca única do cadastro (mantida pela gravação do cadastro)';

CREATE TABLE profissional_ocupacao (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profissional_id    BIGINT UNSIGNED NOT NULL,
  ocupacao_cbo_id    BIGINT UNSIGNED NOT NULL,
  principal          BOOLEAN NOT NULL DEFAULT FALSE,
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  principal_profissional_id BIGINT UNSIGNED AS (IF(principal AND ativo AND excluido_em IS NULL, profissional_id, NULL)) STORED COMMENT 'Garante uma única ocupação principal por profissional',
  UNIQUE KEY uq_profissional_ocupacao_par (profissional_id, ocupacao_cbo_id),
  UNIQUE KEY uq_profissional_ocupacao_principal (principal_profissional_id),
  KEY ix_profissional_ocupacao_ocupacao_cbo (ocupacao_cbo_id)
) COMMENT='Ocupações (CBO) com que o profissional atua, com a principal';

ALTER TABLE paciente
  ADD COLUMN sigiloso BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Prontuário sigiloso: nome e foto mascarados em painel, chamada e listas';
