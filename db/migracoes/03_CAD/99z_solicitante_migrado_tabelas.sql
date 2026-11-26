-- Recusas da carga (fase 2, K1): solicitante externo migrado. Só relaxa no registro migrado (col IS NOT NULL OR origem = 'migracao', precedente 06_PEP/40_tabelas.sql); no sistema a
-- obrigatoriedade continua. Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de
-- recriar, MODIFY repetível, ADD COLUMN IF NOT EXISTS.

-- A UF do conselho falta em parte dos solicitantes da origem; o novo cadastro continua exigindo.
ALTER TABLE solicitante_externo
  MODIFY COLUMN conselho_unidade_federativa_id BIGINT UNSIGNED NULL COMMENT 'UF do registro no conselho; nula só no solicitante migrado sem UF',
  DROP CONSTRAINT IF EXISTS ck_solicitante_externo_conselho_uf;
ALTER TABLE solicitante_externo
  ADD CONSTRAINT ck_solicitante_externo_conselho_uf CHECK (conselho_unidade_federativa_id IS NOT NULL OR origem = 'migracao');
