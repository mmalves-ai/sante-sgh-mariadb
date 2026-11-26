-- Recusas da carga (fase 2, K1): profissional de higienização migrado. Só relaxa no registro migrado (col IS NOT NULL OR origem = 'migracao', precedente 06_PEP/40_tabelas.sql); no sistema a
-- obrigatoriedade continua. Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de
-- recriar, MODIFY repetível, ADD COLUMN IF NOT EXISTS.

-- O vínculo (colaborador próprio ou empresa terceirizada) pode não estar ligado no profissional migrado.
ALTER TABLE profissional_higienizacao DROP CONSTRAINT IF EXISTS ck_profissional_higienizacao_vinculo;
ALTER TABLE profissional_higienizacao
  ADD CONSTRAINT ck_profissional_higienizacao_vinculo CHECK ((vinculo = 'proprio' AND colaborador_id IS NOT NULL) OR (vinculo = 'terceirizado' AND empresa_fornecedora_id IS NOT NULL) OR origem = 'migracao');
