-- Módulo SGO, lote 04: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE fatura_plano
  ADD CONSTRAINT fk_fatura_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_responsavel_beneficiario_plano_id FOREIGN KEY (responsavel_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_lote_faturamento_plano_id FOREIGN KEY (lote_faturamento_plano_id) REFERENCES lote_faturamento_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_fatura_origem_id FOREIGN KEY (fatura_origem_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_forma_cobranca_plano_id FOREIGN KEY (forma_cobranca_plano_id) REFERENCES forma_cobranca_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_forma_emissao_documento_id FOREIGN KEY (forma_emissao_documento_id) REFERENCES forma_emissao_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_cancelada_por_usuario_id FOREIGN KEY (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_motivo_ajuste_fatura_id FOREIGN KEY (motivo_ajuste_fatura_id) REFERENCES motivo_ajuste_fatura (id) ON DELETE RESTRICT;
ALTER TABLE fatura_plano_item
  ADD CONSTRAINT fk_fatura_plano_item_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_item_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_item_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE fatura_plano_tributo
  ADD CONSTRAINT fk_fatura_plano_tributo_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_plano_tributo_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT;
ALTER TABLE fornecimento_beneficiario
  ADD CONSTRAINT fk_fornecimento_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_procedimento_termo_terminologia_id FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_fornecedor_prestador_rede_id FOREIGN KEY (fornecedor_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_prescricao_arquivo_id FOREIGN KEY (prescricao_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fornecimento_beneficiario_situacao_fornecimento_id FOREIGN KEY (situacao_fornecimento_id) REFERENCES situacao_fornecimento (id) ON DELETE RESTRICT;
ALTER TABLE funcao_equipe_procedimento_rede
  ADD CONSTRAINT fk_funcao_equipe_procedimento_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_equipe_procedimento_rede_procedimento_termo_t_71f2f1aa FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_equipe_procedimento_rede_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE glosa_conta_recebida
  ADD CONSTRAINT fk_glosa_conta_recebida_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_conta_recebida_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_conta_recebida_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_conta_recebida_glosado_por_usuario_id FOREIGN KEY (glosado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE grupo_carencia_procedimento
  ADD CONSTRAINT fk_grupo_carencia_procedimento_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_carencia_procedimento_procedimento_termo_termi_7953ff84 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_carencia_procedimento_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE grupo_economico_contratante
  ADD CONSTRAINT fk_grupo_economico_contratante_grupo_economico_pai_id FOREIGN KEY (grupo_economico_pai_id) REFERENCES grupo_economico_contratante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_economico_contratante_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE grupo_patologia
  ADD CONSTRAINT fk_grupo_patologia_grupo_risco_saude_id FOREIGN KEY (grupo_risco_saude_id) REFERENCES grupo_risco_saude (id) ON DELETE RESTRICT;
ALTER TABLE grupo_patologia_cid
  ADD CONSTRAINT fk_grupo_patologia_cid_grupo_patologia_id FOREIGN KEY (grupo_patologia_id) REFERENCES grupo_patologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_patologia_cid_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE grupo_postagem_cobranca
  ADD CONSTRAINT fk_grupo_postagem_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_postagem_cobranca_forma_emissao_documento_id FOREIGN KEY (forma_emissao_documento_id) REFERENCES forma_emissao_documento (id) ON DELETE RESTRICT;
ALTER TABLE grupo_postagem_cobranca_municipio
  ADD CONSTRAINT fk_grupo_postagem_cobranca_municipio_grupo_postagem_cobranca_id FOREIGN KEY (grupo_postagem_cobranca_id) REFERENCES grupo_postagem_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_postagem_cobranca_municipio_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE grupo_procedimento_operadora
  ADD CONSTRAINT fk_grupo_procedimento_operadora_grupo_pai_id FOREIGN KEY (grupo_pai_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE grupo_risco_saude
  ADD CONSTRAINT fk_grupo_risco_saude_responsavel_prestador_rede_id FOREIGN KEY (responsavel_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE guia_conta_recebida
  ADD CONSTRAINT fk_guia_conta_recebida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_executante_prestador_rede_id FOREIGN KEY (executante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_solicitante_prestador_rede_id FOREIGN KEY (solicitante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_guia_reapresentada_id FOREIGN KEY (guia_reapresentada_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_regime_atendimento_internacao_id FOREIGN KEY (regime_atendimento_internacao_id) REFERENCES regime_atendimento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_motivo_saida_hospitalar_id FOREIGN KEY (motivo_saida_hospitalar_id) REFERENCES motivo_saida_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_auditor_plano_id FOREIGN KEY (auditor_plano_id) REFERENCES auditor_plano (id) ON DELETE RESTRICT;
ALTER TABLE guia_conta_recebida_declaracao
  ADD CONSTRAINT fk_guia_conta_recebida_declaracao_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_declaracao_cid_obito_termo_termi_e11921ca FOREIGN KEY (cid_obito_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE guia_conta_recebida_diagnostico
  ADD CONSTRAINT fk_guia_conta_recebida_diagnostico_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_diagnostico_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE guia_conta_recebida_equipe
  ADD CONSTRAINT fk_guia_conta_recebida_equipe_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_equipe_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_equipe_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_equipe_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_equipe_conselho_unidade_federativa_id FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_equipe_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_equipe_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE guia_conta_recebida_item
  ADD CONSTRAINT fk_guia_conta_recebida_item_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_item_procedimento_termo_terminologia_id FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_item_executante_prestador_rede_id FOREIGN KEY (executante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_conta_recebida_item_pacote_remuneracao_rede_id FOREIGN KEY (pacote_remuneracao_rede_id) REFERENCES pacote_remuneracao_rede (id) ON DELETE RESTRICT;
ALTER TABLE guia_leitura_contrato_plano
  ADD CONSTRAINT fk_guia_leitura_contrato_plano_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_leitura_contrato_plano_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_leitura_contrato_plano_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE guia_leitura_contratual_entrega
  ADD CONSTRAINT fk_guia_leitura_contratual_entrega_guia_leitura_contrat_d17b777d FOREIGN KEY (guia_leitura_contrato_plano_id) REFERENCES guia_leitura_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_leitura_contratual_entrega_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_leitura_contratual_entrega_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE guia_leitura_contratual_item
  ADD CONSTRAINT fk_guia_leitura_contratual_item_guia_leitura_contrato_plano_id FOREIGN KEY (guia_leitura_contrato_plano_id) REFERENCES guia_leitura_contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE impugnacao_ressarcimento_sus
  ADD CONSTRAINT fk_impugnacao_ressarcimento_sus_ressarcimento_sus_atendimento_id FOREIGN KEY (ressarcimento_sus_atendimento_id) REFERENCES ressarcimento_sus_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impugnacao_ressarcimento_sus_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impugnacao_ressarcimento_sus_documentacao_arquivo_id FOREIGN KEY (documentacao_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE incidencia_lancamento_fatura
  ADD CONSTRAINT fk_incidencia_lancamento_fatura_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incidencia_lancamento_fatura_base_tipo_lancamento_fatura_id FOREIGN KEY (base_tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incidencia_lancamento_fatura_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE indice_reajuste_tipo_lancamento
  ADD CONSTRAINT fk_indice_reajuste_tipo_lancamento_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indice_reajuste_tipo_lancamento_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE isencao_franquia_beneficiario
  ADD CONSTRAINT fk_isencao_franquia_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isencao_franquia_beneficiario_procedimento_termo_ter_88ed5a48 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isencao_franquia_beneficiario_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isencao_franquia_beneficiario_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isencao_franquia_beneficiario_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE item_assistencial_ans
  ADD CONSTRAINT fk_item_assistencial_ans_item_pai_id FOREIGN KEY (item_pai_id) REFERENCES item_assistencial_ans (id) ON DELETE RESTRICT;
ALTER TABLE item_assistencial_ans_criterio
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_item_assistencial_ans_id FOREIGN KEY (item_assistencial_ans_id) REFERENCES item_assistencial_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_procedimento_termo_te_a6947ad9 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_classe_despesa_assistencial_id FOREIGN KEY (classe_despesa_assistencial_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_cid_inicial_termo_ter_0f72e07f FOREIGN KEY (cid_inicial_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_cid_final_termo_termi_f92846ae FOREIGN KEY (cid_final_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_regime_atendimento_in_e8adf7b0 FOREIGN KEY (regime_atendimento_internacao_id) REFERENCES regime_atendimento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_assistencial_ans_criterio_segmentacao_assistencial_id FOREIGN KEY (segmentacao_assistencial_id) REFERENCES segmentacao_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE junta_divergencia_tecnica
  ADD CONSTRAINT fk_junta_divergencia_tecnica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_auditor_plano_id FOREIGN KEY (auditor_plano_id) REFERENCES auditor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_assistente_conselho_classe_id FOREIGN KEY (assistente_conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_assistente_unidade_federativa_id FOREIGN KEY (assistente_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_desempatador_conselho_classe_id FOREIGN KEY (desempatador_conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_desempatador_unidade_federativa_id FOREIGN KEY (desempatador_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_junta_divergencia_tecnica_parecer_arquivo_id FOREIGN KEY (parecer_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_avulso_prestador
  ADD CONSTRAINT fk_lancamento_avulso_prestador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_classe_despesa_assistencial_id FOREIGN KEY (classe_despesa_assistencial_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_procedimento_termo_termi_b661c17c FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_lote_pagamento_rede_id FOREIGN KEY (lote_pagamento_rede_id) REFERENCES lote_pagamento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_avulso_prestador_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_conta_beneficiario
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_conta_beneficiario_estornado_lancamento_id FOREIGN KEY (estornado_lancamento_id) REFERENCES lancamento_conta_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_coparticipacao
  ADD CONSTRAINT fk_lancamento_coparticipacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_regra_coparticipacao_id FOREIGN KEY (regra_coparticipacao_id) REFERENCES regra_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_guia_conta_recebida_equipe_id FOREIGN KEY (guia_conta_recebida_equipe_id) REFERENCES guia_conta_recebida_equipe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_pedido_autorizacao_plano_item_id FOREIGN KEY (pedido_autorizacao_plano_item_id) REFERENCES pedido_autorizacao_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_forma_pagamento_coparticipacao_id FOREIGN KEY (forma_pagamento_coparticipacao_id) REFERENCES forma_pagamento_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_isencao_franquia_beneficiario_id FOREIGN KEY (isencao_franquia_beneficiario_id) REFERENCES isencao_franquia_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_fatura_plano_item_id FOREIGN KEY (fatura_plano_item_id) REFERENCES fatura_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_coparticipacao_motivo_ajuste_fatura_id FOREIGN KEY (motivo_ajuste_fatura_id) REFERENCES motivo_ajuste_fatura (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_programado_contrato
  ADD CONSTRAINT fk_lancamento_programado_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_campanha_comercial_plano_id FOREIGN KEY (campanha_comercial_plano_id) REFERENCES campanha_comercial_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_reajuste_contrato_plano_id FOREIGN KEY (reajuste_contrato_plano_id) REFERENCES reajuste_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_programado_contrato_faixa
  ADD CONSTRAINT fk_lancamento_programado_contrato_faixa_lancamento_prog_212ef8ab FOREIGN KEY (lancamento_programado_contrato_id) REFERENCES lancamento_programado_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_faixa_grau_parentesco_82f1beaf FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_faixa_classe_benefici_9c58f6b3 FOREIGN KEY (classe_beneficiario_plano_id) REFERENCES classe_beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_programado_contrato_faixa_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT;
ALTER TABLE limite_producao_prestador
  ADD CONSTRAINT fk_limite_producao_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_producao_prestador_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_producao_prestador_procedimento_termo_terminologia_id FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_producao_prestador_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_producao_prestador_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE limite_producao_prestador_faixa
  ADD CONSTRAINT fk_limite_producao_prestador_faixa_limite_producao_prestador_id FOREIGN KEY (limite_producao_prestador_id) REFERENCES limite_producao_prestador (id) ON DELETE RESTRICT;
