-- Recusas da carga (fase 2, K1): o exame do laboratório de apoio que não se liga a um exame do cadastro entra inativo,
-- sem o exame, até o hospital ligá-lo (continuidade, ADR 0006). O ativo exige o exame. Idempotente (ADR 0002).
ALTER TABLE exame_laboratorio_apoio
  MODIFY COLUMN exame_id BIGINT UNSIGNED NULL COMMENT 'Exame do cadastro; nulo só no exame de apoio inativo ainda não ligado',
  DROP CONSTRAINT IF EXISTS ck_exame_laboratorio_apoio_exame;
ALTER TABLE exame_laboratorio_apoio
  ADD CONSTRAINT ck_exame_laboratorio_apoio_exame CHECK (exame_id IS NOT NULL OR ativo = FALSE);
