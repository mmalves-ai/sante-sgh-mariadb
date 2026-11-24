-- PEP, porta própria da prescrição de enfermagem (família sae-atendimento, modulos-proprios-2, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam na porta e no domínio.
--   - atividade_cuidado_enfermagem: a atividade que o enfermeiro prescreve a partir de uma intervenção do plano, com a
--     frequência e os horários do dia; a suspensão fica na própria linha (situação, quando, quem e o motivo), nunca
--     apagada (SBIS-26);
--   - checagem_cuidado_enfermagem: a checagem de cada horário previsto (feita ou não feita com o motivo), só de
--     acréscimo; a geração conta os estornos anteriores do mesmo horário, e a chave única impede checar duas vezes;
--   - estorno_checagem_cuidado_enfermagem: o estorno da checagem com a justificativa, só de acréscimo (a checagem fica).

CREATE TABLE IF NOT EXISTS atividade_cuidado_enfermagem (
  id                               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id               BIGINT UNSIGNED NOT NULL,
  paciente_id                      BIGINT UNSIGNED NOT NULL,
  atendimento_id                   BIGINT UNSIGNED NOT NULL,
  processo_enfermagem_id           BIGINT UNSIGNED NOT NULL,
  plano_intervencao_enfermagem_id  BIGINT UNSIGNED NOT NULL COMMENT 'Intervenção do plano que originou a atividade',
  codigo_classificacao             VARCHAR(30) NULL COMMENT 'Código da atividade na classificação de intervenções',
  descricao                        VARCHAR(500) NOT NULL,
  frequencia_dia                   SMALLINT UNSIGNED NOT NULL COMMENT 'Vezes por dia',
  horarios                         VARCHAR(600) NOT NULL COMMENT 'Horários do dia (HH:MM) separados por vírgula',
  inicio_em                        DATETIME(3) NOT NULL,
  fim_em                           DATETIME(3) NULL,
  prescritor_profissional_id       BIGINT UNSIGNED NOT NULL,
  situacao                         VARCHAR(20) NOT NULL DEFAULT 'ativa',
  suspensa_em                      DATETIME(3) NULL,
  suspensa_por_profissional_id     BIGINT UNSIGNED NULL,
  motivo_suspensao                 VARCHAR(500) NULL,
  origem                           VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                        DATETIME(3) NOT NULL,
  criado_por                       BIGINT UNSIGNED NULL,
  alterado_em                      DATETIME(3) NULL,
  alterado_por                     BIGINT UNSIGNED NULL,
  versao                           INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                      DATETIME(3) NULL,
  excluido_por                     BIGINT UNSIGNED NULL,
  CONSTRAINT ck_atividade_cuidado_enfermagem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_atividade_cuidado_enfermagem_situacao CHECK (situacao IN ('ativa','suspensa')),
  CONSTRAINT ck_atividade_cuidado_enfermagem_suspensao CHECK (
    (situacao = 'ativa' AND suspensa_em IS NULL AND motivo_suspensao IS NULL)
    OR (situacao = 'suspensa' AND suspensa_em IS NOT NULL AND motivo_suspensao IS NOT NULL
        AND suspensa_por_profissional_id IS NOT NULL)),
  CONSTRAINT ck_atividade_cuidado_enfermagem_periodo CHECK (fim_em IS NULL OR fim_em >= inicio_em),
  CONSTRAINT ck_atividade_cuidado_enfermagem_frequencia CHECK (frequencia_dia <= 48),
  CONSTRAINT ck_atividade_cuidado_enfermagem_horarios CHECK (
    horarios = '' OR horarios REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'),
  KEY ix_atividade_cuidado_enfermagem_atendimento (atendimento_id, estabelecimento_id),
  KEY ix_atividade_cuidado_enfermagem_estabelecimento (estabelecimento_id),
  KEY ix_atividade_cuidado_enfermagem_paciente (paciente_id),
  KEY ix_atividade_cuidado_enfermagem_processo (processo_enfermagem_id),
  KEY ix_atividade_cuidado_enfermagem_plano (plano_intervencao_enfermagem_id),
  KEY ix_atividade_cuidado_enfermagem_prescritor (prescritor_profissional_id),
  KEY ix_atividade_cuidado_enfermagem_suspensa_por (suspensa_por_profissional_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Atividade de cuidado prescrita pelo enfermeiro, com os horários do dia';

CREATE TABLE IF NOT EXISTS checagem_cuidado_enfermagem (
  id                                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id                BIGINT UNSIGNED NOT NULL,
  atendimento_id                    BIGINT UNSIGNED NOT NULL,
  atividade_cuidado_enfermagem_id   BIGINT UNSIGNED NOT NULL,
  previsto_em                       DATETIME(3) NOT NULL COMMENT 'Horário previsto da atividade',
  geracao                           SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Estornos anteriores do mesmo horário',
  feita                             BOOLEAN NOT NULL,
  motivo_nao_feita                  VARCHAR(500) NULL,
  realizada_em                      DATETIME(3) NOT NULL COMMENT 'Hora real informada por quem checou',
  origem_offline                    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Checagem feita sem rede e sincronizada depois',
  categoria                         VARCHAR(20) NOT NULL COMMENT 'Categoria de quem checou',
  profissional_id                   BIGINT UNSIGNED NOT NULL,
  origem                            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                         DATETIME(3) NOT NULL,
  criado_por                        BIGINT UNSIGNED NULL,
  alterado_em                       DATETIME(3) NULL,
  alterado_por                      BIGINT UNSIGNED NULL,
  versao                            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                       DATETIME(3) NULL,
  excluido_por                      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_checagem_cuidado_enfermagem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_checagem_cuidado_enfermagem_categoria CHECK (categoria IN ('enfermeiro','tecnico')),
  UNIQUE KEY uq_checagem_cuidado_enfermagem_horario (atividade_cuidado_enfermagem_id, previsto_em, geracao),
  KEY ix_checagem_cuidado_enfermagem_estabelecimento (estabelecimento_id),
  KEY ix_checagem_cuidado_enfermagem_atendimento (atendimento_id),
  KEY ix_checagem_cuidado_enfermagem_profissional (profissional_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Checagem de cada horário da atividade de cuidado (só de acréscimo)';

CREATE TABLE IF NOT EXISTS estorno_checagem_cuidado_enfermagem (
  id                                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id                BIGINT UNSIGNED NOT NULL,
  checagem_cuidado_enfermagem_id    BIGINT UNSIGNED NOT NULL,
  motivo                            VARCHAR(500) NOT NULL,
  categoria                         VARCHAR(20) NOT NULL COMMENT 'Categoria de quem estornou',
  profissional_id                   BIGINT UNSIGNED NOT NULL,
  origem                            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                         DATETIME(3) NOT NULL,
  criado_por                        BIGINT UNSIGNED NULL,
  alterado_em                       DATETIME(3) NULL,
  alterado_por                      BIGINT UNSIGNED NULL,
  versao                            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                       DATETIME(3) NULL,
  excluido_por                      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_estorno_checagem_cuidado_enfermagem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_estorno_checagem_cuidado_enfermagem_categoria CHECK (categoria IN ('enfermeiro','tecnico')),
  CONSTRAINT ck_estorno_checagem_cuidado_enfermagem_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) > 0),
  UNIQUE KEY uq_estorno_checagem_cuidado_enfermagem_checagem (checagem_cuidado_enfermagem_id),
  KEY ix_estorno_checagem_cuidado_enfermagem_estabelecimento (estabelecimento_id),
  KEY ix_estorno_checagem_cuidado_enfermagem_profissional (profissional_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estorno da checagem do cuidado, com a justificativa (só de acréscimo)';
