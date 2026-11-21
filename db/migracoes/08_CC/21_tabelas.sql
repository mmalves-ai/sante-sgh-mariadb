-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE ato_cirurgico
  ADD COLUMN IF NOT EXISTS classificacao_asa_id BIGINT UNSIGNED NULL COMMENT 'Estado físico do paciente (ASA) registrado no ato',
  ADD COLUMN IF NOT EXISTS pressao_sistolica SMALLINT UNSIGNED NULL COMMENT 'mmHg',
  ADD COLUMN IF NOT EXISTS pressao_diastolica SMALLINT UNSIGNED NULL COMMENT 'mmHg',
  ADD COLUMN IF NOT EXISTS frequencia_cardiaca SMALLINT UNSIGNED NULL COMMENT 'Batimentos por minuto',
  DROP CONSTRAINT IF EXISTS ck_ato_cirurgico_frequencia_cardiaca,
  ADD CONSTRAINT ck_ato_cirurgico_frequencia_cardiaca CHECK (frequencia_cardiaca IS NULL OR frequencia_cardiaca BETWEEN 20 AND 250),
  DROP CONSTRAINT IF EXISTS ck_ato_cirurgico_pressao,
  ADD CONSTRAINT ck_ato_cirurgico_pressao CHECK ((pressao_sistolica IS NULL OR pressao_sistolica BETWEEN 20 AND 300) AND (pressao_diastolica IS NULL OR pressao_diastolica BETWEEN 10 AND 250) AND (pressao_sistolica IS NULL OR pressao_diastolica IS NULL OR pressao_sistolica > pressao_diastolica)),
  ADD KEY IF NOT EXISTS ix_ato_cirurgico_classificacao_asa (classificacao_asa_id);
ALTER TABLE ato_cirurgico_procedimento
  ADD COLUMN IF NOT EXISTS especialidade_medica_id BIGINT UNSIGNED NULL COMMENT 'Especialidade do procedimento no ato',
  ADD KEY IF NOT EXISTS ix_ato_cirurgico_procedimento_especialidade (especialidade_medica_id);

CREATE TABLE IF NOT EXISTS ato_cirurgico_dispositivo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ato_cirurgico_id BIGINT UNSIGNED NOT NULL,
  dispositivo VARCHAR(30) NOT NULL,
  descricao VARCHAR(35) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_ato_cirurgico_dispositivo_dispositivo CHECK (dispositivo IN ('tubo','antimicrobiano','sonda','cateter','puncao')),
  UNIQUE KEY uq_ato_cirurgico_dispositivo (ato_cirurgico_id, dispositivo)
) COMMENT='Dispositivos usados no ato cirúrgico (tubo, antimicrobiano, sonda, cateter, punção), com descrição';
