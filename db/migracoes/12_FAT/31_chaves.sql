-- ADR 0009: chaves da regra de preço particular (31_tabelas.sql). FK RESTRICT.
ALTER TABLE regra_preco_particular
  ADD CONSTRAINT fk_regra_preco_particular_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_particular_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_particular_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_particular_agenda_servico_id FOREIGN KEY IF NOT EXISTS (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_particular_item_faturavel_id FOREIGN KEY IF NOT EXISTS (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_particular_grupo_faturamento_id FOREIGN KEY IF NOT EXISTS (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_particular_texto_origem_agenda_id FOREIGN KEY IF NOT EXISTS (texto_origem_agenda_id) REFERENCES texto_origem_agenda (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item_memoria
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_regra_preco_particular_id FOREIGN KEY IF NOT EXISTS (regra_preco_particular_id) REFERENCES regra_preco_particular (id) ON DELETE RESTRICT;
