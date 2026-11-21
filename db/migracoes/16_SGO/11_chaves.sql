-- SGO, lote 11: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE envio_ans
  ADD CONSTRAINT fk_envio_ans_cobranca_ressarcimento_sus_id FOREIGN KEY (cobranca_ressarcimento_sus_id) REFERENCES cobranca_ressarcimento_sus (id) ON DELETE RESTRICT;
ALTER TABLE envio_ans_item
  ADD CONSTRAINT fk_envio_ans_item_ressarcimento_sus_atendimento_id FOREIGN KEY (ressarcimento_sus_atendimento_id) REFERENCES ressarcimento_sus_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE complemento_sib_beneficiario
  ADD CONSTRAINT fk_complemento_sib_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_complemento_sib_beneficiario_motivo_id FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_complemento_sib_beneficiario_envio_id FOREIGN KEY (aceito_envio_ans_id) REFERENCES envio_ans (id) ON DELETE RESTRICT;
ALTER TABLE fatura_plano
  ADD CONSTRAINT fk_fatura_plano_acordo_inadimplencia_id FOREIGN KEY (acordo_inadimplencia_id) REFERENCES acordo_inadimplencia (id) ON DELETE RESTRICT;
ALTER TABLE reajuste_contrato_plano
  ADD CONSTRAINT fk_reajuste_contrato_plano_cancelado_por FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_beneficiario
  ADD CONSTRAINT fk_protocolo_beneficiario_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_reanalise FOREIGN KEY (reanalise_de_protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_prestador_funcao
  ADD CONSTRAINT fk_conta_portal_prestador_funcao_conta FOREIGN KEY (conta_portal_prestador_id) REFERENCES conta_portal_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_prestador_funcao_funcao FOREIGN KEY (funcao_portal_prestador_id) REFERENCES funcao_portal_prestador (id) ON DELETE RESTRICT;
ALTER TABLE produto_plano
  ADD CONSTRAINT fk_produto_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT;
ALTER TABLE prestador_rede_historico
  ADD CONSTRAINT fk_prestador_rede_historico_substituto FOREIGN KEY (substituto_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
