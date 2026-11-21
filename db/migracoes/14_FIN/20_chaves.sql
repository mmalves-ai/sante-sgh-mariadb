-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE versao_regra_contabil ADD CONSTRAINT fk_versao_regra_contabil_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE versao_regra_contabil ADD CONSTRAINT fk_versao_regra_contabil_evento_contabil_id FOREIGN KEY IF NOT EXISTS (evento_contabil_id) REFERENCES evento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE versao_regra_contabil ADD CONSTRAINT fk_versao_regra_contabil_publicador_usuario_id FOREIGN KEY IF NOT EXISTS (publicador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE lancamento_contabil ADD CONSTRAINT fk_lancamento_contabil_versao_regra_contabil_id FOREIGN KEY IF NOT EXISTS (versao_regra_contabil_id) REFERENCES versao_regra_contabil (id) ON DELETE RESTRICT;
ALTER TABLE fato_contabil ADD CONSTRAINT fk_fato_contabil_versao_regra_contabil_id FOREIGN KEY IF NOT EXISTS (versao_regra_contabil_id) REFERENCES versao_regra_contabil (id) ON DELETE RESTRICT;

ALTER TABLE vinculo_contrato_fornecedor ADD CONSTRAINT fk_vinculo_contrato_fornecedor_contrato_fornecedor_id FOREIGN KEY IF NOT EXISTS (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_contrato_fornecedor ADD CONSTRAINT fk_vinculo_contrato_fornecedor_pedido_compra_id FOREIGN KEY IF NOT EXISTS (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_contrato_fornecedor ADD CONSTRAINT fk_vinculo_contrato_fornecedor_titulo_pagar_id FOREIGN KEY IF NOT EXISTS (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_contrato_fornecedor ADD CONSTRAINT fk_vinculo_contrato_fornecedor_ocorrencia_contrato_id FOREIGN KEY IF NOT EXISTS (ocorrencia_contrato_id) REFERENCES ocorrencia_contrato (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_contrato_fornecedor ADD CONSTRAINT fk_vinculo_contrato_fornecedor_pedido_origem_compra_id FOREIGN KEY IF NOT EXISTS (pedido_origem_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT;

