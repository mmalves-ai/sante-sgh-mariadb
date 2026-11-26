-- Recepção, regra do plano por especialidade, serviço e setor (F7, 02-REC linha 37, 26/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a escolha da regra mais específica fica no domínio
-- (@sgh/dominio-recepcao, escolherRegraPlano). Nulo vale para todos. A senha de autorização (exige_senha_autorizacao)
-- passa a poder ser pedida só numa especialidade, num serviço ou num setor (unidade assistencial) da fonte pagadora.
ALTER TABLE regra_atendimento_fonte_pagadora
  ADD COLUMN IF NOT EXISTS especialidade_medica_id BIGINT UNSIGNED NULL COMMENT 'Nulo para todas as especialidades' AFTER estabelecimento_id,
  ADD COLUMN IF NOT EXISTS servico_atendimento_id BIGINT UNSIGNED NULL COMMENT 'Nulo para todos os serviços' AFTER especialidade_medica_id,
  ADD COLUMN IF NOT EXISTS unidade_assistencial_id BIGINT UNSIGNED NULL COMMENT 'Setor do atendimento; nulo para todos' AFTER servico_atendimento_id;

ALTER TABLE regra_atendimento_fonte_pagadora
  ADD INDEX IF NOT EXISTS ix_regra_atendimento_fonte_pagadora_especialidade (especialidade_medica_id),
  ADD INDEX IF NOT EXISTS ix_regra_atendimento_fonte_pagadora_servico (servico_atendimento_id),
  ADD INDEX IF NOT EXISTS ix_regra_atendimento_fonte_pagadora_unidade (unidade_assistencial_id);
