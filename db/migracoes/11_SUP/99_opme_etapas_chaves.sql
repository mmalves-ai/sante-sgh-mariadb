-- Suprimentos, chaves das etapas logísticas do OPME (C3-021, 05-SUP linha 25): só para frente e idempotente, do
-- 99_opme_etapas_tabelas.
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_estabelecimento FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_solicitacao FOREIGN KEY IF NOT EXISTS (solicitacao_opme_id) REFERENCES solicitacao_opme (id) ON DELETE RESTRICT;
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_pedido_compra FOREIGN KEY IF NOT EXISTS (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT;
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_remessa_consignada FOREIGN KEY IF NOT EXISTS (remessa_consignada_id) REFERENCES remessa_consignada (id) ON DELETE RESTRICT;
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_recebimento_terceiro FOREIGN KEY IF NOT EXISTS (recebimento_material_terceiro_id) REFERENCES recebimento_material_terceiro (id) ON DELETE RESTRICT;
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_nota_entrada FOREIGN KEY IF NOT EXISTS (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT;
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_fornecedor FOREIGN KEY IF NOT EXISTS (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE etapa_solicitacao_opme ADD CONSTRAINT fk_etapa_solicitacao_opme_usuario FOREIGN KEY IF NOT EXISTS (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
