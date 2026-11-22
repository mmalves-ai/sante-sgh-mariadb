-- ADR 0009, volta 2: chaves do valor de consulta da origem (32_tabelas.sql). FK RESTRICT.
ALTER TABLE preco_consulta_origem
  ADD CONSTRAINT fk_preco_consulta_origem_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_consulta_origem_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_consulta_origem_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_consulta_origem_codigo_prestador_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (codigo_prestador_fonte_pagadora_id) REFERENCES codigo_prestador_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_consulta_origem_regra_preco_particular_id FOREIGN KEY IF NOT EXISTS (regra_preco_particular_id) REFERENCES regra_preco_particular (id) ON DELETE RESTRICT;
