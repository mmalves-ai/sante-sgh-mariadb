-- Recusas da carga (fase 2, K1): trilha de impressão e exportação de documentos migrada. Só relaxa no registro migrado (col IS NOT NULL OR origem = 'migracao', precedente 06_PEP/40_tabelas.sql); no sistema a
-- obrigatoriedade continua. Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de
-- recriar, MODIFY repetível, ADD COLUMN IF NOT EXISTS.

-- O autor da impressão é o profissional; o login (usuário) falta em parte dos profissionais da origem.
ALTER TABLE exportacao_documento
  ADD COLUMN IF NOT EXISTS profissional_id BIGINT UNSIGNED NULL COMMENT 'Profissional que imprimiu ou exportou' AFTER usuario_id,
  ADD COLUMN IF NOT EXISTS origem VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  MODIFY COLUMN usuario_id BIGINT UNSIGNED NULL COMMENT 'Usuário que imprimiu ou exportou; nulo só no registro migrado de profissional sem login',
  ADD KEY IF NOT EXISTS ix_exportacao_documento_profissional (profissional_id),
  DROP CONSTRAINT IF EXISTS ck_exportacao_documento_origem,
  DROP CONSTRAINT IF EXISTS ck_exportacao_documento_autor;
ALTER TABLE exportacao_documento
  ADD CONSTRAINT ck_exportacao_documento_origem CHECK (origem IN ('sistema','migracao','integracao')),
  ADD CONSTRAINT ck_exportacao_documento_autor CHECK (usuario_id IS NOT NULL OR (origem = 'migracao' AND profissional_id IS NOT NULL));
