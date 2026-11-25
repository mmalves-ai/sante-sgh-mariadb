-- Chaves dos valores habituais da abertura do atendimento (F3.2, 02-REC linha 31). Idempotente.
ALTER TABLE padrao_abertura_atendimento
  ADD CONSTRAINT fk_padrao_abertura_atendimento_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_padrao_abertura_atendimento_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_padrao_abertura_atendimento_unidade_assistencial_id FOREIGN KEY IF NOT EXISTS (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_padrao_abertura_atendimento_centro_custo_id FOREIGN KEY IF NOT EXISTS (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_padrao_abertura_atendimento_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_padrao_abertura_atendimento_especialidade_medica_id FOREIGN KEY IF NOT EXISTS (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
