-- FIN, lote 03 (F1.3): chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE conferencia_sessao_caixa
  ADD CONSTRAINT fk_conferencia_sessao_caixa_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_sessao_caixa_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_sessao_caixa_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_efd_contribuicoes
  ADD CONSTRAINT fk_configuracao_efd_contribuicoes_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_nota_servico
  ADD CONSTRAINT fk_configuracao_nota_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_nota_servico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_nota_servico_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_nota_servico_servico_municipal_id FOREIGN KEY (servico_municipal_id) REFERENCES servico_municipal (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_provisao_irpj_csll
  ADD CONSTRAINT fk_configuracao_provisao_irpj_csll_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_provisao_irpj_csll_irpj_debito_conta_contabil_id FOREIGN KEY (irpj_debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_provisao_irpj_csll_irpj_credito_conta_contabil_i FOREIGN KEY (irpj_credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_provisao_irpj_csll_irpj_historico_padrao_id FOREIGN KEY (irpj_historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_provisao_irpj_csll_csll_debito_conta_contabil_id FOREIGN KEY (csll_debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_provisao_irpj_csll_csll_credito_conta_contabil_i FOREIGN KEY (csll_credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_provisao_irpj_csll_csll_historico_padrao_id FOREIGN KEY (csll_historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE consolidacao_orcamento
  ADD CONSTRAINT fk_consolidacao_orcamento_consolidada_versao_orcamento_id FOREIGN KEY (consolidada_versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consolidacao_orcamento_componente_versao_orcamento_id FOREIGN KEY (componente_versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT;
ALTER TABLE conta_bancaria
  ADD CONSTRAINT fk_conta_bancaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_agencia_bancaria_id FOREIGN KEY (agencia_bancaria_id) REFERENCES agencia_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_pre_datado_conta_contabil_id FOREIGN KEY (pre_datado_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_cartao_conta_contabil_id FOREIGN KEY (cartao_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE conta_bancaria_credor
  ADD CONSTRAINT fk_conta_bancaria_credor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_credor_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_credor_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_credor_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_credor_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE conta_contabil
  ADD CONSTRAINT fk_conta_contabil_plano_contas_id FOREIGN KEY (plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_contabil_conta_pai_id FOREIGN KEY (conta_pai_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_contabil_conta_referencial_id FOREIGN KEY (conta_referencial_id) REFERENCES conta_referencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_contabil_resultado_conta_contabil_id FOREIGN KEY (resultado_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_contabil_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_contabil_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT;
ALTER TABLE conta_gerencial_consolidada
  ADD CONSTRAINT fk_conta_gerencial_consolidada_conta_pai_id FOREIGN KEY (conta_pai_id) REFERENCES conta_gerencial_consolidada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_gerencial_consolidada_resultado_conta_gerencial_id FOREIGN KEY (resultado_conta_gerencial_id) REFERENCES conta_gerencial_consolidada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_gerencial_consolidada_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE conta_orcamentaria
  ADD CONSTRAINT fk_conta_orcamentaria_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_orcamentaria_conta_pai_id FOREIGN KEY (conta_pai_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE conta_orcamentaria_composicao
  ADD CONSTRAINT fk_conta_orcamentaria_composicao_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_orcamentaria_composicao_componente_conta_orcamentaria_i FOREIGN KEY (componente_conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_orcamentaria_composicao_indicador_orcamentario_id FOREIGN KEY (indicador_orcamentario_id) REFERENCES indicador_orcamentario (id) ON DELETE RESTRICT;
ALTER TABLE conta_orcamentaria_estabelecimento
  ADD CONSTRAINT fk_conta_orcamentaria_estabelecimento_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_orcamentaria_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_orcamentaria_estabelecimento_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_orcamentaria_estabelecimento_conta_receita_custeio_id FOREIGN KEY (conta_receita_custeio_id) REFERENCES conta_receita_custeio (id) ON DELETE RESTRICT;
ALTER TABLE conta_orcamentaria_indicador
  ADD CONSTRAINT fk_conta_orcamentaria_indicador_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_orcamentaria_indicador_indicador_orcamentario_id FOREIGN KEY (indicador_orcamentario_id) REFERENCES indicador_orcamentario (id) ON DELETE RESTRICT;
ALTER TABLE conta_receita_custeio
  ADD CONSTRAINT fk_conta_receita_custeio_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE conta_referencial
  ADD CONSTRAINT fk_conta_referencial_plano_referencial_id FOREIGN KEY (plano_referencial_id) REFERENCES plano_referencial (id) ON DELETE RESTRICT;
ALTER TABLE contexto_trabalho_usuario
  ADD CONSTRAINT fk_contexto_trabalho_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contexto_trabalho_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contexto_trabalho_usuario_plano_contas_id FOREIGN KEY (plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT;
ALTER TABLE contrato_adiantamento_paciente
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_orcamento_particular_id FOREIGN KEY (orcamento_particular_id) REFERENCES orcamento_particular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_contratante_pessoa_fisica_id FOREIGN KEY (contratante_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_contratante_pessoa_juridica_id FOREIGN KEY (contratante_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_aceite_arquivo_id FOREIGN KEY (aceite_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_adiantamento_paciente_item
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_item_contrato_adiantamento_pac FOREIGN KEY (contrato_adiantamento_paciente_id) REFERENCES contrato_adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_item_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_item_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_item_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_adiantamento_paciente_item_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT;
ALTER TABLE contrato_cobranca_bancaria
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_remessa_leiaute_bancario_id FOREIGN KEY (remessa_leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_retorno_leiaute_bancario_id FOREIGN KEY (retorno_leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_boleto_leiaute_bancario_id FOREIGN KEY (boleto_leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_tarifa_empresa_fornecedora_id FOREIGN KEY (tarifa_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_cobranca_bancaria_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT;
ALTER TABLE contrato_fornecedor
  ADD CONSTRAINT fk_contrato_fornecedor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_gestor_usuario_id FOREIGN KEY (gestor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_contrato_anterior_id FOREIGN KEY (contrato_anterior_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_indice_reajuste_id FOREIGN KEY (indice_reajuste_id) REFERENCES indice_reajuste (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_motivo_situacao_contrato_id FOREIGN KEY (motivo_situacao_contrato_id) REFERENCES motivo_situacao_contrato (id) ON DELETE RESTRICT;
ALTER TABLE contrato_fornecedor_grupo_insumo
  ADD CONSTRAINT fk_contrato_fornecedor_grupo_insumo_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_grupo_insumo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_grupo_insumo_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_fornecedor_item
  ADD CONSTRAINT fk_contrato_fornecedor_item_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_item_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_item_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_fornecedor_item_indice_reajuste_id FOREIGN KEY (indice_reajuste_id) REFERENCES indice_reajuste (id) ON DELETE RESTRICT;
ALTER TABLE cota_depreciacao
  ADD CONSTRAINT fk_cota_depreciacao_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_depreciacao_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_depreciacao_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cotacao_moeda
  ADD CONSTRAINT fk_cotacao_moeda_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_moeda_base_moeda_id FOREIGN KEY (base_moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_moeda_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE credito_fonte_pagadora
  ADD CONSTRAINT fk_credito_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fonte_pagadora_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fonte_pagadora_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fonte_pagadora_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fonte_pagadora_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE credito_nao_identificado
  ADD CONSTRAINT fk_credito_nao_identificado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_credito_fonte_pagadora_id FOREIGN KEY (credito_fonte_pagadora_id) REFERENCES credito_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_nao_identificado_identificado_por_usuario_id FOREIGN KEY (identificado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE criterio_rateio
  ADD CONSTRAINT fk_criterio_rateio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_criterio_rateio_origem_centro_custo_id FOREIGN KEY (origem_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_criterio_rateio_conta_receita_custeio_id FOREIGN KEY (conta_receita_custeio_id) REFERENCES conta_receita_custeio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_criterio_rateio_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_criterio_rateio_unidade_mensuracao_custo_id FOREIGN KEY (unidade_mensuracao_custo_id) REFERENCES unidade_mensuracao_custo (id) ON DELETE RESTRICT;
ALTER TABLE cronograma_orcamento
  ADD CONSTRAINT fk_cronograma_orcamento_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cronograma_orcamento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE custo_conta_paciente
  ADD CONSTRAINT fk_custo_conta_paciente_apuracao_custo_id FOREIGN KEY (apuracao_custo_id) REFERENCES apuracao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_conta_paciente_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_conta_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_conta_paciente_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_conta_paciente_faixa_etaria_id FOREIGN KEY (faixa_etaria_id) REFERENCES faixa_etaria (id) ON DELETE RESTRICT;
ALTER TABLE custo_diaria_unidade
  ADD CONSTRAINT fk_custo_diaria_unidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_diaria_unidade_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_diaria_unidade_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_diaria_unidade_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE custo_gas_medicinal
  ADD CONSTRAINT fk_custo_gas_medicinal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_gas_medicinal_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_gas_medicinal_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_gas_medicinal_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_gas_medicinal_conta_receita_custeio_id FOREIGN KEY (conta_receita_custeio_id) REFERENCES conta_receita_custeio (id) ON DELETE RESTRICT;
ALTER TABLE custo_sala_cirurgica
  ADD CONSTRAINT fk_custo_sala_cirurgica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_sala_cirurgica_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT;
ALTER TABLE custo_unitario_centro
  ADD CONSTRAINT fk_custo_unitario_centro_apuracao_custo_id FOREIGN KEY (apuracao_custo_id) REFERENCES apuracao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_unitario_centro_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_unitario_centro_unidade_mensuracao_custo_id FOREIGN KEY (unidade_mensuracao_custo_id) REFERENCES unidade_mensuracao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_unitario_centro_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE dado_fiscal_item
  ADD CONSTRAINT fk_dado_fiscal_item_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_item_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_item_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT;
ALTER TABLE dado_fiscal_titulo_pagar
  ADD CONSTRAINT fk_dado_fiscal_titulo_pagar_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_titulo_pagar_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_titulo_pagar_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_titulo_pagar_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dado_fiscal_titulo_pagar_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_dctfweb
  ADD CONSTRAINT fk_declaracao_dctfweb_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_declaracao_retificada_id FOREIGN KEY (declaracao_retificada_id) REFERENCES declaracao_dctfweb (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_guia_recolhimento_id FOREIGN KEY (guia_recolhimento_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_aberta_por_usuario_id FOREIGN KEY (aberta_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_dctfweb_item
  ADD CONSTRAINT fk_declaracao_dctfweb_item_declaracao_dctfweb_id FOREIGN KEY (declaracao_dctfweb_id) REFERENCES declaracao_dctfweb (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_item_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_item_codigo_receita_federal_id FOREIGN KEY (codigo_receita_federal_id) REFERENCES codigo_receita_federal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_item_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dctfweb_item_retencao_titulo_id FOREIGN KEY (retencao_titulo_id) REFERENCES retencao_titulo (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_dmed
  ADD CONSTRAINT fk_declaracao_dmed_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dmed_declaracao_retificada_id FOREIGN KEY (declaracao_retificada_id) REFERENCES declaracao_dmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dmed_responsavel_pessoa_fisica_id FOREIGN KEY (responsavel_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dmed_representante_pessoa_fisica_id FOREIGN KEY (representante_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_dmed_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE deducao_iss_periodo
  ADD CONSTRAINT fk_deducao_iss_periodo_periodo_escrituracao_id FOREIGN KEY (periodo_escrituracao_id) REFERENCES periodo_escrituracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_deducao_iss_periodo_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT;
ALTER TABLE deducao_nota_servico
  ADD CONSTRAINT fk_deducao_nota_servico_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_deducao_nota_servico_regra_deducao_nota_servico_id FOREIGN KEY (regra_deducao_nota_servico_id) REFERENCES regra_deducao_nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_deducao_nota_servico_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE depara_centro_custo_externo
  ADD CONSTRAINT fk_depara_centro_custo_externo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_centro_custo_externo_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_centro_custo_externo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE depara_conta_consolidacao
  ADD CONSTRAINT fk_depara_conta_consolidacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_consolidacao_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_consolidacao_conta_gerencial_consolidada_id FOREIGN KEY (conta_gerencial_consolidada_id) REFERENCES conta_gerencial_consolidada (id) ON DELETE RESTRICT;
ALTER TABLE depara_conta_externa
  ADD CONSTRAINT fk_depara_conta_externa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_externa_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_externa_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_externa_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_externa_evento_contabil_id FOREIGN KEY (evento_contabil_id) REFERENCES evento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_externa_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_externa_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_conta_externa_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT;
ALTER TABLE depara_participante_externo
  ADD CONSTRAINT fk_depara_participante_externo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_participante_externo_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_participante_externo_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_participante_externo_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_participante_externo_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_participante_externo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_participante_externo_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT;
ALTER TABLE destino_criterio_rateio
  ADD CONSTRAINT fk_destino_criterio_rateio_criterio_rateio_id FOREIGN KEY (criterio_rateio_id) REFERENCES criterio_rateio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_destino_criterio_rateio_destino_centro_custo_id FOREIGN KEY (destino_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
