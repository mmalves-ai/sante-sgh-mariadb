-- REL, lote 03: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE pedido_relatorio
  ADD CONSTRAINT fk_pedido_relatorio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_relatorio_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_relatorio_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_relatorio_respondido_por_usuario_id FOREIGN KEY (respondido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_relatorio_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
