-- ADR 0009: chaves da agenda estruturada (21_tabelas.sql). FK RESTRICT.
ALTER TABLE texto_origem_agenda
  ADD CONSTRAINT fk_texto_origem_agenda_agenda_servico_id FOREIGN KEY IF NOT EXISTS (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_origem_agenda_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE trecho_texto_agenda
  ADD CONSTRAINT fk_trecho_texto_agenda_texto_origem_agenda_id FOREIGN KEY IF NOT EXISTS (texto_origem_agenda_id) REFERENCES texto_origem_agenda (id) ON DELETE RESTRICT;
ALTER TABLE agenda_cobertura
  ADD CONSTRAINT fk_agenda_cobertura_agenda_servico_id FOREIGN KEY IF NOT EXISTS (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_cobertura_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_cobertura_plano_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_cobertura_texto_origem_agenda_id FOREIGN KEY IF NOT EXISTS (texto_origem_agenda_id) REFERENCES texto_origem_agenda (id) ON DELETE RESTRICT;
ALTER TABLE agenda_restricao
  ADD CONSTRAINT fk_agenda_restricao_agenda_servico_id FOREIGN KEY IF NOT EXISTS (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_restricao_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_restricao_plano_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_restricao_item_agendavel_id FOREIGN KEY IF NOT EXISTS (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_restricao_texto_origem_agenda_id FOREIGN KEY IF NOT EXISTS (texto_origem_agenda_id) REFERENCES texto_origem_agenda (id) ON DELETE RESTRICT;
ALTER TABLE agenda_preparo
  ADD CONSTRAINT fk_agenda_preparo_agenda_servico_id FOREIGN KEY IF NOT EXISTS (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_preparo_item_agendavel_id FOREIGN KEY IF NOT EXISTS (item_agendavel_id) REFERENCES item_agendavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_preparo_texto_origem_agenda_id FOREIGN KEY IF NOT EXISTS (texto_origem_agenda_id) REFERENCES texto_origem_agenda (id) ON DELETE RESTRICT;
