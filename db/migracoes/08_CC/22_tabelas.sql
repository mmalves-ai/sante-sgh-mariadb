-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

-- Avaliação pré-anestésica: a última ingestão de cada tipo (a regra de jejum compara cada uma com o seu prazo).
ALTER TABLE avaliacao_pre_anestesica
  ADD COLUMN IF NOT EXISTS ultimo_liquido_claro_em DATETIME(3) NULL COMMENT 'Última ingestão de líquidos claros' AFTER tipo_ultima_ingestao,
  ADD COLUMN IF NOT EXISTS ultimo_leite_materno_em DATETIME(3) NULL COMMENT 'Última ingestão de leite materno' AFTER ultimo_liquido_claro_em,
  ADD COLUMN IF NOT EXISTS ultima_refeicao_leve_em DATETIME(3) NULL COMMENT 'Última refeição leve' AFTER ultimo_leite_materno_em,
  ADD COLUMN IF NOT EXISTS ultima_refeicao_gordurosa_em DATETIME(3) NULL COMMENT 'Última refeição gordurosa' AFTER ultima_refeicao_leve_em;

-- Avaliação da recuperação pós-anestésica: sinais vitais e a versão da regra de alta usada.
ALTER TABLE avaliacao_recuperacao_anestesica
  ADD COLUMN IF NOT EXISTS pressao_sistolica SMALLINT UNSIGNED NULL AFTER temperatura,
  ADD COLUMN IF NOT EXISTS pressao_diastolica SMALLINT UNSIGNED NULL AFTER pressao_sistolica,
  ADD COLUMN IF NOT EXISTS frequencia_cardiaca SMALLINT UNSIGNED NULL AFTER pressao_diastolica,
  ADD COLUMN IF NOT EXISTS saturacao_oxigenio TINYINT UNSIGNED NULL AFTER frequencia_cardiaca,
  ADD COLUMN IF NOT EXISTS regra_alta_versao SMALLINT UNSIGNED NULL COMMENT 'Versão da regra de alta usada na avaliação' AFTER saturacao_oxigenio,
  DROP CONSTRAINT IF EXISTS ck_avaliacao_recuperacao_anestesica_pressao,
  ADD CONSTRAINT ck_avaliacao_recuperacao_anestesica_pressao CHECK ((pressao_sistolica IS NULL OR pressao_sistolica BETWEEN 20 AND 300) AND (pressao_diastolica IS NULL OR pressao_diastolica BETWEEN 10 AND 250) AND (pressao_sistolica IS NULL OR pressao_diastolica IS NULL OR pressao_sistolica > pressao_diastolica)),
  DROP CONSTRAINT IF EXISTS ck_avaliacao_recuperacao_anestesica_frequencia,
  ADD CONSTRAINT ck_avaliacao_recuperacao_anestesica_frequencia CHECK (frequencia_cardiaca IS NULL OR frequencia_cardiaca BETWEEN 20 AND 250),
  DROP CONSTRAINT IF EXISTS ck_avaliacao_recuperacao_anestesica_saturacao,
  ADD CONSTRAINT ck_avaliacao_recuperacao_anestesica_saturacao CHECK (saturacao_oxigenio IS NULL OR saturacao_oxigenio <= 100);

-- Alta da recuperação: a escala de náusea e vômito vai de 0 a 3, como na avaliação.
ALTER TABLE registro_recuperacao_anestesica
  MODIFY COLUMN nausea_vomito_alta TINYINT UNSIGNED NULL COMMENT 'Náusea e vômito na alta (0 ausente a 3 intenso)',
  DROP CONSTRAINT IF EXISTS ck_registro_recuperacao_anestesica_nausea,
  ADD CONSTRAINT ck_registro_recuperacao_anestesica_nausea CHECK (nausea_vomito_alta IS NULL OR nausea_vomito_alta <= 3);

-- Lançamento de procedimento na ficha anestésica: o procedimento do cadastro, além da descrição.
ALTER TABLE lancamento_ficha_anestesica
  ADD COLUMN IF NOT EXISTS procedimento_cirurgico_id BIGINT UNSIGNED NULL COMMENT 'Procedimento do cadastro (parte procedimento)' AFTER exame_id,
  ADD KEY IF NOT EXISTS ix_lancamento_ficha_anestesica_procedimento_cirurgico (procedimento_cirurgico_id),
  DROP CONSTRAINT IF EXISTS ck_lancamento_ficha_anestesica_procedimento,
  ADD CONSTRAINT ck_lancamento_ficha_anestesica_procedimento CHECK (procedimento_cirurgico_id IS NULL OR parte = 'procedimento');
