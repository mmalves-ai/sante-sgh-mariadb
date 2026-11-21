-- INTG, lote 06: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE carga_catalogo
  ADD CONSTRAINT fk_carga_catalogo_aprovada_como_sessao FOREIGN KEY (aprovada_como_sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carga_catalogo_aprovada_como_acao FOREIGN KEY (aprovada_como_acao_suporte_id) REFERENCES sessao_suporte_acao (id) ON DELETE RESTRICT;
ALTER TABLE item_catalogo_licenciado
  ADD CONSTRAINT fk_item_catalogo_licenciado_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_catalogo_licenciado_licenca FOREIGN KEY (licenca_catalogo_id) REFERENCES licenca_catalogo (id) ON DELETE RESTRICT;
