-- Chaves do módulo SGO, lote 06 (aplicadas depois de todos os tabelas.sql)

ALTER TABLE motivo_contato_beneficiario
  ADD CONSTRAINT fk_motivo_contato_beneficiario_servico_atendimento_operadora_id FOREIGN KEY (servico_atendimento_operadora_id) REFERENCES servico_atendimento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE motivo_movimento_cadastral
  ADD CONSTRAINT fk_motivo_movimento_cadastral_motivo_cancelamento_contrato_id FOREIGN KEY (motivo_cancelamento_contrato_id) REFERENCES motivo_cancelamento_contrato (id) ON DELETE RESTRICT;
ALTER TABLE movimentacao_lote_contratante
  ADD CONSTRAINT fk_movimentacao_lote_contratante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_solicitacao_portal_ben_2ecb3bd7 FOREIGN KEY (solicitacao_portal_beneficiario_id) REFERENCES solicitacao_portal_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE movimentacao_lote_contratante_item
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_movimentacao_lote_f020b759 FOREIGN KEY (movimentacao_lote_contratante_id) REFERENCES movimentacao_lote_contratante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_titular_beneficia_78f75c9e FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_estado_civil_id FOREIGN KEY (estado_civil_id) REFERENCES estado_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_grau_parentesco_d_91286de9 FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimentacao_lote_contratante_item_motivo_movimento__de011cb7 FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT;
ALTER TABLE movimento_cadastral_beneficiario
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_motivo_movimento_ca_ebe813b3 FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_contrato_plano_anterior_id FOREIGN KEY (contrato_plano_anterior_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_produto_plano_anterior_id FOREIGN KEY (produto_plano_anterior_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_contratante_plano_a_56c0144b FOREIGN KEY (contratante_plano_anterior_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_novo_titular_benefi_bc58230a FOREIGN KEY (novo_titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_cadastral_beneficiario_movimentacao_lote_c_8707796c FOREIGN KEY (movimentacao_lote_contratante_item_id) REFERENCES movimentacao_lote_contratante_item (id) ON DELETE RESTRICT;
ALTER TABLE movimento_rede_ans
  ADD CONSTRAINT fk_movimento_rede_ans_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_rede_ans_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_rede_ans_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_rede_ans_situacao_movimento_rede_id FOREIGN KEY (situacao_movimento_rede_id) REFERENCES situacao_movimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_rede_ans_envio_ans_id FOREIGN KEY (envio_ans_id) REFERENCES envio_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_rede_ans_confirmado_por_usuario_id FOREIGN KEY (confirmado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE negativa_cobertura
  ADD CONSTRAINT fk_negativa_cobertura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_motivo_decisao_autorizacao_id FOREIGN KEY (motivo_decisao_autorizacao_id) REFERENCES motivo_decisao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_norma_regulatoria_id FOREIGN KEY (norma_regulatoria_id) REFERENCES norma_regulatoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_negativa_cobertura_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE nota_fiscal_prestador_rede
  ADD CONSTRAINT fk_nota_fiscal_prestador_rede_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fiscal_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fiscal_prestador_rede_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fiscal_prestador_rede_lote_pagamento_rede_id FOREIGN KEY (lote_pagamento_rede_id) REFERENCES lote_pagamento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fiscal_prestador_rede_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE nota_fiscal_prestador_rede_lote
  ADD CONSTRAINT fk_nota_fiscal_prestador_rede_lote_nota_fiscal_prestador_rede_id FOREIGN KEY (nota_fiscal_prestador_rede_id) REFERENCES nota_fiscal_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fiscal_prestador_rede_lote_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_inadimplencia
  ADD CONSTRAINT fk_notificacao_inadimplencia_ocorrencia_inadimplencia_id FOREIGN KEY (ocorrencia_inadimplencia_id) REFERENCES ocorrencia_inadimplencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_inadimplencia_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_inadimplencia_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_inadimplencia
  ADD CONSTRAINT fk_ocorrencia_inadimplencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_inadimplencia_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_inadimplencia_fase_cobranca_inadimplencia_id FOREIGN KEY (fase_cobranca_inadimplencia_id) REFERENCES fase_cobranca_inadimplencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_inadimplencia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_inadimplencia_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_inadimplencia_acordo_inadimplencia_id FOREIGN KEY (acordo_inadimplencia_id) REFERENCES acordo_inadimplencia (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_pedido_autorizacao
  ADD CONSTRAINT fk_ocorrencia_pedido_autorizacao_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_pedido_autorizacao_registrada_por_usuario_id FOREIGN KEY (registrada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_protocolo_beneficiario
  ADD CONSTRAINT fk_ocorrencia_protocolo_beneficiario_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_protocolo_beneficiario_gravidade_protocol_6feab52c FOREIGN KEY (gravidade_protocolo_beneficiario_id) REFERENCES gravidade_protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_protocolo_beneficiario_citado_prestador_rede_id FOREIGN KEY (citado_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_protocolo_beneficiario_citado_contratante_plano_id FOREIGN KEY (citado_contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_protocolo_beneficiario_citado_beneficiari_9f3f6ef8 FOREIGN KEY (citado_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_protocolo_beneficiario_encerrada_por_usuario_id FOREIGN KEY (encerrada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE operadora_congenere
  ADD CONSTRAINT fk_operadora_congenere_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_federacao_operadora_congenere_id FOREIGN KEY (federacao_operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_camara_compensacao_id FOREIGN KEY (camara_compensacao_id) REFERENCES camara_compensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_pagamento_tabela_preco_id FOREIGN KEY (pagamento_tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_cobranca_tabela_preco_id FOREIGN KEY (cobranca_tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE operadora_congenere_municipio
  ADD CONSTRAINT fk_operadora_congenere_municipio_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_congenere_municipio_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE operadora_saude
  ADD CONSTRAINT fk_operadora_saude_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_saude_natureza_juridica_id FOREIGN KEY (natureza_juridica_id) REFERENCES natureza_juridica (id) ON DELETE RESTRICT;
ALTER TABLE operadora_saude_estabelecimento
  ADD CONSTRAINT fk_operadora_saude_estabelecimento_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_saude_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE operadora_saude_historico
  ADD CONSTRAINT fk_operadora_saude_historico_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operadora_saude_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE origem_cobranca_plano
  ADD CONSTRAINT fk_origem_cobranca_plano_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE origem_protocolo
  ADD CONSTRAINT fk_origem_protocolo_canal_atendimento_operadora_id FOREIGN KEY (canal_atendimento_operadora_id) REFERENCES canal_atendimento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE pacote_remuneracao_rede
  ADD CONSTRAINT fk_pacote_remuneracao_rede_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_remuneracao_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_remuneracao_rede_procedimento_item_faturavel_id FOREIGN KEY (procedimento_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_remuneracao_rede_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_remuneracao_rede_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT;
ALTER TABLE pacote_remuneracao_rede_item
  ADD CONSTRAINT fk_pacote_remuneracao_rede_item_pacote_remuneracao_rede_id FOREIGN KEY (pacote_remuneracao_rede_id) REFERENCES pacote_remuneracao_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_remuneracao_rede_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE participacao_societaria_operadora
  ADD CONSTRAINT fk_participacao_societaria_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participacao_societaria_operadora_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE participante_programa
  ADD CONSTRAINT fk_participante_programa_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_programa_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_programa_grupo_risco_saude_id FOREIGN KEY (grupo_risco_saude_id) REFERENCES grupo_risco_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_programa_responsavel_prestador_rede_id FOREIGN KEY (responsavel_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_programa_medico_assistente_prestador_rede_id FOREIGN KEY (medico_assistente_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_participante_programa_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE pedido_autorizacao_oculos
  ADD CONSTRAINT fk_pedido_autorizacao_oculos_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_oculos_pedido_autorizacao_plano_item_id FOREIGN KEY (pedido_autorizacao_plano_item_id) REFERENCES pedido_autorizacao_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_oculos_receita_arquivo_id FOREIGN KEY (receita_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE pedido_autorizacao_plano
  ADD CONSTRAINT fk_pedido_autorizacao_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_guia_principal_pedido_autor_f18893c5 FOREIGN KEY (guia_principal_pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_origem_guia_plano_id FOREIGN KEY (origem_guia_plano_id) REFERENCES origem_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_solicitante_prestador_rede_id FOREIGN KEY (solicitante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_solicitante_conselho_classe_id FOREIGN KEY (solicitante_conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_solicitante_unidade_federativa_id FOREIGN KEY (solicitante_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_solicitante_ocupacao_cbo_id FOREIGN KEY (solicitante_ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_executante_prestador_rede_id FOREIGN KEY (executante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_situacao_guia_plano_id FOREIGN KEY (situacao_guia_plano_id) REFERENCES situacao_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_auditor_plano_id FOREIGN KEY (auditor_plano_id) REFERENCES auditor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_motivo_decisao_autorizacao_id FOREIGN KEY (motivo_decisao_autorizacao_id) REFERENCES motivo_decisao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_decidida_por_usuario_id FOREIGN KEY (decidida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_motivo_cortesia_autorizacao_id FOREIGN KEY (motivo_cortesia_autorizacao_id) REFERENCES motivo_cortesia_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_motivo_cancelamento_guia_plano_id FOREIGN KEY (motivo_cancelamento_guia_plano_id) REFERENCES motivo_cancelamento_guia_plano (id) ON DELETE RESTRICT;
ALTER TABLE pedido_autorizacao_plano_anexo
  ADD CONSTRAINT fk_pedido_autorizacao_plano_anexo_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_anexo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE pedido_autorizacao_plano_diagnostico
  ADD CONSTRAINT fk_pedido_autorizacao_plano_diagnostico_pedido_autoriza_0e84e350 FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_diagnostico_pedido_autoriza_1e4bf9ec FOREIGN KEY (pedido_autorizacao_plano_anexo_id) REFERENCES pedido_autorizacao_plano_anexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_diagnostico_cid_termo_termi_eaf7b83a FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE pedido_autorizacao_plano_historico
  ADD CONSTRAINT fk_pedido_autorizacao_plano_historico_pedido_autorizaca_55bf9eef FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_historico_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_autorizacao_plano_item
  ADD CONSTRAINT fk_pedido_autorizacao_plano_item_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_item_motivo_decisao_autorizacao_id FOREIGN KEY (motivo_decisao_autorizacao_id) REFERENCES motivo_decisao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_autorizacao_plano_item_prorrogacao_internacao_plano_id FOREIGN KEY (prorrogacao_internacao_plano_id) REFERENCES prorrogacao_internacao_plano (id) ON DELETE RESTRICT;
ALTER TABLE pedido_reembolso
  ADD CONSTRAINT fk_pedido_reembolso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_modalidade_reembolso_id FOREIGN KEY (modalidade_reembolso_id) REFERENCES modalidade_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_solicitacao_portal_beneficiario_id FOREIGN KEY (solicitacao_portal_beneficiario_id) REFERENCES solicitacao_portal_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_prestador_conselho_classe_id FOREIGN KEY (prestador_conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_prestador_unidade_federativa_id FOREIGN KEY (prestador_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_tabela_reembolso_referencia_id FOREIGN KEY (tabela_reembolso_referencia_id) REFERENCES tabela_reembolso_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_analisado_por_usuario_id FOREIGN KEY (analisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_mensalidade_beneficiario_id FOREIGN KEY (mensalidade_beneficiario_id) REFERENCES mensalidade_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE pedido_reembolso_glosa
  ADD CONSTRAINT fk_pedido_reembolso_glosa_pedido_reembolso_item_id FOREIGN KEY (pedido_reembolso_item_id) REFERENCES pedido_reembolso_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_glosa_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_glosa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_reembolso_item
  ADD CONSTRAINT fk_pedido_reembolso_item_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_item_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE pedido_reembolso_oculos
  ADD CONSTRAINT fk_pedido_reembolso_oculos_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_oculos_pedido_reembolso_item_id FOREIGN KEY (pedido_reembolso_item_id) REFERENCES pedido_reembolso_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_reembolso_oculos_receita_arquivo_id FOREIGN KEY (receita_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
