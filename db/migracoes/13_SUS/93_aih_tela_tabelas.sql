-- Faturamento SUS, AIH pela tela na porta própria (família sus-aih, modulos-proprios-2, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no serviço e na porta.
--   - autorizacao_internacao_sus: o médico solicitante do laudo (profissional da casa ou solicitante externo, como no
--     laudo_internacao_sus) e a justificativa do laudo como a tela a registrou. O CNS do autorizador já existe.
ALTER TABLE autorizacao_internacao_sus
  ADD COLUMN IF NOT EXISTS solicitante_profissional_id BIGINT UNSIGNED NULL COMMENT 'Médico solicitante do laudo (profissional da casa)' AFTER carater_dominio_sus_id,
  ADD COLUMN IF NOT EXISTS solicitante_externo_id BIGINT UNSIGNED NULL COMMENT 'Médico solicitante do laudo (solicitante externo)' AFTER solicitante_profissional_id,
  ADD COLUMN IF NOT EXISTS justificativa_laudo VARCHAR(2000) NULL COMMENT 'Justificativa da internação registrada no laudo' AFTER solicitante_externo_id,
  ADD KEY IF NOT EXISTS ix_autorizacao_internacao_sus_solicitante_profissional_id (solicitante_profissional_id),
  ADD KEY IF NOT EXISTS ix_autorizacao_internacao_sus_solicitante_externo_id (solicitante_externo_id),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_internacao_sus_solicitante_unico,
  ADD CONSTRAINT ck_autorizacao_internacao_sus_solicitante_unico CHECK (solicitante_profissional_id IS NULL OR solicitante_externo_id IS NULL);
