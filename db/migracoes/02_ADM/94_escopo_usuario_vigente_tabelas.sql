-- Escopo do usuário com histórico (01-ADM L59, correção da revisão de 24/11): retirar uma unidade, um local, um
-- convênio ou um tipo de prontuário passa a ser exclusão lógica (excluido_em/excluido_por), e nunca apagamento: o
-- histórico de quem teve acesso a quê fica no banco, não só na trilha. A unicidade do par vale só entre as linhas
-- vigentes, para que a reconcessão crie uma linha nova ao lado da retirada. Só para frente e idempotente (ADR 0002,
-- parte 2).

ALTER TABLE usuario_unidade
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não retirada',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_unidade_par_vigente (usuario_id, unidade_assistencial_id, vigente_chave);
ALTER TABLE usuario_unidade
  DROP INDEX IF EXISTS uq_usuario_unidade_par;

ALTER TABLE usuario_local_atendimento
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não retirada',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_local_atendimento_par_vigente (usuario_id, local_atendimento_id, vigente_chave);
ALTER TABLE usuario_local_atendimento
  DROP INDEX IF EXISTS uq_usuario_local_atendimento_par;

ALTER TABLE usuario_fonte_pagadora
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não retirada',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_fonte_pagadora_par_vigente (usuario_id, fonte_pagadora_id, vigente_chave);
ALTER TABLE usuario_fonte_pagadora
  DROP INDEX IF EXISTS uq_usuario_fonte_pagadora_par;

ALTER TABLE usuario_tipo_prontuario
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não retirada',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_tipo_prontuario_par_vigente (usuario_id, tipo_documento_clinico_id, vigente_chave);
ALTER TABLE usuario_tipo_prontuario
  DROP INDEX IF EXISTS uq_usuario_tipo_prontuario_par;
