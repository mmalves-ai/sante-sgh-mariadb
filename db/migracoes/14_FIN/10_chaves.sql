-- Chaves do módulo FIN, lote 10 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE titulo_pagar
  ADD CONSTRAINT fk_titulo_pagar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_tipo_credor_id FOREIGN KEY (tipo_credor_id) REFERENCES tipo_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_lancamento_repasse_id FOREIGN KEY (lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_nota_empenho_id FOREIGN KEY (nota_empenho_id) REFERENCES nota_empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_referencia_titulo_pagar_id FOREIGN KEY (referencia_titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_pagar_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE titulo_receber
  ADD CONSTRAINT fk_titulo_receber_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_renegociacao_id FOREIGN KEY (renegociacao_id) REFERENCES renegociacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_contrato_cobranca_bancaria_id FOREIGN KEY (contrato_cobranca_bancaria_id) REFERENCES contrato_cobranca_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_receber_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE titulo_renegociado
  ADD CONSTRAINT fk_titulo_renegociado_renegociacao_id FOREIGN KEY (renegociacao_id) REFERENCES renegociacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_renegociado_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT;
ALTER TABLE transacao_cartao
  ADD CONSTRAINT fk_transacao_cartao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_administradora_cartao_id FOREIGN KEY (administradora_cartao_id) REFERENCES administradora_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_bandeira_cartao_id FOREIGN KEY (bandeira_cartao_id) REFERENCES bandeira_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_terminal_cartao_id FOREIGN KEY (terminal_cartao_id) REFERENCES terminal_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_caixa_id FOREIGN KEY (caixa_id) REFERENCES caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_operador_usuario_id FOREIGN KEY (operador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_estornada_transacao_cartao_id FOREIGN KEY (estornada_transacao_cartao_id) REFERENCES transacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_cartao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE transacao_intercompanhia
  ADD CONSTRAINT fk_transacao_intercompanhia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_contraparte_estabelecimento_id FOREIGN KEY (contraparte_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_contraparte_conta_contabil_id FOREIGN KEY (contraparte_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transacao_intercompanhia_apuracao_consolidacao_id FOREIGN KEY (apuracao_consolidacao_id) REFERENCES apuracao_consolidacao (id) ON DELETE RESTRICT;
ALTER TABLE transferencia_bancaria
  ADD CONSTRAINT fk_transferencia_bancaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_origem_conta_bancaria_id FOREIGN KEY (origem_conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_destino_conta_bancaria_id FOREIGN KEY (destino_conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_cheque_emitido_id FOREIGN KEY (cheque_emitido_id) REFERENCES cheque_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_saida_movimento_bancario_id FOREIGN KEY (saida_movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_entrada_movimento_bancario_id FOREIGN KEY (entrada_movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_bancaria_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE tributo
  ADD CONSTRAINT fk_tributo_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tributo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE tributo_item_nota_mercadoria
  ADD CONSTRAINT fk_tributo_item_nota_mercadoria_nota_mercadoria_item_id FOREIGN KEY (nota_mercadoria_item_id) REFERENCES nota_mercadoria_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tributo_item_nota_mercadoria_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT;
ALTER TABLE tributo_nota_credito_debito
  ADD CONSTRAINT fk_tributo_nota_credito_debito_nota_credito_debito_id FOREIGN KEY (nota_credito_debito_id) REFERENCES nota_credito_debito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tributo_nota_credito_debito_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tributo_nota_credito_debito_base_nota_servico_id FOREIGN KEY (base_nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT;
ALTER TABLE tributo_nota_servico
  ADD CONSTRAINT fk_tributo_nota_servico_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tributo_nota_servico_nota_servico_item_id FOREIGN KEY (nota_servico_item_id) REFERENCES nota_servico_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tributo_nota_servico_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tributo_nota_servico_regra_retencao_id FOREIGN KEY (regra_retencao_id) REFERENCES regra_retencao (id) ON DELETE RESTRICT;
ALTER TABLE unidade_negocio
  ADD CONSTRAINT fk_unidade_negocio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_negocio_agrupamento_unidade_negocio_id FOREIGN KEY (agrupamento_unidade_negocio_id) REFERENCES agrupamento_unidade_negocio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_negocio_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE unidade_negocio_setor
  ADD CONSTRAINT fk_unidade_negocio_setor_unidade_negocio_id FOREIGN KEY (unidade_negocio_id) REFERENCES unidade_negocio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_negocio_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE valor_cenario_fluxo_caixa
  ADD CONSTRAINT fk_valor_cenario_fluxo_caixa_cenario_fluxo_caixa_id FOREIGN KEY (cenario_fluxo_caixa_id) REFERENCES cenario_fluxo_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_cenario_fluxo_caixa_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_cenario_fluxo_caixa_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT;
ALTER TABLE valor_estatistico_orcado
  ADD CONSTRAINT fk_valor_estatistico_orcado_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_estatistico_orcado_indicador_orcamentario_id FOREIGN KEY (indicador_orcamentario_id) REFERENCES indicador_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_estatistico_orcado_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE valor_indicador_contrato
  ADD CONSTRAINT fk_valor_indicador_contrato_indicador_contrato_id FOREIGN KEY (indicador_contrato_id) REFERENCES indicador_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indicador_contrato_medicao_contrato_id FOREIGN KEY (medicao_contrato_id) REFERENCES medicao_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indicador_contrato_apurador_usuario_id FOREIGN KEY (apurador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE valor_orcado_mes
  ADD CONSTRAINT fk_valor_orcado_mes_linha_orcamento_id FOREIGN KEY (linha_orcamento_id) REFERENCES linha_orcamento (id) ON DELETE RESTRICT;
ALTER TABLE verba_orcamentaria
  ADD CONSTRAINT fk_verba_orcamentaria_superior_verba_orcamentaria_id FOREIGN KEY (superior_verba_orcamentaria_id) REFERENCES verba_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verba_orcamentaria_categoria_orcamentaria_id FOREIGN KEY (categoria_orcamentaria_id) REFERENCES categoria_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE versao_orcamento
  ADD CONSTRAINT fk_versao_orcamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_orcamento_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_orcamento_cenario_orcamento_id FOREIGN KEY (cenario_orcamento_id) REFERENCES cenario_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_orcamento_base_versao_orcamento_id FOREIGN KEY (base_versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_orcamento_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE versao_orcamento_peca
  ADD CONSTRAINT fk_versao_orcamento_peca_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_orcamento_peca_modelo_peca_orcamentaria_id FOREIGN KEY (modelo_peca_orcamentaria_id) REFERENCES modelo_peca_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE versao_regra_contabilizacao
  ADD CONSTRAINT fk_versao_regra_contabilizacao_regra_contabilizacao_id FOREIGN KEY (regra_contabilizacao_id) REFERENCES regra_contabilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_regra_contabilizacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_regra_contabilizacao_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_conta_referencial
  ADD CONSTRAINT fk_vinculo_conta_referencial_plano_contas_id FOREIGN KEY (plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_conta_referencial_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_conta_referencial_conta_referencial_id FOREIGN KEY (conta_referencial_id) REFERENCES conta_referencial (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_nota_faturamento
  ADD CONSTRAINT fk_vinculo_nota_faturamento_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_nota_faturamento_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_nota_faturamento_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
