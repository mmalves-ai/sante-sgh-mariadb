-- SUP, lote 8: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L7-07 (numero_origem, fornecedor_opcional) e L5-04 (14): pedido em elaboração sem fornecedor; origem do recurso na nota (no pedido já existia)
ALTER TABLE nota_entrada
  ADD CONSTRAINT fk_nota_entrada_origem_recurso_compra_id FOREIGN KEY (origem_recurso_compra_id) REFERENCES origem_recurso_compra (id) ON DELETE RESTRICT;

-- L7-08 (8, 9)
ALTER TABLE documento_estoque
  ADD CONSTRAINT fk_documento_estoque_documento_origem_id FOREIGN KEY (documento_origem_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT;

-- L7-07 (principio_ativo_cliente): princípio do hospital sem código oficial (o oficial nunca é gravado pela migração)
ALTER TABLE principio_ativo_cliente
  ADD CONSTRAINT fk_principio_ativo_cliente_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT;
ALTER TABLE principio_ativo_cliente
  ADD CONSTRAINT fk_principio_ativo_cliente_unidade_medida_padrao_id FOREIGN KEY (unidade_medida_padrao_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE insumo_principio_ativo
  ADD CONSTRAINT fk_insumo_principio_ativo_principio_ativo_cliente_id FOREIGN KEY (principio_ativo_cliente_id) REFERENCES principio_ativo_cliente (id) ON DELETE RESTRICT;
