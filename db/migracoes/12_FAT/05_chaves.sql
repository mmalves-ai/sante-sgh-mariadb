-- Chaves do faturamento, lote 05 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE pacote_item_incluso
  ADD CONSTRAINT fk_pacote_item_incluso_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_incluso_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_incluso_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_incluso_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_incluso_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_incluso_item_faturavel_similar_id FOREIGN KEY (item_faturavel_similar_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_incluso_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_incluso_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE pacote_teto
  ADD CONSTRAINT fk_pacote_teto_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_teto_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE pacote_versao
  ADD CONSTRAINT fk_pacote_versao_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_conta
  ADD CONSTRAINT fk_pendencia_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_conta_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_conta_tipo_pendencia_conta_id FOREIGN KEY (tipo_pendencia_conta_id) REFERENCES tipo_pendencia_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_conta_justificativa_pendencia_id FOREIGN KEY (justificativa_pendencia_id) REFERENCES justificativa_pendencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_conta_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_conta_resolvido_por_usuario_id FOREIGN KEY (resolvido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE prazo_atendimento_guia
  ADD CONSTRAINT fk_prazo_atendimento_guia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_guia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_guia_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE prazo_recurso_fonte_pagadora
  ADD CONSTRAINT fk_prazo_recurso_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_recurso_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE pre_remessa
  ADD CONSTRAINT fk_pre_remessa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_remessa_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_remessa_competencia_faturamento_id FOREIGN KEY (competencia_faturamento_id) REFERENCES competencia_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_remessa_regra_criacao_conta_agrupamento_id FOREIGN KEY (regra_criacao_conta_agrupamento_id) REFERENCES regra_criacao_conta_agrupamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_remessa_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_remessa_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE pre_remessa_conta
  ADD CONSTRAINT fk_pre_remessa_conta_pre_remessa_id FOREIGN KEY (pre_remessa_id) REFERENCES pre_remessa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_remessa_conta_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_remessa_conta_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE preco_diaria_taxa
  ADD CONSTRAINT fk_preco_diaria_taxa_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_diaria_taxa_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_diaria_taxa_tipo_servico_faturavel_id FOREIGN KEY (tipo_servico_faturavel_id) REFERENCES tipo_servico_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_diaria_taxa_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_diaria_taxa_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_diaria_taxa_termo_versao_tiss_id FOREIGN KEY (termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_diaria_taxa_porte_procedimento_id FOREIGN KEY (porte_procedimento_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE preco_diaria_taxa_valor
  ADD CONSTRAINT fk_preco_diaria_taxa_valor_preco_diaria_taxa_id FOREIGN KEY (preco_diaria_taxa_id) REFERENCES preco_diaria_taxa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_diaria_taxa_valor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE preco_negociado_matmed
  ADD CONSTRAINT fk_preco_negociado_matmed_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_matmed_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_matmed_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_matmed_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_matmed_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_matmed_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_matmed_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_matmed_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE preco_negociado_procedimento
  ADD CONSTRAINT fk_preco_negociado_procedimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_procedimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_procedimento_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_procedimento_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_procedimento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_negociado_procedimento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE preco_procedimento
  ADD CONSTRAINT fk_preco_procedimento_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_procedimento_porte_procedimento_id FOREIGN KEY (porte_procedimento_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_procedimento_porte_anestesico_id FOREIGN KEY (porte_anestesico_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_procedimento_termo_versao_tiss_id FOREIGN KEY (termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE preco_procedimento_valor
  ADD CONSTRAINT fk_preco_procedimento_valor_preco_procedimento_id FOREIGN KEY (preco_procedimento_id) REFERENCES preco_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_procedimento_valor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE preco_referencia_matmed
  ADD CONSTRAINT fk_preco_referencia_matmed_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_referencia_matmed_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preco_referencia_matmed_edicao_referencia_matmed_id FOREIGN KEY (edicao_referencia_matmed_id) REFERENCES edicao_referencia_matmed (id) ON DELETE RESTRICT;
ALTER TABLE prestador_terceiro
  ADD CONSTRAINT fk_prestador_terceiro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_terceiro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_terceiro_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_terceiro_cooperativa_medica_id FOREIGN KEY (cooperativa_medica_id) REFERENCES cooperativa_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_terceiro_tipo_prestador_repasse_id FOREIGN KEY (tipo_prestador_repasse_id) REFERENCES tipo_prestador_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_terceiro_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_terceiro_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_terceiro_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE producao_repasse
  ADD CONSTRAINT fk_producao_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_competencia_faturamento_id FOREIGN KEY (competencia_faturamento_id) REFERENCES competencia_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_producao_repasse_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT;
ALTER TABLE profissional_funcao_equipe
  ADD CONSTRAINT fk_profissional_funcao_equipe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_funcao_equipe_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_recebimento
  ADD CONSTRAINT fk_protocolo_recebimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_recebimento_guia
  ADD CONSTRAINT fk_protocolo_recebimento_guia_protocolo_recebimento_id FOREIGN KEY (protocolo_recebimento_id) REFERENCES protocolo_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_guia_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_guia_guia_tiss_procedimento_id FOREIGN KEY (guia_tiss_procedimento_id) REFERENCES guia_tiss_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_guia_termo_versao_tiss_id FOREIGN KEY (termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_guia_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_guia_situacao_termo_versao_tiss_id FOREIGN KEY (situacao_termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_recebimento_situacao
  ADD CONSTRAINT fk_protocolo_recebimento_situacao_protocolo_recebimento_id FOREIGN KEY (protocolo_recebimento_id) REFERENCES protocolo_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_situacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_recebimento_situacao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE recurso_glosa
  ADD CONSTRAINT fk_recurso_glosa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_demonstrativo_pagamento_id FOREIGN KEY (demonstrativo_pagamento_id) REFERENCES demonstrativo_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_protocolo_recebimento_id FOREIGN KEY (protocolo_recebimento_id) REFERENCES protocolo_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recurso_glosa_anterior_id FOREIGN KEY (recurso_glosa_anterior_id) REFERENCES recurso_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE recurso_glosa_item
  ADD CONSTRAINT fk_recurso_glosa_item_recurso_glosa_id FOREIGN KEY (recurso_glosa_id) REFERENCES recurso_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_item_glosa_item_id FOREIGN KEY (glosa_item_id) REFERENCES glosa_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_item_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_item_justificativa_glosa_padrao_id FOREIGN KEY (justificativa_glosa_padrao_id) REFERENCES justificativa_glosa_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_item_desfecho_glosa_id FOREIGN KEY (desfecho_glosa_id) REFERENCES desfecho_glosa (id) ON DELETE RESTRICT;
ALTER TABLE referencia_emissao_matmed
  ADD CONSTRAINT fk_referencia_emissao_matmed_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_referencia_emissao_matmed_classificacao_despesa_id FOREIGN KEY (classificacao_despesa_id) REFERENCES classificacao_despesa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_referencia_emissao_matmed_fonte_referencia_matmed_id FOREIGN KEY (fonte_referencia_matmed_id) REFERENCES fonte_referencia_matmed (id) ON DELETE RESTRICT;
ALTER TABLE referencia_emissao_matmed_excecao
  ADD CONSTRAINT fk_referencia_emissao_matmed_excecao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_referencia_emissao_matmed_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_aceite_glosa
  ADD CONSTRAINT fk_regra_aceite_glosa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_aceite_glosa_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_aceite_glosa_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_aceite_glosa_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_aceite_glosa_justificativa_glosa_padrao_id FOREIGN KEY (justificativa_glosa_padrao_id) REFERENCES justificativa_glosa_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_aceite_glosa_desfecho_glosa_id FOREIGN KEY (desfecho_glosa_id) REFERENCES desfecho_glosa (id) ON DELETE RESTRICT;
ALTER TABLE regra_ajuste_permitido
  ADD CONSTRAINT fk_regra_ajuste_permitido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ajuste_permitido_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ajuste_permitido_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ajuste_permitido_motivo_ajuste_conta_id FOREIGN KEY (motivo_ajuste_conta_id) REFERENCES motivo_ajuste_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ajuste_permitido_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ajuste_permitido_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ajuste_permitido_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ajuste_permitido_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_apresentacao_tiss
  ADD CONSTRAINT fk_regra_apresentacao_tiss_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE regra_apresentacao_tiss_item
  ADD CONSTRAINT fk_regra_apresentacao_tiss_item_regra_apresentacao_tiss_id FOREIGN KEY (regra_apresentacao_tiss_id) REFERENCES regra_apresentacao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_item_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_apresentacao_tiss_item_termo_versao_tiss_id FOREIGN KEY (termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobranca_ambulancia
  ADD CONSTRAINT fk_regra_cobranca_ambulancia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_ambulancia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_ambulancia_categoria_ambulancia_id FOREIGN KEY (categoria_ambulancia_id) REFERENCES categoria_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_ambulancia_rota_ambulancia_id FOREIGN KEY (rota_ambulancia_id) REFERENCES rota_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_ambulancia_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobranca_atendimento
  ADD CONSTRAINT fk_regra_cobranca_atendimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_atendimento_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_atendimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobranca_ligacao
  ADD CONSTRAINT fk_regra_cobranca_ligacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_ligacao_tipo_ligacao_tarifada_id FOREIGN KEY (tipo_ligacao_tarifada_id) REFERENCES tipo_ligacao_tarifada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_ligacao_item_faturavel_minuto_id FOREIGN KEY (item_faturavel_minuto_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_ligacao_item_faturavel_segundo_id FOREIGN KEY (item_faturavel_segundo_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_consistencia_lancamento
  ADD CONSTRAINT fk_regra_consistencia_lancamento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_consistencia_lancamento_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_contabil_receita
  ADD CONSTRAINT fk_regra_contabil_receita_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_subgrupo_faturamento_id FOREIGN KEY (subgrupo_faturamento_id) REFERENCES subgrupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_conta_receita_id FOREIGN KEY (conta_receita_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_conta_receita_prevista_id FOREIGN KEY (conta_receita_prevista_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_conta_glosa_id FOREIGN KEY (conta_glosa_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_conta_glosa_aceita_id FOREIGN KEY (conta_glosa_aceita_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_conta_recuperacao_glosa_id FOREIGN KEY (conta_recuperacao_glosa_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_conta_deducao_id FOREIGN KEY (conta_deducao_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_receita_conta_transitoria_cliente_id FOREIGN KEY (conta_transitoria_cliente_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE regra_credito_producao
  ADD CONSTRAINT fk_regra_credito_producao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_credito_producao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_credito_producao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_credito_producao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_credito_producao_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT;
ALTER TABLE regra_criacao_conta
  ADD CONSTRAINT fk_regra_criacao_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_regra_criacao_conta_agrupamento_id FOREIGN KEY (regra_criacao_conta_agrupamento_id) REFERENCES regra_criacao_conta_agrupamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_origem_entrada_atendimento_id FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_formato_arquivo_conta_id FOREIGN KEY (formato_arquivo_conta_id) REFERENCES formato_arquivo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_fonte_pagadora_origem_id FOREIGN KEY (fonte_pagadora_origem_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_plano_origem_id FOREIGN KEY (plano_origem_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_fonte_pagadora_destino_id FOREIGN KEY (fonte_pagadora_destino_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_plano_destino_id FOREIGN KEY (plano_destino_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE regra_criacao_conta_agrupamento
  ADD CONSTRAINT fk_regra_criacao_conta_agrupamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_agrupamento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_agrupamento_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_agrupamento_origem_entrada_atendimento_id FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_agrupamento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_criacao_conta_excecao
  ADD CONSTRAINT fk_regra_criacao_conta_excecao_regra_criacao_conta_id FOREIGN KEY (regra_criacao_conta_id) REFERENCES regra_criacao_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_excecao_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_excecao_origem_entrada_atendimento_id FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_excecao_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_criacao_conta_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_desconto_grupo
  ADD CONSTRAINT fk_regra_desconto_grupo_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_grupo_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_grupo_subgrupo_faturamento_id FOREIGN KEY (subgrupo_faturamento_id) REFERENCES subgrupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE regra_desconto_procedimento
  ADD CONSTRAINT fk_regra_desconto_procedimento_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_desconto_volume
  ADD CONSTRAINT fk_regra_desconto_volume_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_volume_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_volume_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE regra_desconto_volume_faixa
  ADD CONSTRAINT fk_regra_desconto_volume_faixa_regra_desconto_volume_id FOREIGN KEY (regra_desconto_volume_id) REFERENCES regra_desconto_volume (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_volume_faixa_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_volume_faixa_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_desconto_volume_faixa_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE regra_fechamento_automatico_conta
  ADD CONSTRAINT fk_regra_fechamento_automatico_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fechamento_automatico_conta_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fechamento_automatico_conta_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fechamento_automatico_conta_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fechamento_automatico_conta_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fechamento_automatico_conta_origem_entrada_atendimento_ FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_grupo_faturamento_insumo
  ADD CONSTRAINT fk_regra_grupo_faturamento_insumo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_grupo_faturamento_insumo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_grupo_faturamento_insumo_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_grupo_faturamento_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_grupo_faturamento_insumo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_grupo_faturamento_insumo_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_grupo_faturamento_insumo_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
