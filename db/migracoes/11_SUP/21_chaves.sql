-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE evento_processo_licitatorio ADD CONSTRAINT fk_evento_processo_licitatorio_empresa_fornecedora_id FOREIGN KEY IF NOT EXISTS (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE evento_processo_licitatorio ADD CONSTRAINT fk_evento_processo_licitatorio_pedido_compra_id FOREIGN KEY IF NOT EXISTS (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT;
ALTER TABLE evento_processo_licitatorio ADD CONSTRAINT fk_evento_processo_licitatorio_arquivo_id FOREIGN KEY IF NOT EXISTS (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE processo_licitatorio ADD CONSTRAINT fk_processo_licitatorio_julgado_por_usuario_id FOREIGN KEY IF NOT EXISTS (julgado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE processo_licitatorio ADD CONSTRAINT fk_processo_licitatorio_homologado_por_usuario_id FOREIGN KEY IF NOT EXISTS (homologado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pesquisa_preco_item ADD CONSTRAINT fk_pesquisa_preco_item_desconsiderado_por_usuario_id FOREIGN KEY IF NOT EXISTS (desconsiderado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
