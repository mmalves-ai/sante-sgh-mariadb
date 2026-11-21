-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE carga_tabela_preco ADD CONSTRAINT fk_carga_tabela_preco_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE carga_tabela_preco ADD CONSTRAINT fk_carga_tabela_preco_tabela_preco_id FOREIGN KEY IF NOT EXISTS (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE carga_tabela_preco ADD CONSTRAINT fk_carga_tabela_preco_arquivo_id FOREIGN KEY IF NOT EXISTS (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE carga_tabela_preco ADD CONSTRAINT fk_carga_tabela_preco_publicada_por_usuario_id FOREIGN KEY IF NOT EXISTS (publicada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE carga_tabela_preco_linha ADD CONSTRAINT fk_carga_tabela_preco_linha_carga_tabela_preco_id FOREIGN KEY IF NOT EXISTS (carga_tabela_preco_id) REFERENCES carga_tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE carga_tabela_preco_linha ADD CONSTRAINT fk_carga_tabela_preco_linha_item_faturavel_id FOREIGN KEY IF NOT EXISTS (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
