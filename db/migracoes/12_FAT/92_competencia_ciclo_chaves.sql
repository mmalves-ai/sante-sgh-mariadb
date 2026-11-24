-- Faturamento, ciclos da competência do convênio (F3.7, 24/11/2026): só para frente e idempotente (ADR 0002, parte
-- 2). As chaves estrangeiras do ciclo para o fechamento, o estabelecimento e o usuário.

ALTER TABLE ciclo_competencia_fonte_pagadora
  ADD CONSTRAINT fk_ciclo_competencia_fonte_pagadora_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_competencia_fonte_pagadora_fechamento_id FOREIGN KEY IF NOT EXISTS (fechamento_competencia_fonte_pagadora_id) REFERENCES fechamento_competencia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_competencia_fonte_pagadora_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
