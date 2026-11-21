-- FAT, lote 08: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE decisao_lancamento_tardio
  ADD CONSTRAINT fk_decisao_lancamento_tardio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_lancamento_tardio_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_lancamento_tardio_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_lancamento_tardio_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_lancamento_tardio_lancamento_origem_evento_id FOREIGN KEY (lancamento_origem_evento_id) REFERENCES lancamento_origem_evento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_lancamento_tardio_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_lancamento_tardio_conta_complementar_id FOREIGN KEY (conta_complementar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE regra_faturabilidade
  ADD CONSTRAINT fk_regra_faturabilidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_faturabilidade_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE importacao_tabela_linha
  ADD CONSTRAINT fk_importacao_tabela_linha_importacao FOREIGN KEY (importacao_tabela_id) REFERENCES importacao_tabela (id) ON DELETE RESTRICT;
ALTER TABLE importacao_tabela_linha
  ADD CONSTRAINT fk_importacao_tabela_linha_item FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
