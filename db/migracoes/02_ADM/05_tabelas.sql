-- ADM, lote 05 (F2.2 onda 1): chaves de liberação de operação e recurso, pré-requisitos dos recursos, a conta ligada
-- ao profissional e à pessoa, e o detalhe das sessões de suporte. Sem FOREIGN KEY aqui (05_chaves.sql).

CREATE TABLE liberacao_lote (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  numero             BIGINT UNSIGNED NOT NULL COMMENT 'Número de negócio do lote no estabelecimento (sequência liberacao_lote)',
  tipo               VARCHAR(20) NOT NULL,
  chave              VARCHAR(120) NOT NULL COMMENT 'Chave da operação ou do recurso',
  justificativa      VARCHAR(500) NOT NULL,
  referencia_autorizacao VARCHAR(200) NULL COMMENT 'Referência da autorização do dono para ligar em produção',
  alteradas          INT UNSIGNED NOT NULL COMMENT 'Quantas chaves o lote mudou',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_liberacao_lote_tipo CHECK (tipo IN ('operacao','recurso')),
  CONSTRAINT ck_liberacao_lote_alteradas CHECK (alteradas > 0),
  CONSTRAINT ck_liberacao_lote_justificativa CHECK (CHAR_LENGTH(TRIM(justificativa)) >= 10),
  UNIQUE KEY uq_liberacao_lote_numero (estabelecimento_id, numero),
  KEY ix_liberacao_lote_chave (estabelecimento_id, chave)
) COMMENT='Lote de mudança das chaves de liberação (uma ação da tela), reversível, com justificativa';

CREATE TABLE liberacao_chave (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  tipo               VARCHAR(20) NOT NULL,
  chave              VARCHAR(120) NOT NULL COMMENT 'Chave da operação ou do recurso',
  escopo             VARCHAR(20) NOT NULL,
  valor              VARCHAR(120) NOT NULL COMMENT 'Asterisco (estabelecimento inteiro), código do setor, do grupo ou login da pessoa',
  ligada             BOOLEAN NULL COMMENT 'Nulo: a linha não decide e vale o nível acima',
  ligada_antes       BOOLEAN NULL COMMENT 'Estado antes do último lote (reversão)',
  liberacao_lote_id  BIGINT UNSIGNED NULL COMMENT 'Último lote que mudou a linha',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_liberacao_chave_tipo CHECK (tipo IN ('operacao','recurso')),
  CONSTRAINT ck_liberacao_chave_escopo CHECK (escopo IN ('hospital','setor','grupo','pessoa')),
  CONSTRAINT ck_liberacao_chave_hospital CHECK (escopo <> 'hospital' OR valor = '*'),
  UNIQUE KEY uq_liberacao_chave_escopo (estabelecimento_id, chave, escopo, valor),
  KEY ix_liberacao_chave_liberacao_lote (liberacao_lote_id)
) COMMENT='Chave de liberação de operação ou recurso por estabelecimento e escopo (estabelecimento, setor, grupo, pessoa)';

CREATE TABLE recurso_prerequisito (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  recurso            VARCHAR(120) NOT NULL COMMENT 'Chave do recurso',
  tipo               VARCHAR(30) NOT NULL,
  situacao           VARCHAR(20) NOT NULL DEFAULT 'pendente',
  validade           DATE NULL,
  evidencia          VARCHAR(200) NULL COMMENT 'Referência da evidência (sem segredo)',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_recurso_prerequisito_tipo CHECK (tipo IN ('certificado','credenciamento','contrato','aprovacao')),
  CONSTRAINT ck_recurso_prerequisito_situacao CHECK (situacao IN ('pendente','cumprido','dispensado')),
  UNIQUE KEY uq_recurso_prerequisito_tipo (estabelecimento_id, recurso, tipo)
) COMMENT='Pré-requisito externo de um recurso no estabelecimento (certificado, credenciamento, contrato, aprovação)';

CREATE TABLE usuario_profissional (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id         BIGINT UNSIGNED NOT NULL,
  profissional_id    BIGINT UNSIGNED NOT NULL,
  vigencia_inicio    DATE NOT NULL,
  vigencia_fim       DATE NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  usuario_vigente_id BIGINT UNSIGNED AS (IF(vigencia_fim IS NULL AND excluido_em IS NULL, usuario_id, NULL)) STORED COMMENT 'Garante um único profissional vigente por conta',
  CONSTRAINT ck_usuario_profissional_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_usuario_profissional_vigente (usuario_vigente_id),
  KEY ix_usuario_profissional_usuario (usuario_id),
  KEY ix_usuario_profissional_profissional (profissional_id)
) COMMENT='Profissional que a conta de acesso representa ao assinar atos clínicos, com vigência';

CREATE TABLE sessao_suporte_acao (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sessao_suporte_id  BIGINT UNSIGNED NOT NULL,
  metodo             VARCHAR(10) NOT NULL,
  caminho            VARCHAR(500) NOT NULL,
  situacao           VARCHAR(20) NOT NULL,
  status_http        SMALLINT UNSIGNED NULL,
  ato_clinico        BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_nao_reversivel VARCHAR(255) NULL,
  ocorrido_em        DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_sessao_suporte_acao_situacao CHECK (situacao IN ('ok','erro','bloqueada','abortada')),
  KEY ix_sessao_suporte_acao_sessao (sessao_suporte_id, ocorrido_em)
) COMMENT='Ação feita numa sessão de suporte como o usuário';

CREATE TABLE sessao_suporte_leitura (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sessao_suporte_id  BIGINT UNSIGNED NOT NULL,
  caminho            VARCHAR(500) NOT NULL,
  quantidade         INT UNSIGNED NOT NULL DEFAULT 0,
  primeira_em        DATETIME(3) NOT NULL,
  ultima_em          DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_sessao_suporte_leitura_periodo CHECK (ultima_em >= primeira_em),
  UNIQUE KEY uq_sessao_suporte_leitura_caminho (sessao_suporte_id, caminho(255))
) COMMENT='Leituras agregadas por caminho numa sessão de suporte como o usuário';

ALTER TABLE usuario
  ADD COLUMN pessoa_fisica_id BIGINT UNSIGNED NULL COMMENT 'Pessoa da conta (profissional, colaborador)',
  ADD KEY ix_usuario_pessoa_fisica (pessoa_fisica_id);
