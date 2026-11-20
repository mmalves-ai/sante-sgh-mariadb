-- Suprimentos, lote 06: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE tipo_entrada_estoque
  ADD CONSTRAINT fk_tipo_entrada_estoque_tipo_movimento_estoque_id FOREIGN KEY (tipo_movimento_estoque_id) REFERENCES tipo_movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_entrada_estoque_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_entrada_estoque_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE tipo_movimento_estoque
  ADD CONSTRAINT fk_tipo_movimento_estoque_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE unidade_medida
  ADD CONSTRAINT fk_unidade_medida_grupo_unidade_medida_id FOREIGN KEY (grupo_unidade_medida_id) REFERENCES grupo_unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_medida_termo_tiss_id FOREIGN KEY (termo_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE unificacao_insumo
  ADD CONSTRAINT fk_unificacao_insumo_insumo_permanece_id FOREIGN KEY (insumo_permanece_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_insumo_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_insumo_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE unificacao_insumo_item
  ADD CONSTRAINT fk_unificacao_insumo_item_unificacao_insumo_id FOREIGN KEY (unificacao_insumo_id) REFERENCES unificacao_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_insumo_item_insumo_absorvido_id FOREIGN KEY (insumo_absorvido_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_insumo_item_unidade_medida_absorvido_id FOREIGN KEY (unidade_medida_absorvido_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE usuario_estoque_centro_custo
  ADD CONSTRAINT fk_usuario_estoque_centro_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_estoque_centro_custo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_estoque_centro_custo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE usuario_estoque_classificacao
  ADD CONSTRAINT fk_usuario_estoque_classificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_estoque_classificacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_estoque_classificacao_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_estoque_classificacao_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT;
ALTER TABLE veiculo_entrega
  ADD CONSTRAINT fk_veiculo_entrega_tipo_combustivel_id FOREIGN KEY (tipo_combustivel_id) REFERENCES tipo_combustivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_veiculo_entrega_transportadora_empresa_fornecedora_id FOREIGN KEY (transportadora_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_veiculo_entrega_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_portal_cotacao
  ADD CONSTRAINT fk_vinculo_portal_cotacao_portal_cotacao_id FOREIGN KEY (portal_cotacao_id) REFERENCES portal_cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_portal_cotacao_cotacao_id FOREIGN KEY (cotacao_id) REFERENCES cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_portal_cotacao_cotacao_item_id FOREIGN KEY (cotacao_item_id) REFERENCES cotacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_portal_cotacao_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_portal_cotacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_portal_cotacao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_portal_cotacao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
