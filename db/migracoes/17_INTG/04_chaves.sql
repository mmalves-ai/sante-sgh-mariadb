-- INTG, lote 04: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE ato_conta_portal_profissional_externo
  ADD CONSTRAINT fk_ato_conta_portal_profissional_externo_conta FOREIGN KEY (conta_portal_profissional_externo_id) REFERENCES conta_portal_profissional_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_conta_portal_profissional_externo_realizado_por FOREIGN KEY (realizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE troca_email_conta_portal
  ADD CONSTRAINT fk_troca_email_conta_portal_conta_portal_paciente_id FOREIGN KEY (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_email_conta_portal_profissional_externo FOREIGN KEY (conta_portal_profissional_externo_id) REFERENCES conta_portal_profissional_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_email_conta_portal_pedido_por_usuario_id FOREIGN KEY (pedido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
