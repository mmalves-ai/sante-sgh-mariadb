-- SADT, laudo estruturado (F3.5, 05-SADT linha 17; 24/11/2026). Só para frente e idempotente (ADR 0002, parte 2).
-- O peso, a altura e a superfície corporal usados no laudo: a faixa indexada pela superfície (como a massa do ventrículo
-- por m²) se avalia com eles; ficam gravados no laudo e na foto de cada versão, para a reabertura, a retificação sem
-- redigitar e a reprodução da versão assinada darem a mesma marca de fora da referência.
ALTER TABLE laudo_diagnostico
  ADD COLUMN IF NOT EXISTS peso_kg DECIMAL(6,2) NULL COMMENT 'Peso do paciente usado no laudo (kg)',
  ADD COLUMN IF NOT EXISTS altura_cm DECIMAL(5,1) NULL COMMENT 'Altura do paciente usada no laudo (cm)',
  ADD COLUMN IF NOT EXISTS superficie_corporal DECIMAL(5,3) NULL COMMENT 'Superfície corporal (m², Mosteller) usada no laudo';

ALTER TABLE laudo_diagnostico
  ADD CONSTRAINT IF NOT EXISTS ck_laudo_diagnostico_medidas_paciente CHECK (
    (peso_kg IS NULL OR (peso_kg > 0 AND peso_kg <= 500))
    AND (altura_cm IS NULL OR (altura_cm > 0 AND altura_cm <= 260))
    AND (superficie_corporal IS NULL OR (superficie_corporal > 0 AND superficie_corporal < 10)));
