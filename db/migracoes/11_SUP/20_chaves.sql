-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE livro_controlado ADD CONSTRAINT fk_livro_controlado_conteudo_arquivo_id FOREIGN KEY IF NOT EXISTS (conteudo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE dispensacao ADD CONSTRAINT fk_dispensacao_receita_controlada_id FOREIGN KEY IF NOT EXISTS (receita_controlada_id) REFERENCES receita_controlada (id) ON DELETE RESTRICT;

ALTER TABLE conferencia_controlado ADD CONSTRAINT fk_conferencia_controlado_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_controlado ADD CONSTRAINT fk_conferencia_controlado_lancamento_controlado_id FOREIGN KEY IF NOT EXISTS (lancamento_controlado_id) REFERENCES lancamento_controlado (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_controlado ADD CONSTRAINT fk_conferencia_controlado_documento_estoque_id FOREIGN KEY IF NOT EXISTS (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_controlado ADD CONSTRAINT fk_conferencia_controlado_lote_insumo_id FOREIGN KEY IF NOT EXISTS (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_controlado ADD CONSTRAINT fk_conferencia_controlado_conferente_usuario_id FOREIGN KEY IF NOT EXISTS (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE evento_processo_licitatorio ADD CONSTRAINT fk_evento_processo_licitatorio_processo_licitatorio_id FOREIGN KEY IF NOT EXISTS (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT;
ALTER TABLE evento_processo_licitatorio ADD CONSTRAINT fk_evento_processo_licitatorio_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

