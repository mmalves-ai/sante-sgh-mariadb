-- Convênio do faturamento no escopo do usuário (01-ADM L59, C2-051): o mesmo convênio pode ser liberado à conta para o
-- atendimento (ver e operar guias e contas) e, à parte, para o faturamento (fechar, conferir e enviar a produção). A
-- finalidade separa as duas concessões na mesma tabela; a unicidade entre as vigentes passa a valer por finalidade.
-- Só para frente e idempotente (ADR 0002, parte 2). O nome 99zb ordena depois da 94 (vigente_chave) e da 99za.

ALTER TABLE usuario_fonte_pagadora
  ADD COLUMN IF NOT EXISTS finalidade VARCHAR(20) NOT NULL DEFAULT 'atendimento' COMMENT 'atendimento (ver e operar o convênio) ou faturamento (faturar a produção do convênio)' AFTER fonte_pagadora_id;
ALTER TABLE usuario_fonte_pagadora
  DROP CONSTRAINT IF EXISTS ck_usuario_fonte_pagadora_finalidade;
ALTER TABLE usuario_fonte_pagadora
  ADD CONSTRAINT ck_usuario_fonte_pagadora_finalidade CHECK (finalidade IN ('atendimento','faturamento'));
ALTER TABLE usuario_fonte_pagadora
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_fonte_pagadora_par_finalidade_vigente (usuario_id, fonte_pagadora_id, finalidade, vigente_chave);
ALTER TABLE usuario_fonte_pagadora
  DROP INDEX IF EXISTS uq_usuario_fonte_pagadora_par_vigente;
