-- Chaves do faturamento, lote 04 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE item_faturavel_funcao_equipe
  ADD CONSTRAINT fk_item_faturavel_funcao_equipe_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_funcao_equipe_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_funcao_equipe_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_funcao_equipe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel_relacionado
  ADD CONSTRAINT fk_item_faturavel_relacionado_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_relacionado_relacionado_item_faturavel_id FOREIGN KEY (relacionado_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel_tributacao
  ADD CONSTRAINT fk_item_faturavel_tributacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_tributacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE item_faturavel_unidade_medida
  ADD CONSTRAINT fk_item_faturavel_unidade_medida_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_unidade_medida_unidade_termo_terminologia_id FOREIGN KEY (unidade_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_unidade_medida_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_faturavel_unidade_medida_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE item_isento_cobranca
  ADD CONSTRAINT fk_item_isento_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_isento_cobranca_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_isento_cobranca_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_isento_cobranca_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_isento_cobranca_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_isento_cobranca_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_isento_cobranca_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE item_referencia_matmed
  ADD CONSTRAINT fk_item_referencia_matmed_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_referencia_matmed_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE item_sem_executante
  ADD CONSTRAINT fk_item_sem_executante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_sem_executante_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_sem_executante_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_sem_executante_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_sem_executante_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_sem_executante_executante_padrao_profissional_id FOREIGN KEY (executante_padrao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE justificativa_glosa_padrao
  ADD CONSTRAINT fk_justificativa_glosa_padrao_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE kit_cobranca
  ADD CONSTRAINT fk_kit_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cobranca_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cobranca_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cobranca_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE kit_cobranca_item
  ADD CONSTRAINT fk_kit_cobranca_item_kit_cobranca_id FOREIGN KEY (kit_cobranca_id) REFERENCES kit_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cobranca_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_cobranca_item_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_contabil_receita
  ADD CONSTRAINT fk_lancamento_contabil_receita_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_evento_contabil_id FOREIGN KEY (evento_contabil_id) REFERENCES evento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_debito_conta_contabil_id FOREIGN KEY (debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_credito_conta_contabil_id FOREIGN KEY (credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_receita_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_origem_evento
  ADD CONSTRAINT fk_lancamento_origem_evento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_gerado_conta_hospitalar_item_id FOREIGN KEY (gerado_conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_origem_lancamento_id FOREIGN KEY (origem_lancamento_id) REFERENCES origem_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_origem_evento_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_repasse
  ADD CONSTRAINT fk_lancamento_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_favorecido_repasse_id FOREIGN KEY (favorecido_repasse_id) REFERENCES favorecido_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_estornado_lancamento_repasse_id FOREIGN KEY (estornado_lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_categoria_trabalhador_id FOREIGN KEY (categoria_trabalhador_id) REFERENCES categoria_trabalhador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_repasse_base
  ADD CONSTRAINT fk_lancamento_repasse_base_lancamento_repasse_id FOREIGN KEY (lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_base_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_base_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_base_evento_contabil_id FOREIGN KEY (evento_contabil_id) REFERENCES evento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_base_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_repasse_base_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE ligacao_tarifada
  ADD CONSTRAINT fk_ligacao_tarifada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ligacao_tarifada_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ligacao_tarifada_ramal_telefonico_id FOREIGN KEY (ramal_telefonico_id) REFERENCES ramal_telefonico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ligacao_tarifada_regra_cobranca_ligacao_id FOREIGN KEY (regra_cobranca_ligacao_id) REFERENCES regra_cobranca_ligacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ligacao_tarifada_lancamento_conta_hospitalar_item_id FOREIGN KEY (lancamento_conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
ALTER TABLE limite_opme_procedimento
  ADD CONSTRAINT fk_limite_opme_procedimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_opme_procedimento_alcada_aprovacao_id FOREIGN KEY (alcada_aprovacao_id) REFERENCES alcada_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE local_cobranca
  ADD CONSTRAINT fk_local_cobranca_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE lote_reajuste
  ADD CONSTRAINT fk_lote_reajuste_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reajuste_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reajuste_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reajuste_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reajuste_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reajuste_desfeito_por_usuario_id FOREIGN KEY (desfeito_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_reajuste_item
  ADD CONSTRAINT fk_lote_reajuste_item_lote_reajuste_id FOREIGN KEY (lote_reajuste_id) REFERENCES lote_reajuste (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reajuste_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reajuste_item_preco_procedimento_id FOREIGN KEY (preco_procedimento_id) REFERENCES preco_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE lote_tiss
  ADD CONSTRAINT fk_lote_tiss_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_original_lote_tiss_id FOREIGN KEY (original_lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_protocolo_recebimento_id FOREIGN KEY (protocolo_recebimento_id) REFERENCES protocolo_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE lote_tiss_conta
  ADD CONSTRAINT fk_lote_tiss_conta_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_conta_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_conta_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_tiss_conta_recurso_glosa_id FOREIGN KEY (recurso_glosa_id) REFERENCES recurso_glosa (id) ON DELETE RESTRICT;
ALTER TABLE membro_cooperativa
  ADD CONSTRAINT fk_membro_cooperativa_cooperativa_medica_id FOREIGN KEY (cooperativa_medica_id) REFERENCES cooperativa_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_membro_cooperativa_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_faturamento
  ADD CONSTRAINT fk_mensagem_faturamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_faturamento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE modelo_orcamento
  ADD CONSTRAINT fk_modelo_orcamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_orcamento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_orcamento_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_orcamento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE modelo_orcamento_item
  ADD CONSTRAINT fk_modelo_orcamento_item_modelo_orcamento_id FOREIGN KEY (modelo_orcamento_id) REFERENCES modelo_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_orcamento_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_orcamento_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_orcamento_item_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE motivo_glosa
  ADD CONSTRAINT fk_motivo_glosa_grupo_motivo_glosa_id FOREIGN KEY (grupo_motivo_glosa_id) REFERENCES grupo_motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE motivo_glosa_fonte_pagadora
  ADD CONSTRAINT fk_motivo_glosa_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motivo_glosa_fonte_pagadora_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE nota_fatura
  ADD CONSTRAINT fk_nota_fatura_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fatura_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fatura_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_fatura_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT;
ALTER TABLE orcamento_particular
  ADD CONSTRAINT fk_orcamento_particular_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_modelo_orcamento_id FOREIGN KEY (modelo_orcamento_id) REFERENCES modelo_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_indicador_profissional_id FOREIGN KEY (indicador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_anestesista_profissional_id FOREIGN KEY (anestesista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_gerada_conta_hospitalar_id FOREIGN KEY (gerada_conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE orcamento_particular_item
  ADD CONSTRAINT fk_orcamento_particular_item_orcamento_particular_id FOREIGN KEY (orcamento_particular_id) REFERENCES orcamento_particular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_particular_item_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE pacote
  ADD CONSTRAINT fk_pacote_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_cobranca_item_faturavel_id FOREIGN KEY (cobranca_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE pacote_cid
  ADD CONSTRAINT fk_pacote_cid_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_cid_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE pacote_contrato
  ADD CONSTRAINT fk_pacote_contrato_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_contrato_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_contrato_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_contrato_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_contrato_local_cobranca_id FOREIGN KEY (local_cobranca_id) REFERENCES local_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_contrato_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_contrato_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE pacote_diaria_acomodacao
  ADD CONSTRAINT fk_pacote_diaria_acomodacao_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diaria_acomodacao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diaria_acomodacao_diaria_item_faturavel_id FOREIGN KEY (diaria_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diaria_acomodacao_complementar_item_faturavel_id FOREIGN KEY (complementar_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diaria_acomodacao_adicional_item_faturavel_id FOREIGN KEY (adicional_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE pacote_excecao
  ADD CONSTRAINT fk_pacote_excecao_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_excecao_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_excecao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_excecao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT;
