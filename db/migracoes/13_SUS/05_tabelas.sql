-- SUS, lote 05 (F2.2 onda 3; pedidos do lote 03-05: crítica, competência, remessas, faixas de AIH e retorno do gestor). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (05_chaves.sql).

ALTER TABLE critica_sus
  ADD COLUMN chave_critica VARCHAR(120) NULL COMMENT 'Chave estável da crítica na competência (regra e alvo)',
  ADD COLUMN codigo_regra VARCHAR(60) NULL COMMENT 'Regra de crítica do domínio que gerou a linha',
  ADD COLUMN conta_hospitalar_id BIGINT UNSIGNED NULL,
  ADD COLUMN conta_hospitalar_item_id BIGINT UNSIGNED NULL,
  ADD COLUMN atendimento_id BIGINT UNSIGNED NULL,
  ADD COLUMN fonte_pagadora_id BIGINT UNSIGNED NULL,
  ADD COLUMN detalhe JSON NULL COMMENT 'Códigos e campos, sem dado pessoal',
  ADD COLUMN justificativa VARCHAR(1000) NULL,
  DROP CONSTRAINT ck_critica_sus_situacao,
  ADD CONSTRAINT ck_critica_sus_situacao CHECK (situacao IN ('aberta','corrigida','ignorada','justificada')),
  DROP CONSTRAINT ck_critica_sus_alvo,
  ADD CONSTRAINT ck_critica_sus_alvo CHECK (conta_aih_id IS NOT NULL OR apac_id IS NOT NULL OR laudo_apac_id IS NOT NULL OR producao_ambulatorial_sus_item_id IS NOT NULL OR registro_raas_id IS NOT NULL OR conta_hospitalar_id IS NOT NULL),
  ADD CONSTRAINT ck_critica_sus_justificada CHECK (situacao <> 'justificada' OR justificativa IS NOT NULL),
  ADD UNIQUE KEY uq_critica_sus_competencia_chave (competencia_sus_id, chave_critica),
  ADD KEY ix_critica_sus_conta_hospitalar_id (conta_hospitalar_id),
  ADD KEY ix_critica_sus_conta_hospitalar_item_id (conta_hospitalar_item_id),
  ADD KEY ix_critica_sus_atendimento_id (atendimento_id),
  ADD KEY ix_critica_sus_fonte_pagadora_id (fonte_pagadora_id);

ALTER TABLE competencia_sus
  ADD COLUMN quantidade_registros_criticados INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN codigo_cnes_critica CHAR(7) NULL COMMENT 'CNES do cabeçalho na última crítica',
  ADD CONSTRAINT ck_competencia_sus_cnes_critica CHECK (codigo_cnes_critica IS NULL OR codigo_cnes_critica REGEXP '^[0-9]{7}$');

ALTER TABLE remessa_ciha
  ADD COLUMN chave_objeto VARCHAR(255) NULL COMMENT 'Chave do arquivo no armazenamento com retenção',
  ADD COLUMN versao_objeto VARCHAR(100) NULL COMMENT 'Versão do objeto no armazenamento';
ALTER TABLE remessa_bpa
  ADD COLUMN chave_objeto VARCHAR(255) NULL COMMENT 'Chave do arquivo no armazenamento com retenção',
  ADD COLUMN versao_objeto VARCHAR(100) NULL COMMENT 'Versão do objeto no armazenamento';
ALTER TABLE remessa_apac
  ADD COLUMN chave_objeto VARCHAR(255) NULL COMMENT 'Chave do arquivo no armazenamento com retenção',
  ADD COLUMN versao_objeto VARCHAR(100) NULL COMMENT 'Versão do objeto no armazenamento',
  ADD COLUMN leiaute VARCHAR(30) NULL,
  ADD COLUMN versao_leiaute VARCHAR(20) NULL,
  ADD COLUMN conferido_contra_oficial BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O arquivo passou pela conferência do programa oficial',
  ADD COLUMN tamanho_bytes BIGINT UNSIGNED NULL,
  ADD COLUMN quantidade_linhas INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN sem_movimento BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Remessa declarada sem movimento na competência';
ALTER TABLE remessa_sisaih
  ADD COLUMN chave_objeto VARCHAR(255) NULL COMMENT 'Chave do arquivo no armazenamento com retenção',
  ADD COLUMN versao_objeto VARCHAR(100) NULL COMMENT 'Versão do objeto no armazenamento';

ALTER TABLE faixa_numeracao_aih
  ADD COLUMN orgao_emissor VARCHAR(10) NULL COMMENT 'Órgão gestor que liberou a faixa',
  ADD COLUMN data_liberacao DATE NULL,
  ADD COLUMN motivo_situacao VARCHAR(500) NULL COMMENT 'Motivo do cancelamento',
  ADD CONSTRAINT ck_faixa_numeracao_aih_cancelada CHECK (situacao <> 'cancelada' OR motivo_situacao IS NOT NULL);

CREATE TABLE retorno_sus_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  retorno_sus_id BIGINT UNSIGNED NOT NULL,
  sequencia INT UNSIGNED NOT NULL,
  identificacao VARCHAR(30) NOT NULL COMMENT 'Número da AIH ou chave da linha do BPA no arquivo do gestor',
  conta_aih_id BIGINT UNSIGNED NULL,
  producao_ambulatorial_sus_item_id BIGINT UNSIGNED NULL,
  procedimento_sigtap_id BIGINT UNSIGNED NULL,
  situacao VARCHAR(30) NOT NULL COMMENT 'aprovada, rejeitada ou glosada',
  motivo_rejeicao_sus_id BIGINT UNSIGNED NULL,
  valor_apresentado DECIMAL(15,2) NULL,
  valor_aprovado DECIMAL(15,2) NULL,
  valor_glosado DECIMAL(15,2) NOT NULL DEFAULT 0,
  tratamento VARCHAR(30) NOT NULL DEFAULT 'pendente' COMMENT 'pendente, reapresentar ou aceita',
  justificativa VARCHAR(1000) NULL,
  tratado_em DATETIME(3) NULL,
  tratado_por_usuario_id BIGINT UNSIGNED NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_retorno_sus_item_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_retorno_sus_item_situacao CHECK (situacao IN ('aprovada','rejeitada','glosada')),
  CONSTRAINT ck_retorno_sus_item_tratamento CHECK (tratamento IN ('pendente','reapresentar','aceita')),
  CONSTRAINT ck_retorno_sus_item_tratado CHECK (tratamento = 'pendente' OR (justificativa IS NOT NULL AND tratado_em IS NOT NULL AND tratado_por_usuario_id IS NOT NULL)),
  CONSTRAINT ck_retorno_sus_item_valores CHECK (valor_glosado >= 0 AND (valor_aprovado IS NULL OR valor_aprovado >= 0) AND (valor_apresentado IS NULL OR valor_apresentado >= 0)),
  CONSTRAINT ck_retorno_sus_item_alvo CHECK (conta_aih_id IS NULL OR producao_ambulatorial_sus_item_id IS NULL),
  UNIQUE KEY uq_retorno_sus_item_retorno_sequencia (retorno_sus_id, sequencia),
  KEY ix_retorno_sus_item_conta_aih_id (conta_aih_id),
  KEY ix_retorno_sus_item_producao (producao_ambulatorial_sus_item_id),
  KEY ix_retorno_sus_item_procedimento_sigtap_id (procedimento_sigtap_id),
  KEY ix_retorno_sus_item_motivo_rejeicao_sus_id (motivo_rejeicao_sus_id),
  KEY ix_retorno_sus_item_tratado_por_usuario_id (tratado_por_usuario_id)
) COMMENT='Linha do retorno do gestor (AIH ou BPA) com a situação, os valores e o tratamento';
