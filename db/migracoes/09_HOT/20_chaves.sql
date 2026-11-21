-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE solicitacao_copia_prontuario ADD CONSTRAINT fk_solicitacao_copia_prontuario_pedido_titular_id FOREIGN KEY IF NOT EXISTS (pedido_titular_id) REFERENCES pedido_titular (id) ON DELETE RESTRICT;
ALTER TABLE preparo_lactario ADD CONSTRAINT fk_preparo_lactario_conferido_por_usuario_id FOREIGN KEY IF NOT EXISTS (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contrato_servico_terceirizado ADD CONSTRAINT fk_contrato_servico_terceirizado_contrato_fornecedor_id FOREIGN KEY IF NOT EXISTS (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT;

ALTER TABLE ato_copia_prontuario ADD CONSTRAINT fk_ato_copia_prontuario_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE ato_copia_prontuario ADD CONSTRAINT fk_ato_copia_prontuario_solicitacao_copia_prontuario_id FOREIGN KEY IF NOT EXISTS (solicitacao_copia_prontuario_id) REFERENCES solicitacao_copia_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE ato_copia_prontuario ADD CONSTRAINT fk_ato_copia_prontuario_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE preparo_lactario_evento ADD CONSTRAINT fk_preparo_lactario_evento_preparo_lactario_id FOREIGN KEY IF NOT EXISTS (preparo_lactario_id) REFERENCES preparo_lactario (id) ON DELETE RESTRICT;
ALTER TABLE preparo_lactario_evento ADD CONSTRAINT fk_preparo_lactario_evento_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

