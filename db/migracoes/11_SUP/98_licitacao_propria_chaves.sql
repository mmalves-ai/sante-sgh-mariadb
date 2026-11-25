-- Suprimentos, chaves do processo de contratação pública na porta própria (C2-017, 09-AREA linha 81): só para frente e
-- idempotente, do 98_licitacao_propria_tabelas.
ALTER TABLE processo_licitatorio ADD CONSTRAINT fk_processo_licitatorio_julgado_por_usuario FOREIGN KEY IF NOT EXISTS (julgado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE processo_licitatorio ADD CONSTRAINT fk_processo_licitatorio_homologado_por_usuario FOREIGN KEY IF NOT EXISTS (homologado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE evento_processo_licitatorio ADD CONSTRAINT fk_evento_processo_licitatorio_empresa_fornecedora FOREIGN KEY IF NOT EXISTS (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE evento_processo_licitatorio ADD CONSTRAINT fk_evento_processo_licitatorio_pedido_compra FOREIGN KEY IF NOT EXISTS (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT;
