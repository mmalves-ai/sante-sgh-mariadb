-- Portal do paciente, confirmação do pagamento no banco próprio (modulos-proprios-2, família portal-leituras): só para
-- frente e idempotente (ADR 0002, parte 2). A intenção de pagamento guarda por qual caminho a confirmação chegou (o
-- retorno do gateway ou a conferência pedida pelo paciente); o usuário do hospital continua em confirmado_por_usuario_id.

ALTER TABLE intencao_pagamento_portal
  ADD COLUMN IF NOT EXISTS confirmado_por VARCHAR(20) NULL COMMENT 'Caminho da confirmação: retorno do gateway ou conferência pelo portal',
  DROP CONSTRAINT IF EXISTS ck_intencao_pagamento_portal_confirmado_por,
  ADD CONSTRAINT ck_intencao_pagamento_portal_confirmado_por CHECK (confirmado_por IS NULL OR confirmado_por IN ('retorno','conferencia'));
