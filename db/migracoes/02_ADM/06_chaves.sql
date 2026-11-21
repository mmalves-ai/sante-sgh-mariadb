-- ADM, lote 06: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE consulta_verificacao_documento
  ADD CONSTRAINT fk_consulta_verificacao_documento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE pedido_assinatura
  ADD CONSTRAINT fk_pedido_assinatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE pedido_assinatura
  ADD CONSTRAINT fk_pedido_assinatura_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_assinatura
  ADD CONSTRAINT fk_pedido_assinatura_provedor_id FOREIGN KEY (provedor_assinatura_nuvem_id) REFERENCES provedor_assinatura_nuvem (id) ON DELETE RESTRICT;
ALTER TABLE pedido_assinatura
  ADD CONSTRAINT fk_pedido_assinatura_certificado_id FOREIGN KEY (certificado_usuario_id) REFERENCES certificado_usuario (id) ON DELETE RESTRICT;
ALTER TABLE previa_assinatura
  ADD CONSTRAINT fk_previa_assinatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE previa_assinatura
  ADD CONSTRAINT fk_previa_assinatura_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE previa_assinatura
  ADD CONSTRAINT fk_previa_assinatura_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE previa_assinatura
  ADD CONSTRAINT fk_previa_assinatura_certificado_usuario_id FOREIGN KEY (certificado_usuario_id) REFERENCES certificado_usuario (id) ON DELETE RESTRICT;
ALTER TABLE previa_assinatura
  ADD CONSTRAINT fk_previa_assinatura_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_previa_assinatura_id FOREIGN KEY (previa_assinatura_id) REFERENCES previa_assinatura (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_certificado_usuario_id FOREIGN KEY (certificado_usuario_id) REFERENCES certificado_usuario (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_provedor_id FOREIGN KEY (provedor_assinatura_nuvem_id) REFERENCES provedor_assinatura_nuvem (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_arquivo_assinado_id FOREIGN KEY (arquivo_assinado_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_icp
  ADD CONSTRAINT fk_assinatura_icp_assinatura_documento_id FOREIGN KEY (assinatura_documento_id) REFERENCES assinatura_documento (id) ON DELETE RESTRICT;
ALTER TABLE validacao_assinatura
  ADD CONSTRAINT fk_validacao_assinatura_assinatura_icp_id FOREIGN KEY (assinatura_icp_id) REFERENCES assinatura_icp (id) ON DELETE RESTRICT;
ALTER TABLE validacao_assinatura
  ADD CONSTRAINT fk_validacao_assinatura_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aviso_assinatura
  ADD CONSTRAINT fk_aviso_assinatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE aviso_assinatura
  ADD CONSTRAINT fk_aviso_assinatura_assinatura_icp_id FOREIGN KEY (assinatura_icp_id) REFERENCES assinatura_icp (id) ON DELETE RESTRICT;
ALTER TABLE aviso_assinatura
  ADD CONSTRAINT fk_aviso_assinatura_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aviso_assinatura
  ADD CONSTRAINT fk_aviso_assinatura_lido_por FOREIGN KEY (lido_por) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_politica_assinatura
  ADD CONSTRAINT fk_regra_politica_assinatura_politica_id FOREIGN KEY (politica_assinatura_id) REFERENCES politica_assinatura (id) ON DELETE RESTRICT;
ALTER TABLE regra_politica_assinatura
  ADD CONSTRAINT fk_regra_politica_assinatura_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
