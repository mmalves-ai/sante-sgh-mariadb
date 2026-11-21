-- AGE, lote 03: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE feriado
  ADD CONSTRAINT fk_feriado_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_feriado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE agenda_servico_exame
  ADD CONSTRAINT fk_agenda_servico_exame_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_servico_exame_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
