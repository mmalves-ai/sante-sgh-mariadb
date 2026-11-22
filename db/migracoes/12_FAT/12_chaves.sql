-- FAT, lote 12: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L8-02 (8)
ALTER TABLE evento_repasse
  ADD CONSTRAINT fk_evento_repasse_tipo_deducao_irrf_id FOREIGN KEY (tipo_deducao_irrf_id) REFERENCES tipo_deducao_irrf (id) ON DELETE RESTRICT;
ALTER TABLE evento_repasse
  ADD CONSTRAINT fk_evento_repasse_tipo_rendimento_isento_id FOREIGN KEY (tipo_rendimento_isento_id) REFERENCES tipo_rendimento_isento (id) ON DELETE RESTRICT;

-- L8-03 (10) e L8-04 (11)
ALTER TABLE item_faturavel_tipo_servico
  ADD CONSTRAINT fk_item_faturavel_tipo_servico_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel_tipo_servico
  ADD CONSTRAINT fk_item_faturavel_tipo_servico_tipo_servico_faturavel_id FOREIGN KEY (tipo_servico_faturavel_id) REFERENCES tipo_servico_faturavel (id) ON DELETE RESTRICT;

-- L8-03 (12)
ALTER TABLE tabela_preco_item_padrao
  ADD CONSTRAINT fk_tabela_preco_item_padrao_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE tabela_preco_item_padrao
  ADD CONSTRAINT fk_tabela_preco_item_padrao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;

-- L8-03 (13)
ALTER TABLE local_cobranca
  ADD CONSTRAINT fk_local_cobranca_tabela_preco_matmed_id FOREIGN KEY (tabela_preco_matmed_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE local_cobranca
  ADD CONSTRAINT fk_local_cobranca_tabela_preco_material_id FOREIGN KEY (tabela_preco_material_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;

-- L8-06 (20)
ALTER TABLE conta_hospitalar_item
  ADD CONSTRAINT fk_conta_hospitalar_item_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item
  ADD CONSTRAINT fk_conta_hospitalar_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT;

-- L8-08 (11) e L8-06 (13): procedimento informado, lote, CID, guia complementar e APAC do item
ALTER TABLE conta_hospitalar_item
  ADD CONSTRAINT fk_conta_hospitalar_item_procedimento_sigtap_informado_id FOREIGN KEY (procedimento_sigtap_informado_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item
  ADD CONSTRAINT fk_conta_hospitalar_item_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item
  ADD CONSTRAINT fk_conta_hospitalar_item_apac_id FOREIGN KEY (apac_id) REFERENCES apac (id) ON DELETE RESTRICT;

-- L8-05 (15): tipos nativos de conta e o tipo de auditoria da migração (semente nativa)
INSERT IGNORE INTO tipo_conta (codigo, descricao, natureza, exige_fonte_pagadora, ordem, ativo, criado_em) VALUES
  ('ambulatorial', 'Ambulatorial', 'ambulatorial', FALSE, 1, TRUE, CURRENT_TIMESTAMP(3)),
  ('externa', 'Externa', 'externa', FALSE, 2, TRUE, CURRENT_TIMESTAMP(3)),
  ('urgencia', 'Urgência', 'urgencia', FALSE, 3, TRUE, CURRENT_TIMESTAMP(3)),
  ('internacao', 'Internação', 'internacao', FALSE, 4, TRUE, CURRENT_TIMESTAMP(3));
INSERT IGNORE INTO tipo_auditoria (codigo, descricao, categoria, presencial, externa, parcial, ativo, criado_em) VALUES
  ('migracao', 'Auditoria trazida do sistema anterior', 'administrativa', FALSE, FALSE, FALSE, TRUE, CURRENT_TIMESTAMP(3));
