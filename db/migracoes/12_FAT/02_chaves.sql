-- FAT, lote 02: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE conta_hospitalar_unificacao
  ADD CONSTRAINT fk_conta_hospitalar_unificacao_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_unificacao_origem_conta_hospitalar_id FOREIGN KEY (origem_conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_unificacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contrato_fonte_pagadora
  ADD CONSTRAINT fk_contrato_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fonte_pagadora_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_fonte_pagadora_versao
  ADD CONSTRAINT fk_contrato_fonte_pagadora_versao_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fonte_pagadora_versao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fonte_pagadora_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contrato_prestador_repasse
  ADD CONSTRAINT fk_contrato_prestador_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_prestador_repasse_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_prestador_repasse_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_prestador_repasse_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_prestador_repasse_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_servico
  ADD CONSTRAINT fk_contrato_servico_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_servico_tipo_servico_faturavel_id FOREIGN KEY (tipo_servico_faturavel_id) REFERENCES tipo_servico_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE contrato_tabela_vigencia
  ADD CONSTRAINT fk_contrato_tabela_vigencia_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_tabela_vigencia_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_tabela_vigencia_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_tabela_vigencia_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE cooperativa_medica
  ADD CONSTRAINT fk_cooperativa_medica_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cooperativa_medica_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE coparticipacao_contrato
  ADD CONSTRAINT fk_coparticipacao_contrato_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_coparticipacao_contrato_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_coparticipacao_contrato_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_coparticipacao_contrato_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE credenciamento_cobranca
  ADD CONSTRAINT fk_credenciamento_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credenciamento_cobranca_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credenciamento_cobranca_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credenciamento_cobranca_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credenciamento_cobranca_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credenciamento_cobranca_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credenciamento_cobranca_grupo_ato_id FOREIGN KEY (grupo_ato_id) REFERENCES grupo_ato (id) ON DELETE RESTRICT;
ALTER TABLE custo_profissional
  ADD CONSTRAINT fk_custo_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_profissional_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_profissional_tipo_desconto_repasse_id FOREIGN KEY (tipo_desconto_repasse_id) REFERENCES tipo_desconto_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_profissional_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_analise_conta
  ADD CONSTRAINT fk_demonstrativo_analise_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_processado_usuario_id FOREIGN KEY (processado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_analise_conta_item
  ADD CONSTRAINT fk_demonstrativo_analise_conta_item_demonstrativo_analise_fe680b FOREIGN KEY (demonstrativo_analise_conta_id) REFERENCES demonstrativo_analise_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_item_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_conta_item_glosa_item_id FOREIGN KEY (glosa_item_id) REFERENCES glosa_item (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_deducao
  ADD CONSTRAINT fk_demonstrativo_deducao_demonstrativo_pagamento_id FOREIGN KEY (demonstrativo_pagamento_id) REFERENCES demonstrativo_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_deducao_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_pagamento
  ADD CONSTRAINT fk_demonstrativo_pagamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_pagamento_item
  ADD CONSTRAINT fk_demonstrativo_pagamento_item_demonstrativo_pagamento_id FOREIGN KEY (demonstrativo_pagamento_id) REFERENCES demonstrativo_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_item_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_item_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_item_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE dependente_irrf_profissional
  ADD CONSTRAINT fk_dependente_irrf_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dependente_irrf_profissional_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT;
ALTER TABLE descaracterizacao_pacote
  ADD CONSTRAINT fk_descaracterizacao_pacote_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descaracterizacao_pacote_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descaracterizacao_pacote_conta_hospitalar_pacote_id FOREIGN KEY (conta_hospitalar_pacote_id) REFERENCES conta_hospitalar_pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descaracterizacao_pacote_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descaracterizacao_pacote_motivo_descaracterizacao_pacote_id FOREIGN KEY (motivo_descaracterizacao_pacote_id) REFERENCES motivo_descaracterizacao_pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descaracterizacao_pacote_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descaracterizacao_pacote_revertido_usuario_id FOREIGN KEY (revertido_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE desconto_custo_repasse
  ADD CONSTRAINT fk_desconto_custo_repasse_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desconto_custo_repasse_custo_profissional_id FOREIGN KEY (custo_profissional_id) REFERENCES custo_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desconto_custo_repasse_tipo_desconto_repasse_id FOREIGN KEY (tipo_desconto_repasse_id) REFERENCES tipo_desconto_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desconto_custo_repasse_lancamento_repasse_id FOREIGN KEY (lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE diaria_por_plano_local
  ADD CONSTRAINT fk_diaria_por_plano_local_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_por_plano_local_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_por_plano_local_local_cobranca_id FOREIGN KEY (local_cobranca_id) REFERENCES local_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_por_plano_local_preco_diaria_taxa_id FOREIGN KEY (preco_diaria_taxa_id) REFERENCES preco_diaria_taxa (id) ON DELETE RESTRICT;
ALTER TABLE diaria_taxa_centro_custo
  ADD CONSTRAINT fk_diaria_taxa_centro_custo_preco_diaria_taxa_id FOREIGN KEY (preco_diaria_taxa_id) REFERENCES preco_diaria_taxa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_taxa_centro_custo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE edicao_referencia_matmed
  ADD CONSTRAINT fk_edicao_referencia_matmed_fonte_referencia_matmed_id FOREIGN KEY (fonte_referencia_matmed_id) REFERENCES fonte_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_edicao_referencia_matmed_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_edicao_referencia_matmed_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE empresa_auditoria_externa
  ADD CONSTRAINT fk_empresa_auditoria_externa_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE empresa_calculo_cumulativo_rpa
  ADD CONSTRAINT fk_empresa_calculo_cumulativo_rpa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_calculo_cumulativo_rpa_considerado_estabelecimento_id FOREIGN KEY (considerado_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE endpoint_tiss_fonte_pagadora
  ADD CONSTRAINT fk_endpoint_tiss_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endpoint_tiss_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endpoint_tiss_fonte_pagadora_transacao_tiss_webservice_id FOREIGN KEY (transacao_tiss_webservice_id) REFERENCES transacao_tiss_webservice (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endpoint_tiss_fonte_pagadora_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE envio_documento_tiss
  ADD CONSTRAINT fk_envio_documento_tiss_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE envio_documento_tiss_item
  ADD CONSTRAINT fk_envio_documento_tiss_item_envio_documento_tiss_id FOREIGN KEY (envio_documento_tiss_id) REFERENCES envio_documento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_item_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_documento_tiss_item_tipo_documento_termo_termino_5ce586 FOREIGN KEY (tipo_documento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE equipe_repasse_variavel
  ADD CONSTRAINT fk_equipe_repasse_variavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE equipe_repasse_variavel_membro
  ADD CONSTRAINT fk_equipe_repasse_variavel_membro_equipe_repasse_variavel_id FOREIGN KEY (equipe_repasse_variavel_id) REFERENCES equipe_repasse_variavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_repasse_variavel_membro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_repasse_variavel_membro_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_item_fonte_pagadora
  ADD CONSTRAINT fk_equivalencia_item_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_item_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_item_fonte_pagadora_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_item_fonte_pagadora_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_item_fonte_pagadora_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_matmed_fonte_pagadora
  ADD CONSTRAINT fk_equivalencia_matmed_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_matmed_fonte_pagadora_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_matmed_produto
  ADD CONSTRAINT fk_equivalencia_matmed_produto_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_matmed_produto_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_matmed_tuss
  ADD CONSTRAINT fk_equivalencia_matmed_tuss_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_matmed_tuss_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE estabelecimento_repasse
  ADD CONSTRAINT fk_estabelecimento_repasse_faturador_estabelecimento_id FOREIGN KEY (faturador_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_repasse_apurador_estabelecimento_id FOREIGN KEY (apurador_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_repasse_pagador_estabelecimento_id FOREIGN KEY (pagador_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE estorno_repasse
  ADD CONSTRAINT fk_estorno_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estorno_repasse_producao_repasse_id FOREIGN KEY (producao_repasse_id) REFERENCES producao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estorno_repasse_lancamento_repasse_id FOREIGN KEY (lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estorno_repasse_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estorno_repasse_glosa_item_id FOREIGN KEY (glosa_item_id) REFERENCES glosa_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estorno_repasse_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estorno_repasse_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE evento_repasse
  ADD CONSTRAINT fk_evento_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_categoria_trabalhador_id FOREIGN KEY (categoria_trabalhador_id) REFERENCES categoria_trabalhador (id) ON DELETE RESTRICT;
ALTER TABLE evento_repasse_contabil
  ADD CONSTRAINT fk_evento_repasse_contabil_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_contabil_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_contabil_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_contabil_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_contabil_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE evento_repasse_incidencia
  ADD CONSTRAINT fk_evento_repasse_incidencia_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_incidencia_natureza_rubrica_id FOREIGN KEY (natureza_rubrica_id) REFERENCES natureza_rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_incidencia_inss_codigo_incidencia_rubrica_id FOREIGN KEY (inss_codigo_incidencia_rubrica_id) REFERENCES codigo_incidencia_rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_repasse_incidencia_irrf_codigo_incidencia_rubrica_id FOREIGN KEY (irrf_codigo_incidencia_rubrica_id) REFERENCES codigo_incidencia_rubrica (id) ON DELETE RESTRICT;
ALTER TABLE excecao_credenciamento
  ADD CONSTRAINT fk_excecao_credenciamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_credenciamento_cobranca_id FOREIGN KEY (credenciamento_cobranca_id) REFERENCES credenciamento_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_credenciamento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE faixa_desconto_permanencia
  ADD CONSTRAINT fk_faixa_desconto_permanencia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_desconto_permanencia_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE faixa_fator_tabela
  ADD CONSTRAINT fk_faixa_fator_tabela_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_fator_tabela_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_fator_tabela_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE faixa_numeracao_guia
  ADD CONSTRAINT fk_faixa_numeracao_guia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_numeracao_guia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE faixa_numeracao_guia_uso
  ADD CONSTRAINT fk_faixa_numeracao_guia_uso_faixa_numeracao_guia_id FOREIGN KEY (faixa_numeracao_guia_id) REFERENCES faixa_numeracao_guia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_numeracao_guia_uso_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_numeracao_guia_uso_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE fator_acomodacao
  ADD CONSTRAINT fk_fator_acomodacao_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fator_acomodacao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fator_acomodacao_diferenca_item_faturavel_id FOREIGN KEY (diferenca_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
