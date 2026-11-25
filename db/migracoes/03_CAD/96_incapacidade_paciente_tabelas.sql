-- Cadastro, condição de incapacidade do paciente (F3.1, 02-CAD linha 4, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (errosIncapacidade, pendenciasRepresentacao).
-- A incapacidade só existia como efeito de um curador já cadastrado. Passa a ser condição própria do paciente, com a
-- data de início e o documento que a prova (sentença de curatela, curatela provisória ou laudo médico): dela sai a
-- pendência do incapaz sem curador, o aviso na abertura do atendimento e a recusa do consentimento assinado pelo
-- próprio paciente. O levantamento encerra a vigência com data e motivo; nada é apagado.
-- Uma só condição vigente por paciente: a coluna gerada repete o paciente enquanto a condição está aberta e viva, e o
-- índice único é sobre ela (as encerradas ficam como histórico).
CREATE TABLE IF NOT EXISTS incapacidade_paciente (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id            BIGINT UNSIGNED NOT NULL,
  vigencia_inicio        DATE NOT NULL COMMENT 'Data em que a incapacidade passou a valer',
  vigencia_fim           DATE NULL COMMENT 'Data do levantamento da incapacidade (nula: vigente)',
  documento_tipo         VARCHAR(30) NOT NULL,
  documento_numero       VARCHAR(60) NULL COMMENT 'Número do processo (documento judicial) ou do laudo',
  documento_data         DATE NOT NULL,
  comprovante_arquivo_id BIGINT UNSIGNED NULL COMMENT 'Sentença, termo de curatela ou laudo digitalizado',
  motivo_encerramento    VARCHAR(300) NULL,
  observacao             VARCHAR(500) NULL,
  paciente_vigente       BIGINT UNSIGNED
    AS (IF(vigencia_fim IS NULL AND excluido_em IS NULL, paciente_id, NULL)) PERSISTENT
    COMMENT 'Paciente enquanto a condição está vigente; nulo depois, para a unicidade',
  origem                 VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em            DATETIME(3) NULL,
  excluido_por           BIGINT UNSIGNED NULL,
  CONSTRAINT ck_incapacidade_paciente_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_incapacidade_paciente_documento_tipo CHECK (documento_tipo IN ('sentenca_curatela','curatela_provisoria','laudo_medico')),
  CONSTRAINT ck_incapacidade_paciente_documento_numero CHECK (documento_tipo = 'laudo_medico' OR documento_numero IS NOT NULL),
  CONSTRAINT ck_incapacidade_paciente_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_incapacidade_paciente_encerramento CHECK (vigencia_fim IS NULL OR motivo_encerramento IS NOT NULL),
  UNIQUE KEY uq_incapacidade_paciente_vigente (paciente_vigente),
  KEY ix_incapacidade_paciente_paciente (paciente_id, vigencia_inicio),
  KEY ix_incapacidade_paciente_comprovante (comprovante_arquivo_id)
) COMMENT='Condição de incapacidade do paciente, com data de início, documento que a prova e levantamento';
