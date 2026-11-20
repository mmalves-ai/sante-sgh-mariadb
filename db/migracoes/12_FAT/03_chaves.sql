-- Módulo FAT, lote 03: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE fatura_fonte_pagadora
  ADD CONSTRAINT fk_fatura_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_competencia_faturamento_id FOREIGN KEY (competencia_faturamento_id) REFERENCES competencia_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_fatura_origem_id FOREIGN KEY (fatura_origem_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_setor_responsavel_id FOREIGN KEY (setor_responsavel_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT;
ALTER TABLE fatura_fonte_pagadora_conta
  ADD CONSTRAINT fk_fatura_fonte_pagadora_conta_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_fonte_pagadora_conta_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE favorecido_repasse
  ADD CONSTRAINT fk_favorecido_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorecido_repasse_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorecido_repasse_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorecido_repasse_favorecido_pessoa_juridica_id FOREIGN KEY (favorecido_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorecido_repasse_cooperativa_medica_id FOREIGN KEY (cooperativa_medica_id) REFERENCES cooperativa_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorecido_repasse_favorecido_profissional_id FOREIGN KEY (favorecido_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorecido_repasse_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_competencia_fonte_pagadora
  ADD CONSTRAINT fk_fechamento_competencia_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_competencia_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_competencia_fonte_pagadora_competencia_id FOREIGN KEY (competencia_faturamento_id) REFERENCES competencia_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_competencia_fonte_pagadora_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_competencia_fonte_pagadora_reaberto_por_usuario_id FOREIGN KEY (reaberto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE fluxo_guia_etapa
  ADD CONSTRAINT fk_fluxo_guia_etapa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_guia_etapa_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE fluxo_guia_usuario
  ADD CONSTRAINT fk_fluxo_guia_usuario_fluxo_guia_etapa_id FOREIGN KEY (fluxo_guia_etapa_id) REFERENCES fluxo_guia_etapa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_guia_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE forma_envio_tuss
  ADD CONSTRAINT fk_forma_envio_tuss_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE formato_arquivo_conta_usuario
  ADD CONSTRAINT fk_formato_arquivo_conta_usuario_formato_arquivo_conta_id FOREIGN KEY (formato_arquivo_conta_id) REFERENCES formato_arquivo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formato_arquivo_conta_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE franquia_contrato
  ADD CONSTRAINT fk_franquia_contrato_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE franquia_contrato_excecao
  ADD CONSTRAINT fk_franquia_contrato_excecao_franquia_contrato_id FOREIGN KEY (franquia_contrato_id) REFERENCES franquia_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_excecao_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_excecao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_franquia_contrato_excecao_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE funcao_equipe_cobranca
  ADD CONSTRAINT fk_funcao_equipe_cobranca_grau_participacao_termo_id FOREIGN KEY (grau_participacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE glosa
  ADD CONSTRAINT fk_glosa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_demonstrativo_analise_conta_id FOREIGN KEY (demonstrativo_analise_conta_id) REFERENCES demonstrativo_analise_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_demonstrativo_pagamento_id FOREIGN KEY (demonstrativo_pagamento_id) REFERENCES demonstrativo_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE glosa_item
  ADD CONSTRAINT fk_glosa_item_glosa_id FOREIGN KEY (glosa_id) REFERENCES glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_demonstrativo_analise_conta_item_id FOREIGN KEY (demonstrativo_analise_conta_item_id) REFERENCES demonstrativo_analise_conta_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_justificativa_glosa_padrao_id FOREIGN KEY (justificativa_glosa_padrao_id) REFERENCES justificativa_glosa_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_recurso_glosa_id FOREIGN KEY (recurso_glosa_id) REFERENCES recurso_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_item_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE glosa_rateio
  ADD CONSTRAINT fk_glosa_rateio_glosa_id FOREIGN KEY (glosa_id) REFERENCES glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_rateio_glosa_item_id FOREIGN KEY (glosa_item_id) REFERENCES glosa_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_rateio_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_rateio_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_rateio_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE grupo_faturamento
  ADD CONSTRAINT fk_grupo_faturamento_receita_plano_contas_id FOREIGN KEY (receita_plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT;
ALTER TABLE grupo_repasse
  ADD CONSTRAINT fk_grupo_repasse_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT;
ALTER TABLE grupo_repasse_profissional
  ADD CONSTRAINT fk_grupo_repasse_profissional_grupo_repasse_id FOREIGN KEY (grupo_repasse_id) REFERENCES grupo_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_repasse_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_repasse_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE grupo_setor_plantao
  ADD CONSTRAINT fk_grupo_setor_plantao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE guia_anexo
  ADD CONSTRAINT fk_guia_anexo_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_anexo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE guia_fonte_pagadora
  ADD CONSTRAINT fk_guia_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_guia_principal_id FOREIGN KEY (guia_principal_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_solicitante_ocupacao_cbo_id FOREIGN KEY (solicitante_ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_solicitante_estabelecimento_externo_id FOREIGN KEY (solicitante_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_motivo_pendencia_guia_id FOREIGN KEY (motivo_pendencia_guia_id) REFERENCES motivo_pendencia_guia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_fluxo_guia_etapa_id FOREIGN KEY (fluxo_guia_etapa_id) REFERENCES fluxo_guia_etapa (id) ON DELETE RESTRICT;
ALTER TABLE guia_fonte_pagadora_item
  ADD CONSTRAINT fk_guia_fonte_pagadora_item_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_item_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_item_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_item_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE guia_fonte_pagadora_opme
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_guia_fonte_pagadora_item_id FOREIGN KEY (guia_fonte_pagadora_item_id) REFERENCES guia_fonte_pagadora_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_solicitacao_opme_item_id FOREIGN KEY (solicitacao_opme_item_id) REFERENCES solicitacao_opme_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_autorizacao_opme_id FOREIGN KEY (autorizacao_opme_id) REFERENCES autorizacao_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_cotacao_fornecedor_id FOREIGN KEY (cotacao_fornecedor_id) REFERENCES cotacao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fonte_pagadora_opme_fonte_referencia_matmed_id FOREIGN KEY (fonte_referencia_matmed_id) REFERENCES fonte_referencia_matmed (id) ON DELETE RESTRICT;
ALTER TABLE guia_historico
  ADD CONSTRAINT fk_guia_historico_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE guia_pendencia
  ADD CONSTRAINT fk_guia_pendencia_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_pendencia_motivo_pendencia_guia_id FOREIGN KEY (motivo_pendencia_guia_id) REFERENCES motivo_pendencia_guia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_pendencia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_pendencia_resolvido_por_usuario_id FOREIGN KEY (resolvido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE guia_tiss
  ADD CONSTRAINT fk_guia_tiss_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_guia_tiss_principal_id FOREIGN KEY (guia_tiss_principal_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_termo_versao_tiss_id FOREIGN KEY (termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_solicitante_estabelecimento_externo_id FOREIGN KEY (solicitante_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_tipo_atendimento_termo_terminologia_id FOREIGN KEY (tipo_atendimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_tipo_consulta_termo_terminologia_id FOREIGN KEY (tipo_consulta_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_indicador_acidente_termo_terminologia_id FOREIGN KEY (indicador_acidente_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_tipo_internacao_termo_terminologia_id FOREIGN KEY (tipo_internacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_regime_internacao_termo_terminologia_id FOREIGN KEY (regime_internacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_motivo_encerramento_termo_terminologia_id FOREIGN KEY (motivo_encerramento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE guia_tiss_despesa
  ADD CONSTRAINT fk_guia_tiss_despesa_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_despesa_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_despesa_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_despesa_unidade_medida_termo_terminologia_id FOREIGN KEY (unidade_medida_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE guia_tiss_diagnostico
  ADD CONSTRAINT fk_guia_tiss_diagnostico_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_diagnostico_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE guia_tiss_opme
  ADD CONSTRAINT fk_guia_tiss_opme_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_opme_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_opme_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_opme_guia_fonte_pagadora_opme_id FOREIGN KEY (guia_fonte_pagadora_opme_id) REFERENCES guia_fonte_pagadora_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_opme_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE guia_tiss_procedimento
  ADD CONSTRAINT fk_guia_tiss_procedimento_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_procedimento_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_procedimento_via_acesso_termo_terminologia_id FOREIGN KEY (via_acesso_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_procedimento_tecnica_termo_terminologia_id FOREIGN KEY (tecnica_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE guia_tiss_profissional
  ADD CONSTRAINT fk_guia_tiss_profissional_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_profissional_guia_tiss_procedimento_id FOREIGN KEY (guia_tiss_procedimento_id) REFERENCES guia_tiss_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_profissional_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_profissional_grau_participacao_termo_id FOREIGN KEY (grau_participacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_profissional_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_profissional_conselho_unidade_federativa_id FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_tiss_profissional_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE horario_normal_tabela
  ADD CONSTRAINT fk_horario_normal_tabela_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE importacao_tabela
  ADD CONSTRAINT fk_importacao_tabela_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_fonte_referencia_matmed_id FOREIGN KEY (fonte_referencia_matmed_id) REFERENCES fonte_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_aplicado_por_usuario_id FOREIGN KEY (aplicado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE importacao_tabela_diferenca
  ADD CONSTRAINT fk_importacao_tabela_diferenca_importacao_tabela_id FOREIGN KEY (importacao_tabela_id) REFERENCES importacao_tabela (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_diferenca_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_diferenca_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_importacao_tabela_diferenca_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE indicador_produtividade
  ADD CONSTRAINT fk_indicador_produtividade_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT;
ALTER TABLE item_alto_custo_contrato
  ADD CONSTRAINT fk_item_alto_custo_contrato_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_alto_custo_contrato_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_alto_custo_contrato_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_alto_custo_contrato_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE item_dispensado_auditoria
  ADD CONSTRAINT fk_item_dispensado_auditoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_dispensado_auditoria_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_dispensado_auditoria_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel
  ADD CONSTRAINT fk_item_faturavel_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_subgrupo_faturamento_id FOREIGN KEY (subgrupo_faturamento_id) REFERENCES subgrupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_grupo_ato_id FOREIGN KEY (grupo_ato_id) REFERENCES grupo_ato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel_acomodacao
  ADD CONSTRAINT fk_item_faturavel_acomodacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_acomodacao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_acomodacao_substituto_item_faturavel_id FOREIGN KEY (substituto_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel_cid
  ADD CONSTRAINT fk_item_faturavel_cid_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_cid_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel_codigo_barras
  ADD CONSTRAINT fk_item_faturavel_codigo_barras_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
