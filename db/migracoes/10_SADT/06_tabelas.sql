-- SADT, lote 06 (F2.2 onda 2; pedidos dos lotes 02-04, 02-05): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (06_chaves.sql).

CREATE TABLE requisicao_transfusao_versao (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  requisicao_transfusao_id BIGINT UNSIGNED NOT NULL,
  numero_versao            SMALLINT UNSIGNED NOT NULL COMMENT 'Versão guardada (1 = a original)',
  hemocomponente_id        BIGINT UNSIGNED NOT NULL,
  volume_ml                INT UNSIGNED NULL,
  tipo_transfusao_id       BIGINT UNSIGNED NOT NULL,
  programada_para          DATETIME(3) NULL,
  motivo                   VARCHAR(300) NOT NULL COMMENT 'Por que a requisição foi alterada',
  alterada_em              DATETIME(3) NOT NULL,
  alterada_por_usuario_id  BIGINT UNSIGNED NOT NULL,
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_requisicao_transfusao_versao_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) >= 5),
  CONSTRAINT ck_requisicao_transfusao_versao_volume CHECK (volume_ml IS NULL OR volume_ml BETWEEN 1 AND 5000),
  UNIQUE KEY uq_requisicao_transfusao_versao_numero (requisicao_transfusao_id, numero_versao)
) COMMENT='Versão anterior da requisição transfusional alterada antes do atendimento (legível, com o motivo)';

CREATE TABLE ato_transfusional_adendo (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ato_transfusional_id     BIGINT UNSIGNED NOT NULL,
  monitoramento_transfusao_id BIGINT UNSIGNED NOT NULL COMMENT 'A medida corrigida (que não muda)',
  pressao_sistolica        SMALLINT UNSIGNED NOT NULL,
  pressao_diastolica       SMALLINT UNSIGNED NOT NULL,
  frequencia_cardiaca      SMALLINT UNSIGNED NOT NULL,
  temperatura              DECIMAL(4,1) NOT NULL,
  frequencia_respiratoria  SMALLINT UNSIGNED NULL,
  saturacao_oxigenio       SMALLINT UNSIGNED NULL,
  motivo                   VARCHAR(300) NOT NULL,
  profissional_id          BIGINT UNSIGNED NOT NULL,
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_ato_transfusional_adendo_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) >= 5),
  CONSTRAINT ck_ato_transfusional_adendo_sinais CHECK (pressao_sistolica BETWEEN 40 AND 300 AND pressao_diastolica BETWEEN 20 AND 200 AND frequencia_cardiaca BETWEEN 20 AND 250 AND temperatura BETWEEN 30 AND 43 AND (frequencia_respiratoria IS NULL OR frequencia_respiratoria BETWEEN 4 AND 70) AND (saturacao_oxigenio IS NULL OR saturacao_oxigenio BETWEEN 50 AND 100)),
  KEY ix_ato_transfusional_adendo_ato (ato_transfusional_id),
  KEY ix_ato_transfusional_adendo_monitoramento (monitoramento_transfusao_id),
  KEY ix_ato_transfusional_adendo_profissional (profissional_id)
) COMMENT='Adendo dos sinais vitais do ato transfusional digitados errado (a medida original fica)';

ALTER TABLE teste_imuno_hematologico
  ADD COLUMN estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Estabelecimento que registrou o exame',
  ADD COLUMN motivo_invalidacao VARCHAR(500) NULL,
  ADD CONSTRAINT ck_teste_imuno_hematologico_invalidacao CHECK (situacao <> 'invalidado' OR motivo_invalidacao IS NOT NULL),
  ADD KEY ix_teste_imuno_hematologico_estabelecimento (estabelecimento_id);

ALTER TABLE tipo_movimento_bolsa
  DROP CONSTRAINT ck_tipo_movimento_bolsa_natureza,
  ADD CONSTRAINT ck_tipo_movimento_bolsa_natureza CHECK (natureza IN ('entrada','reserva','liberacao','transfusao','devolucao','descarte','perda','transferencia','bloqueio','desbloqueio','correcao'));

ALTER TABLE ato_transfusional
  ADD COLUMN alertas_conferencia JSON NULL COMMENT 'Alertas da dupla checagem aceitos no início (códigos)' AFTER justificativa_rh,
  ADD CONSTRAINT ck_ato_transfusional_alertas CHECK (alertas_conferencia IS NULL OR JSON_VALID(alertas_conferencia));
