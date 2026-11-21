-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE pre_checkin
  ADD COLUMN IF NOT EXISTS conta_portal_paciente_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS dados_propostos LONGTEXT NULL COMMENT 'Alteração do cadastro proposta pelo paciente (JSON)',
  ADD COLUMN IF NOT EXISTS campos_gravados LONGTEXT NULL COMMENT 'Campos aceitos e gravados na conferência (JSON)',
  ADD COLUMN IF NOT EXISTS termos_versao VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS reservado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem reservou a conferência',
  ADD COLUMN IF NOT EXISTS reservado_em DATETIME(3) NULL,
  DROP CONSTRAINT IF EXISTS ck_pre_checkin_situacao,
  ADD CONSTRAINT ck_pre_checkin_situacao CHECK (situacao IN ('pendente','em_preenchimento','concluido','conferido','recusado','expirado','cancelado')),
  DROP CONSTRAINT IF EXISTS ck_pre_checkin_json,
  ADD CONSTRAINT ck_pre_checkin_json CHECK ((dados_propostos IS NULL OR JSON_VALID(dados_propostos)) AND (campos_gravados IS NULL OR JSON_VALID(campos_gravados))),
  DROP CONSTRAINT IF EXISTS ck_pre_checkin_reserva,
  ADD CONSTRAINT ck_pre_checkin_reserva CHECK ((reservado_em IS NULL) = (reservado_por_usuario_id IS NULL)),
  ADD KEY IF NOT EXISTS ix_pre_checkin_conta_portal_paciente (conta_portal_paciente_id),
  ADD KEY IF NOT EXISTS ix_pre_checkin_reservado_por (reservado_por_usuario_id);

CREATE TABLE pre_checkin_documento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pre_checkin_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  arquivo_id BIGINT UNSIGNED NOT NULL,
  resumo_conteudo CHAR(64) NOT NULL COMMENT 'SHA-256 do arquivo',
  tipo_midia VARCHAR(100) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_pre_checkin_documento_tipo CHECK (tipo IN ('documento_identidade','carteira_convenio','pedido_medico','comprovante_residencia','outro')),
  UNIQUE KEY uq_pre_checkin_documento_arquivo (pre_checkin_id, arquivo_id),
  KEY ix_pre_checkin_documento_arquivo (arquivo_id)
) COMMENT='Documento enviado no pré-checkin, com tipo, arquivo e resumo do conteúdo';

CREATE TABLE agenda_online_configuracao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  agenda_servico_id BIGINT UNSIGNED NOT NULL,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  antecedencia_horas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  horizonte_dias SMALLINT UNSIGNED NOT NULL,
  cancela_ate_horas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  pre_checkin BOOLEAN NOT NULL DEFAULT FALSE,
  valor_particular DECIMAL(12,2) NULL,
  teleconsulta BOOLEAN NOT NULL DEFAULT FALSE,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_agenda_online_configuracao_tipo CHECK (tipo IN ('consulta','exame')),
  CONSTRAINT ck_agenda_online_configuracao_valor CHECK (valor_particular IS NULL OR valor_particular >= 0),
  CONSTRAINT ck_agenda_online_configuracao_teleconsulta CHECK (tipo = 'consulta' OR NOT teleconsulta),
  CONSTRAINT ck_agenda_online_configuracao_horizonte CHECK (horizonte_dias BETWEEN 1 AND 730),
  UNIQUE KEY uq_agenda_online_configuracao_agenda (estabelecimento_id, tipo, agenda_servico_id),
  KEY ix_agenda_online_configuracao_agenda_servico (agenda_servico_id),
  CONSTRAINT ck_agenda_online_configuracao_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Configuração do agendamento pelo portal por agenda: antecedência, horizonte, cancelamento, pré-checkin e valor particular';

CREATE TABLE agenda_online_convenio (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agenda_online_configuracao_id BIGINT UNSIGNED NOT NULL,
  fonte_pagadora_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_agenda_online_convenio (agenda_online_configuracao_id, fonte_pagadora_id),
  KEY ix_agenda_online_convenio_fonte_pagadora (fonte_pagadora_id)
) COMMENT='Fonte pagadora aceita no agendamento pelo portal de uma agenda';

CREATE TABLE agenda_online_servico (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agenda_online_configuracao_id BIGINT UNSIGNED NOT NULL,
  especialidade_medica_id BIGINT UNSIGNED NULL,
  exame_id BIGINT UNSIGNED NULL,
  especialidade_chave BIGINT UNSIGNED AS (IFNULL(especialidade_medica_id, 0)) PERSISTENT COMMENT 'Só para a unicidade',
  exame_chave BIGINT UNSIGNED AS (IFNULL(exame_id, 0)) PERSISTENT COMMENT 'Só para a unicidade',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_agenda_online_servico_alvo CHECK ((especialidade_medica_id IS NULL) + (exame_id IS NULL) = 1),
  UNIQUE KEY uq_agenda_online_servico (agenda_online_configuracao_id, especialidade_chave, exame_chave),
  KEY ix_agenda_online_servico_especialidade (especialidade_medica_id),
  KEY ix_agenda_online_servico_exame (exame_id)
) COMMENT='Especialidade ou exame oferecido no agendamento pelo portal de uma agenda';

