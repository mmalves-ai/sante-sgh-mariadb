-- SUS, lote 05: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE critica_sus
  ADD CONSTRAINT fk_critica_sus_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE retorno_sus_item
  ADD CONSTRAINT fk_retorno_sus_item_retorno_sus_id FOREIGN KEY (retorno_sus_id) REFERENCES retorno_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_item_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_item_producao FOREIGN KEY (producao_ambulatorial_sus_item_id) REFERENCES producao_ambulatorial_sus_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_item_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_item_motivo_rejeicao_sus_id FOREIGN KEY (motivo_rejeicao_sus_id) REFERENCES motivo_rejeicao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_item_tratado_por_usuario_id FOREIGN KEY (tratado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
