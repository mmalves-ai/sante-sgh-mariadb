-- Suprimentos, chaves da decisão de integração por dose (F3.6-04, 05-SUP linha 7): só para frente e idempotente, do
-- 91_integracao_dose_tabelas.
ALTER TABLE integracao_dose_estoque ADD CONSTRAINT fk_integracao_dose_estoque_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE integracao_dose_estoque ADD CONSTRAINT fk_integracao_dose_estoque_horario_administracao_id FOREIGN KEY IF NOT EXISTS (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT;
ALTER TABLE integracao_dose_estoque ADD CONSTRAINT fk_integracao_dose_estoque_prescricao_item_id FOREIGN KEY IF NOT EXISTS (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT;
ALTER TABLE integracao_dose_estoque ADD CONSTRAINT fk_integracao_dose_estoque_regra_integracao_prescricao_id FOREIGN KEY IF NOT EXISTS (regra_integracao_prescricao_id) REFERENCES regra_integracao_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE integracao_dose_estoque ADD CONSTRAINT fk_integracao_dose_estoque_atendente_local_estoque_id FOREIGN KEY IF NOT EXISTS (atendente_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT;
