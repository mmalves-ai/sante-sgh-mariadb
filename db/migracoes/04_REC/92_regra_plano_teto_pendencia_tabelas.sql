-- Recepção, regra própria do plano da fonte pagadora (F7, 02-CAD linha 24, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-recepcao, regra-plano) e na porta.
--   - Teto do plano: quantos atendimentos o beneficiário pode ter na mesma fonte (e plano) dentro de um período de
--     dias. Por padrão o teto só alerta a recepção; teto_bloqueia faz a abertura ser recusada.
--   - Pendência do plano: contrato suspenso, cobertura em revisão. 'alerta' avisa a recepção, 'bloqueio' recusa a
--     abertura; o motivo é obrigatório fora de 'nenhuma' e aparece na crítica.
--   - A regra trocada encerra a vigência (vigencia_fim) e a nova entra; a linha nunca é apagada.
ALTER TABLE regra_atendimento_fonte_pagadora
  ADD COLUMN IF NOT EXISTS teto_atendimentos SMALLINT UNSIGNED NULL COMMENT 'Atendimentos do beneficiário aceitos no período do teto',
  ADD COLUMN IF NOT EXISTS teto_periodo_dias SMALLINT UNSIGNED NULL COMMENT 'Dias do período do teto, contados até a abertura',
  ADD COLUMN IF NOT EXISTS teto_bloqueia BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O teto atingido recusa a abertura; falso só alerta',
  ADD COLUMN IF NOT EXISTS pendencia VARCHAR(10) NOT NULL DEFAULT 'nenhuma' COMMENT 'Pendência do plano na recepção: nenhuma, alerta ou bloqueio',
  ADD COLUMN IF NOT EXISTS pendencia_motivo VARCHAR(500) NULL COMMENT 'Motivo da pendência, mostrado na abertura';

ALTER TABLE regra_atendimento_fonte_pagadora
  ADD CONSTRAINT IF NOT EXISTS ck_regra_atendimento_fonte_pagadora_pendencia CHECK (pendencia IN ('nenhuma','alerta','bloqueio')),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_atendimento_fonte_pagadora_pendencia_motivo CHECK (pendencia = 'nenhuma' OR pendencia_motivo IS NOT NULL),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_atendimento_fonte_pagadora_teto CHECK ((teto_atendimentos IS NULL) = (teto_periodo_dias IS NULL) AND (teto_atendimentos IS NULL OR teto_atendimentos >= 1) AND (teto_periodo_dias IS NULL OR teto_periodo_dias BETWEEN 1 AND 366)),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_atendimento_fonte_pagadora_teto_bloqueia CHECK (teto_bloqueia = FALSE OR teto_atendimentos IS NOT NULL),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_atendimento_fonte_pagadora_documentos CHECK (documentos_exigidos IS NULL OR JSON_VALID(documentos_exigidos));
