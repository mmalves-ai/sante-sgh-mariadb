-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Profilaxia de TEV (tromboembolismo venoso): a anulação da decisão fica dita na coluna (a retificação continua
-- exigindo a justificativa pelo ck_profilaxia_tev_decisao_justificativa).
ALTER TABLE profilaxia_tev_decisao
  DROP CONSTRAINT IF EXISTS ck_profilaxia_tev_decisao_decisao,
  ADD CONSTRAINT ck_profilaxia_tev_decisao_decisao CHECK (decisao IN ('aceita','modificada','recusada','anulada'));

-- Exame oftalmológico consolidado: os tipos de exame ficam nos itens; os alertas da gravação (que dependem do limite
-- de pressão intraocular vigente no estabelecimento) ficam guardados, porque não se recalculam na leitura.
ALTER TABLE exame_oftalmologico
  MODIFY COLUMN tipo_exame_oftalmologico_id BIGINT UNSIGNED NULL COMMENT 'Tipo do exame avulso; nulo no exame consolidado, cujos tipos estão em exame_oftalmologico_item',
  ADD COLUMN IF NOT EXISTS alertas LONGTEXT NULL COMMENT 'Alertas calculados na gravação (JSON), com o limite vigente na hora',
  DROP CONSTRAINT IF EXISTS ck_exame_oftalmologico_alertas,
  ADD CONSTRAINT ck_exame_oftalmologico_alertas CHECK (alertas IS NULL OR json_valid(alertas));

CREATE TABLE IF NOT EXISTS exame_oftalmologico_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  exame_oftalmologico_id BIGINT UNSIGNED NOT NULL,
  sequencia SMALLINT UNSIGNED NOT NULL,
  tipo_exame_oftalmologico_id BIGINT UNSIGNED NOT NULL,
  olho VARCHAR(10) NOT NULL COMMENT 'direito, esquerdo ou ambos',
  resultado VARCHAR(500) NOT NULL COMMENT 'Resultado descritivo do tipo de exame',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_exame_oftalmologico_item_olho CHECK (olho IN ('direito','esquerdo','ambos')),
  UNIQUE KEY uq_exame_oftalmologico_item_sequencia (exame_oftalmologico_id, sequencia),
  KEY ix_exame_oftalmologico_item_tipo (tipo_exame_oftalmologico_id)
) COMMENT='Itens do exame oftalmológico consolidado: um resultado por tipo de exame e olho';

ALTER TABLE exame_oftalmologico_valor
  ADD COLUMN IF NOT EXISTS acuidade_visual_id BIGINT UNSIGNED NULL COMMENT 'Acuidade do cadastro (com ou sem correção, pela coluna correcao)' AFTER valor_texto,
  ADD KEY IF NOT EXISTS ix_exame_oftalmologico_valor_acuidade (acuidade_visual_id);

-- Protocolo de quimioterapia: o fármaco pelo nome genérico (DCB, Denominação Comum Brasileira) quando ainda não há
-- item prescritível; a unidade da dose (fixa e AUC, área sob a curva, precisam dela) e a forma de administração.
ALTER TABLE protocolo_quimioterapia_droga
  MODIFY COLUMN item_prescritivel_id BIGINT UNSIGNED NULL COMMENT 'Item prescritível; nulo enquanto o fármaco é só o nome genérico',
  MODIFY COLUMN unidade_prescricao_id BIGINT UNSIGNED NULL COMMENT 'Unidade de prescrição do item; nula com o nome genérico',
  ADD COLUMN IF NOT EXISTS nome_generico VARCHAR(60) NULL COMMENT 'Nome genérico do fármaco (DCB)' AFTER item_prescritivel_id,
  ADD COLUMN IF NOT EXISTS unidade_dose VARCHAR(10) NULL COMMENT 'mg/m2, mg/kg, auc ou mg' AFTER base_dose,
  ADD COLUMN IF NOT EXISTS administracao VARCHAR(120) NULL COMMENT 'Forma de administração (ex.: em bólus, infusão contínua)' AFTER via_de_uso_id,
  DROP CONSTRAINT IF EXISTS ck_protocolo_quimioterapia_droga_farmaco,
  ADD CONSTRAINT ck_protocolo_quimioterapia_droga_farmaco CHECK (item_prescritivel_id IS NOT NULL OR nome_generico IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_protocolo_quimioterapia_droga_unidade_prescricao,
  ADD CONSTRAINT ck_protocolo_quimioterapia_droga_unidade_prescricao CHECK (item_prescritivel_id IS NULL OR unidade_prescricao_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_protocolo_quimioterapia_droga_unidade_dose,
  ADD CONSTRAINT ck_protocolo_quimioterapia_droga_unidade_dose CHECK (unidade_dose IS NULL OR unidade_dose IN ('mg/m2','mg/kg','auc','mg'));
