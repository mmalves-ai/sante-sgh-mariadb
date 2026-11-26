-- Recusas da carga (fase 2, K1): rubrica da folha migrada. Só relaxa no registro migrado (col IS NOT NULL OR origem = 'migracao', precedente 06_PEP/40_tabelas.sql); no sistema a
-- obrigatoriedade continua. Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de
-- recriar, MODIFY repetível, ADD COLUMN IF NOT EXISTS.

-- A natureza da rubrica (tabela do eSocial) pode faltar na migrada; o domínio barra o envio da tabela de rubricas
-- ao eSocial enquanto ela faltar.
ALTER TABLE rubrica
  MODIFY COLUMN natureza_rubrica_id BIGINT UNSIGNED NULL COMMENT 'Natureza da rubrica no eSocial; nula só na rubrica migrada sem natureza',
  DROP CONSTRAINT IF EXISTS ck_rubrica_natureza;
ALTER TABLE rubrica
  ADD CONSTRAINT ck_rubrica_natureza CHECK (natureza_rubrica_id IS NOT NULL OR origem = 'migracao');
