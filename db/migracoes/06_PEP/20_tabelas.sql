-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE registro_nascimento
  ADD COLUMN IF NOT EXISTS reanimacao_neonatal BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Houve reanimação neonatal',
  ADD COLUMN IF NOT EXISTS observacao VARCHAR(300) NULL;
ALTER TABLE ciclo_quimioterapia
  ADD COLUMN IF NOT EXISTS creatinina_mg_dl DECIMAL(5,2) NULL,
  ADD COLUMN IF NOT EXISTS reducao_dose_percentual TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_reducao VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS justificativa_intervalo VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS validado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Farmacêutico que validou o ciclo',
  ADD COLUMN IF NOT EXISTS validado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS observacao_validacao VARCHAR(300) NULL,
  DROP CONSTRAINT IF EXISTS ck_ciclo_quimioterapia_reducao,
  ADD CONSTRAINT ck_ciclo_quimioterapia_reducao CHECK (reducao_dose_percentual <= 75 AND (reducao_dose_percentual = 0 OR motivo_reducao IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_ciclo_quimioterapia_validacao,
  ADD CONSTRAINT ck_ciclo_quimioterapia_validacao CHECK ((validado_em IS NULL) = (validado_por_usuario_id IS NULL)),
  DROP CONSTRAINT IF EXISTS ck_ciclo_quimioterapia_creatinina,
  ADD CONSTRAINT ck_ciclo_quimioterapia_creatinina CHECK (creatinina_mg_dl IS NULL OR creatinina_mg_dl > 0),
  ADD KEY IF NOT EXISTS ix_ciclo_quimioterapia_validado_por (validado_por_usuario_id);
ALTER TABLE protocolo_quimioterapia
  ADD COLUMN IF NOT EXISTS versao_protocolo SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Versão publicada do protocolo (imutável)',
  ADD COLUMN IF NOT EXISTS hash_conteudo CHAR(64) NULL COMMENT 'SHA-256 do conteúdo publicado; nulo só nos protocolos anteriores à versão',
  ADD COLUMN IF NOT EXISTS revogado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS motivo_revogacao VARCHAR(200) NULL,
  DROP CONSTRAINT IF EXISTS ck_protocolo_quimioterapia_revogacao,
  ADD CONSTRAINT ck_protocolo_quimioterapia_revogacao CHECK (revogado_em IS NULL OR motivo_revogacao IS NOT NULL),
  ADD UNIQUE KEY IF NOT EXISTS uq_protocolo_quimioterapia_codigo_versao (codigo, versao_protocolo),
  ADD UNIQUE KEY IF NOT EXISTS uq_protocolo_quimioterapia_hash (hash_conteudo),
  DROP INDEX IF EXISTS uq_protocolo_quimioterapia_codigo;
ALTER TABLE avaliacao_farmaceutica_item
  DROP CONSTRAINT IF EXISTS ck_avaliacao_farmaceutica_item_parecer,
  ADD CONSTRAINT ck_avaliacao_farmaceutica_item_parecer CHECK (parecer IN ('aprovado','aprovado_com_ressalva','recusado','substituido','revisao_medica')),
  DROP CONSTRAINT IF EXISTS ck_avaliacao_farmaceutica_item_justificativa,
  ADD CONSTRAINT ck_avaliacao_farmaceutica_item_justificativa CHECK (parecer NOT IN ('aprovado_com_ressalva','recusado','revisao_medica') OR justificativa IS NOT NULL);
ALTER TABLE exame_oftalmologico
  ADD COLUMN IF NOT EXISTS classificacao_visual VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS conduta VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS internacao_id BIGINT UNSIGNED NULL,
  DROP CONSTRAINT IF EXISTS ck_exame_oftalmologico_classificacao_visual,
  ADD CONSTRAINT ck_exame_oftalmologico_classificacao_visual CHECK (classificacao_visual IS NULL OR classificacao_visual IN ('normal','reduzida','baixa_visao','cegueira','sem_dado')),
  ADD KEY IF NOT EXISTS ix_exame_oftalmologico_internacao (internacao_id);
ALTER TABLE exame_oftalmologico_valor
  DROP CONSTRAINT IF EXISTS ck_exame_oftalmologico_valor_medida,
  ADD CONSTRAINT ck_exame_oftalmologico_valor_medida CHECK (medida IN ('acuidade_visual','pressao_intraocular','esferico','cilindrico','eixo','adicao','ceratometria','distancia_pupilar','paquimetria','gonioscopia','outro'));
ALTER TABLE receita_medica
  ADD COLUMN IF NOT EXISTS protocolo_receita_enfermagem_id BIGINT UNSIGNED NULL COMMENT 'Protocolo institucional que autoriza a receita do enfermeiro',
  ADD KEY IF NOT EXISTS ix_receita_medica_protocolo_receita_enfermagem (protocolo_receita_enfermagem_id);

CREATE TABLE ciclo_quimioterapia_prescricao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ciclo_quimioterapia_id BIGINT UNSIGNED NOT NULL,
  prescricao_id BIGINT UNSIGNED NOT NULL,
  ligado_em DATETIME(3) NOT NULL,
  desligado_em DATETIME(3) NULL,
  motivo_desligamento VARCHAR(200) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_ciclo_quimioterapia_prescricao_desligamento CHECK (desligado_em IS NULL OR motivo_desligamento IS NOT NULL),
  UNIQUE KEY uq_ciclo_quimioterapia_prescricao_par (ciclo_quimioterapia_id, prescricao_id),
  KEY ix_ciclo_quimioterapia_prescricao_prescricao (prescricao_id)
) COMMENT='Prescrição ligada a um ciclo de quimioterapia, com desligamento e motivo';

CREATE TABLE evento_tratamento_oncologico (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  protocolo_quimioterapia_id BIGINT UNSIGNED NULL,
  ciclo_quimioterapia_id BIGINT UNSIGNED NULL,
  prescricao_id BIGINT UNSIGNED NULL,
  evento VARCHAR(30) NOT NULL,
  categoria VARCHAR(30) NULL COMMENT 'Categoria do motivo',
  ciclos_afetados SMALLINT UNSIGNED NULL,
  versao_anterior LONGTEXT NULL COMMENT 'Ciclo antes do ajuste (JSON)',
  motivo VARCHAR(300) NOT NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_evento_tratamento_oncologico_evento CHECK (evento IN ('versao_revogada','protocolo_inativado','protocolo_reativado','ciclo_ajustado','ciclo_suspenso','ciclo_retomado','ciclo_cancelado','prescricao_desligada')),
  CONSTRAINT ck_evento_tratamento_oncologico_alvo CHECK (protocolo_quimioterapia_id IS NOT NULL OR ciclo_quimioterapia_id IS NOT NULL),
  CONSTRAINT ck_evento_tratamento_oncologico_versao CHECK (versao_anterior IS NULL OR JSON_VALID(versao_anterior)),
  KEY ix_evento_tratamento_oncologico_estabelecimento (estabelecimento_id, ocorrido_em),
  KEY ix_evento_tratamento_oncologico_protocolo (protocolo_quimioterapia_id),
  KEY ix_evento_tratamento_oncologico_ciclo (ciclo_quimioterapia_id),
  KEY ix_evento_tratamento_oncologico_prescricao (prescricao_id),
  KEY ix_evento_tratamento_oncologico_usuario (usuario_id)
) COMMENT='Evento do protocolo ou do ciclo de quimioterapia (revogação, suspensão, ajuste, desligamento), com motivo e versão anterior';

CREATE TABLE acuidade_visual (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL,
  rotulo VARCHAR(60) NOT NULL,
  valor_decimal DECIMAL(5,3) NULL,
  tipo VARCHAR(20) NOT NULL,
  ordem SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_acuidade_visual_tipo CHECK (tipo IN ('snellen','decimal','logmar','qualitativa')),
  UNIQUE KEY uq_acuidade_visual_codigo (codigo)
) COMMENT='Valores de acuidade visual oferecidos no exame oftalmológico (Snellen, decimal, logMAR ou qualitativo)';

CREATE TABLE graduacao_oftalmologica (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sigla VARCHAR(10) NOT NULL,
  descricao VARCHAR(150) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_graduacao_oftalmologica_sigla (sigla)
) COMMENT='Graduações usadas nos achados do exame oftalmológico (sigla e descrição)';

CREATE TABLE profilaxia_tev_decisao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profilaxia_tev_avaliacao_id BIGINT UNSIGNED NOT NULL,
  operacao VARCHAR(20) NOT NULL COMMENT 'decisao ou retificacao',
  decisao VARCHAR(20) NOT NULL,
  justificativa VARCHAR(500) NULL,
  prescricao_item_id BIGINT UNSIGNED NULL,
  dados LONGTEXT NULL COMMENT 'Detalhe da decisão (JSON)',
  ocorrido_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_profilaxia_tev_decisao_operacao CHECK (operacao IN ('decisao','retificacao')),
  CONSTRAINT ck_profilaxia_tev_decisao_decisao CHECK (decisao IN ('aceita','modificada','recusada')),
  CONSTRAINT ck_profilaxia_tev_decisao_justificativa CHECK ((decisao = 'aceita' AND operacao = 'decisao') OR justificativa IS NOT NULL),
  CONSTRAINT ck_profilaxia_tev_decisao_dados CHECK (dados IS NULL OR JSON_VALID(dados)),
  KEY ix_profilaxia_tev_decisao_avaliacao (profilaxia_tev_avaliacao_id, ocorrido_em),
  KEY ix_profilaxia_tev_decisao_prescricao_item (prescricao_item_id),
  KEY ix_profilaxia_tev_decisao_usuario (usuario_id)
) COMMENT='Decisão do prescritor sobre a profilaxia de tromboembolismo sugerida pela avaliação, com retificação';

CREATE TABLE contencao_paciente_avaliacao_adendo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contencao_paciente_avaliacao_id BIGINT UNSIGNED NOT NULL,
  texto VARCHAR(2000) NOT NULL,
  dados LONGTEXT NULL COMMENT 'Detalhe do adendo (JSON)',
  ocorrido_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_contencao_paciente_avaliacao_adendo_dados CHECK (dados IS NULL OR JSON_VALID(dados)),
  KEY ix_contencao_paciente_avaliacao_adendo_avaliacao (contencao_paciente_avaliacao_id),
  KEY ix_contencao_paciente_avaliacao_adendo_usuario (usuario_id)
) COMMENT='Adendo do autor à checagem da contenção do paciente (a checagem não muda)';

CREATE TABLE protocolo_receita_enfermagem (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  codigo VARCHAR(30) NOT NULL,
  descricao VARCHAR(300) NOT NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_protocolo_receita_enfermagem_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_protocolo_receita_enfermagem_codigo (estabelecimento_id, codigo),
  CONSTRAINT ck_protocolo_receita_enfermagem_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Protocolo institucional que autoriza o enfermeiro a receitar, com vigência';

CREATE TABLE protocolo_receita_enfermagem_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  protocolo_receita_enfermagem_id BIGINT UNSIGNED NOT NULL,
  item_prescritivel_id BIGINT UNSIGNED NOT NULL,
  dose_maxima DECIMAL(15,4) NULL,
  observacao VARCHAR(300) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_protocolo_receita_enfermagem_item_dose CHECK (dose_maxima IS NULL OR dose_maxima > 0),
  UNIQUE KEY uq_protocolo_receita_enfermagem_item (protocolo_receita_enfermagem_id, item_prescritivel_id),
  KEY ix_protocolo_receita_enfermagem_item_item (item_prescritivel_id)
) COMMENT='Item que o protocolo de receita do enfermeiro permite, com dose máxima';

