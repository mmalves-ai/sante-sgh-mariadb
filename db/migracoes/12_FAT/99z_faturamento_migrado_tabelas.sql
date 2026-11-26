-- Recusas da carga (fase 2, K1): segurado da conta, guia da fonte pagadora e regra de repasse migrados. Só relaxa no registro migrado (col IS NOT NULL OR origem = 'migracao', precedente 06_PEP/40_tabelas.sql); no sistema a
-- obrigatoriedade continua. Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de
-- recriar, MODIFY repetível, ADD COLUMN IF NOT EXISTS.

ALTER TABLE conta_hospitalar_segurado
  MODIFY COLUMN numero_carteira VARCHAR(40) NULL COMMENT 'Carteira usada nesta conta; nula só na conta migrada sem carteira',
  DROP CONSTRAINT IF EXISTS ck_conta_hospitalar_segurado_carteira;
ALTER TABLE conta_hospitalar_segurado
  ADD CONSTRAINT ck_conta_hospitalar_segurado_carteira CHECK (numero_carteira IS NOT NULL OR origem = 'migracao');

ALTER TABLE guia_fonte_pagadora
  MODIFY COLUMN paciente_id BIGINT UNSIGNED NULL COMMENT 'Paciente da guia; nulo só na guia migrada sem paciente ligado',
  DROP CONSTRAINT IF EXISTS ck_guia_fonte_pagadora_paciente;
ALTER TABLE guia_fonte_pagadora
  ADD CONSTRAINT ck_guia_fonte_pagadora_paciente CHECK (paciente_id IS NOT NULL OR origem = 'migracao');

-- Regra de repasse: o item migrado sem percentual nem valor fixo entra zerado (não repassa nada) até o hospital
-- completá-lo; no sistema, exatamente um dos dois.
ALTER TABLE regra_repasse_item DROP CONSTRAINT IF EXISTS ck_regra_repasse_item_valor;
ALTER TABLE regra_repasse_item
  ADD CONSTRAINT ck_regra_repasse_item_valor CHECK ((percentual > 0) <> (valor_fixo > 0) OR (origem = 'migracao' AND percentual = 0 AND valor_fixo = 0));
