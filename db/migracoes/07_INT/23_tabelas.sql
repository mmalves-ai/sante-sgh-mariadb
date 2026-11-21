-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Precaução (isolamento) da CCIH (comissão de controle de infecção hospitalar): motivo codificado, origem da
-- indicação, cultura que indicou, multirresistente e motivo do encerramento como código (a tabela estava vazia em
-- todos os clientes de dev e teste).
ALTER TABLE isolamento_paciente
  ADD COLUMN IF NOT EXISTS motivo_precaucao VARCHAR(30) NOT NULL COMMENT 'Motivo da precaução (microrganismo ou doença)' AFTER tipo_precaucao_id,
  ADD COLUMN IF NOT EXISTS motivo_outro VARCHAR(200) NULL COMMENT 'Descrição do motivo quando é outro' AFTER motivo_precaucao,
  ADD COLUMN IF NOT EXISTS origem_indicacao VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT 'manual (CCIH ou assistente) ou microbiologia (cultura)' AFTER motivo_outro,
  ADD COLUMN IF NOT EXISTS exame_item_id BIGINT UNSIGNED NULL COMMENT 'Cultura que indicou a precaução' AFTER origem_indicacao,
  ADD COLUMN IF NOT EXISTS multirresistente BOOLEAN NOT NULL DEFAULT FALSE AFTER exame_item_id,
  MODIFY COLUMN motivo_encerramento VARCHAR(30) NULL COMMENT 'Motivo do encerramento (código)',
  DROP CONSTRAINT IF EXISTS ck_isolamento_paciente_motivo_precaucao,
  ADD CONSTRAINT ck_isolamento_paciente_motivo_precaucao CHECK (motivo_precaucao IN ('kpc','mrsa','vre','acinetobacter','outro_multirresistente','clostridioides','tuberculose','varicela_sarampo','influenza','meningite','outro')),
  DROP CONSTRAINT IF EXISTS ck_isolamento_paciente_motivo_outro,
  ADD CONSTRAINT ck_isolamento_paciente_motivo_outro CHECK (motivo_precaucao <> 'outro' OR motivo_outro IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_isolamento_paciente_origem_indicacao,
  ADD CONSTRAINT ck_isolamento_paciente_origem_indicacao CHECK (origem_indicacao IN ('manual','microbiologia')),
  DROP CONSTRAINT IF EXISTS ck_isolamento_paciente_motivo_encerramento,
  ADD CONSTRAINT ck_isolamento_paciente_motivo_encerramento CHECK (motivo_encerramento IS NULL OR motivo_encerramento IN ('culturas_negativas','fim_do_periodo','reavaliacao','alta','obito')),
  ADD KEY IF NOT EXISTS ix_isolamento_paciente_exame_item (exame_item_id);
