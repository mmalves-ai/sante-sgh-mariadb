-- HOT, lote 06: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE registro_prontuario_ocorrencia
  ADD CONSTRAINT fk_registro_prontuario_ocorrencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_prontuario_ocorrencia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_prontuario_ocorrencia_movimento FOREIGN KEY (movimento_prontuario_id) REFERENCES movimento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_prontuario_ocorrencia_usuario FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inspecao_limpeza
  ADD CONSTRAINT fk_inspecao_limpeza_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE documento_digitalizado
  ADD CONSTRAINT fk_documento_digitalizado_lote_digitalizacao_id FOREIGN KEY (lote_digitalizacao_id) REFERENCES lote_digitalizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_assinatura_icp_id FOREIGN KEY (assinatura_icp_id) REFERENCES assinatura_icp (id) ON DELETE RESTRICT;
ALTER TABLE modelo_equipamento_curso
  ADD CONSTRAINT fk_modelo_equipamento_curso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_equipamento_curso_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_equipamento_curso_curso_id FOREIGN KEY (curso_id) REFERENCES curso (id) ON DELETE RESTRICT;
ALTER TABLE evento_ciclo_equipamento
  ADD CONSTRAINT fk_evento_ciclo_equipamento_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT;
ALTER TABLE ordem_servico_manutencao
  ADD CONSTRAINT fk_ordem_servico_manutencao_laudo_arquivo_id FOREIGN KEY (laudo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_servico_terceirizado
  ADD CONSTRAINT fk_contrato_servico_terceirizado_contrato_fornecedor FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE plano_refeicao_acompanhante
  ADD CONSTRAINT fk_plano_refeicao_acompanhante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_refeicao_acompanhante_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_refeicao_acompanhante_acompanhante FOREIGN KEY (acompanhante_internacao_id) REFERENCES acompanhante_internacao (id) ON DELETE RESTRICT;
ALTER TABLE plano_refeicao_acompanhante_refeicao
  ADD CONSTRAINT fk_plano_refeicao_acompanhante_refeicao_plano FOREIGN KEY (plano_refeicao_acompanhante_id) REFERENCES plano_refeicao_acompanhante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_refeicao_acompanhante_refeicao_refeicao FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT;

-- Carga de domínio do produto (pedido do lote 03-02): os tipos documentais do índice da digitalização. Idempotente.
INSERT INTO tipo_documento_arquivo (codigo, descricao, grupo, guardado_no_arquivo, prazo_guarda_anos, criado_em) VALUES
  ('ficha-atendimento','Ficha de atendimento','prontuario',TRUE,20,NOW(3)),
  ('evolucao','Evolução','prontuario',TRUE,20,NOW(3)),
  ('prescricao','Prescrição','prontuario',TRUE,20,NOW(3)),
  ('exame','Resultado de exame','exame',TRUE,20,NOW(3)),
  ('laudo','Laudo','exame',TRUE,20,NOW(3)),
  ('termo-consentimento','Termo de consentimento','prontuario',TRUE,20,NOW(3)),
  ('folha-sala','Folha de sala','prontuario',TRUE,20,NOW(3)),
  ('prontuario-antigo','Prontuário antigo','prontuario',TRUE,20,NOW(3)),
  ('outro','Outro documento do prontuário','outro',TRUE,20,NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;
