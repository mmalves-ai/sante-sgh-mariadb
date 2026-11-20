-- Chaves do módulo FIN, lote 05 (aplicadas depois de todos os tabelas.sql)
-- Nomes de FK acima de 64 caracteres foram abreviados (fk_<tabela>_<papel>_id).
ALTER TABLE gestor_contrato
  ADD CONSTRAINT fk_gestor_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestor_contrato_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gestor_contrato_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE grupo_bem
  ADD CONSTRAINT fk_grupo_bem_pai_grupo_bem_id FOREIGN KEY (pai_grupo_bem_id) REFERENCES grupo_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_bem_conta_contabil_id FOREIGN KEY (bem_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_depreciacao_acumulada_conta_contabil_id FOREIGN KEY (depreciacao_acumulada_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_despesa_depreciacao_conta_contabil_id FOREIGN KEY (despesa_depreciacao_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_despesa_nao_operacional_conta_contabil_id FOREIGN KEY (despesa_nao_operacional_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_imobilizado_andamento_conta_contabil_id FOREIGN KEY (imobilizado_andamento_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_reavaliacao_conta_contabil_id FOREIGN KEY (reavaliacao_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_depreciacao_reavaliacao_conta_contabil_id FOREIGN KEY (depreciacao_reavaliacao_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_ganho_alienacao_conta_contabil_id FOREIGN KEY (ganho_alienacao_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_perda_alienacao_conta_contabil_id FOREIGN KEY (perda_alienacao_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_amortizacao_conta_contabil_id FOREIGN KEY (amortizacao_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_bem_reducao_recuperavel_conta_contabil_id FOREIGN KEY (reducao_recuperavel_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE grupo_consolidacao
  ADD CONSTRAINT fk_grupo_consolidacao_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_consolidacao_plano_contas_id FOREIGN KEY (plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT;
ALTER TABLE grupo_lancamento_financeiro
  ADD CONSTRAINT fk_grupo_lancamento_financeiro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_lancamento_financeiro_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_lancamento_financeiro_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_lancamento_financeiro_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_lancamento_financeiro_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_lancamento_financeiro_estorno_usuario_id FOREIGN KEY (estorno_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE grupo_natureza_financeira
  ADD CONSTRAINT fk_grupo_natureza_financeira_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_natureza_financeira_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE guia_recolhimento
  ADD CONSTRAINT fk_guia_recolhimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_recolhimento_codigo_receita_federal_id FOREIGN KEY (codigo_receita_federal_id) REFERENCES codigo_receita_federal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_recolhimento_orgao_arrecadador_id FOREIGN KEY (orgao_arrecadador_id) REFERENCES orgao_arrecadador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_recolhimento_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_recolhimento_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_recolhimento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_recolhimento_retificada_guia_recolhimento_id FOREIGN KEY (retificada_guia_recolhimento_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT;
ALTER TABLE imobilizado_andamento
  ADD CONSTRAINT fk_imobilizado_andamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_imobilizado_andamento_grupo_bem_id FOREIGN KEY (grupo_bem_id) REFERENCES grupo_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_imobilizado_andamento_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_imobilizado_andamento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_imobilizado_andamento_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_imobilizado_andamento_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT;
ALTER TABLE indicador_contrato
  ADD CONSTRAINT fk_indicador_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE indicador_orcamentario
  ADD CONSTRAINT fk_indicador_orcamentario_grupo_indicador_orcamentario_id FOREIGN KEY (grupo_indicador_orcamentario_id) REFERENCES grupo_indicador_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_orcamentario_tipo_dado_estatistico_id FOREIGN KEY (tipo_dado_estatistico_id) REFERENCES tipo_dado_estatistico (id) ON DELETE RESTRICT;
ALTER TABLE indice_reajuste_valor
  ADD CONSTRAINT fk_indice_reajuste_valor_indice_reajuste_id FOREIGN KEY (indice_reajuste_id) REFERENCES indice_reajuste (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indice_reajuste_valor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE informacao_economica_ecf
  ADD CONSTRAINT fk_informacao_economica_ecf_periodo_escrituracao_id FOREIGN KEY (periodo_escrituracao_id) REFERENCES periodo_escrituracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_informacao_economica_ecf_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_informacao_economica_ecf_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE instrucao_cobranca
  ADD CONSTRAINT fk_instrucao_cobranca_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE inutilizacao_numeracao_fiscal
  ADD CONSTRAINT fk_inutilizacao_numeracao_fiscal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inutilizacao_numeracao_fiscal_serie_documento_fiscal_id FOREIGN KEY (serie_documento_fiscal_id) REFERENCES serie_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inutilizacao_numeracao_fiscal_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inutilizacao_numeracao_fiscal_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inventario_bem
  ADD CONSTRAINT fk_inventario_bem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_cancelamento_usuario_id FOREIGN KEY (cancelamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inventario_bem_item
  ADD CONSTRAINT fk_inventario_bem_item_inventario_bem_id FOREIGN KEY (inventario_bem_id) REFERENCES inventario_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_item_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_item_encontrado_local_fisico_id FOREIGN KEY (encontrado_local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_item_encontrado_setor_funcional_id FOREIGN KEY (encontrado_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_bem_item_leitor_usuario_id FOREIGN KEY (leitor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE investimento_orcado
  ADD CONSTRAINT fk_investimento_orcado_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investimento_orcado_grupo_bem_id FOREIGN KEY (grupo_bem_id) REFERENCES grupo_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investimento_orcado_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investimento_orcado_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT;
ALTER TABLE item_apontamento_producao
  ADD CONSTRAINT fk_item_apontamento_producao_apontamento_producao_contrato_id FOREIGN KEY (apontamento_producao_contrato_id) REFERENCES apontamento_producao_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_apontamento_producao_contrato_fornecedor_item_id FOREIGN KEY (contrato_fornecedor_item_id) REFERENCES contrato_fornecedor_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_apontamento_producao_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_apontamento_producao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_apontamento_producao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_apontamento_producao_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT;
ALTER TABLE item_bordero
  ADD CONSTRAINT fk_item_bordero_bordero_pagamento_id FOREIGN KEY (bordero_pagamento_id) REFERENCES bordero_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_bordero_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_bordero_forma_pagamento_banco_id FOREIGN KEY (forma_pagamento_banco_id) REFERENCES forma_pagamento_banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_bordero_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_bordero_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_bordero_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT;
ALTER TABLE item_dmed
  ADD CONSTRAINT fk_item_dmed_declaracao_dmed_id FOREIGN KEY (declaracao_dmed_id) REFERENCES declaracao_dmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_dmed_titular_pessoa_fisica_id FOREIGN KEY (titular_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_dmed_beneficiario_pessoa_fisica_id FOREIGN KEY (beneficiario_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT;
ALTER TABLE item_lote_exportacao
  ADD CONSTRAINT fk_item_lote_exportacao_lote_exportacao_contabil_id FOREIGN KEY (lote_exportacao_contabil_id) REFERENCES lote_exportacao_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lote_exportacao_debito_conta_contabil_id FOREIGN KEY (debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lote_exportacao_credito_conta_contabil_id FOREIGN KEY (credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lote_exportacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lote_exportacao_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lote_exportacao_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE justificativa_variacao_orcamento
  ADD CONSTRAINT fk_justificativa_variacao_orcamento_linha_orcamento_id FOREIGN KEY (linha_orcamento_id) REFERENCES linha_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_variacao_orcamento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_contabil
  ADD CONSTRAINT fk_lancamento_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_lote_contabil_id FOREIGN KEY (lote_contabil_id) REFERENCES lote_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_periodo_contabil_id FOREIGN KEY (periodo_contabil_id) REFERENCES periodo_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_fato_contabil_id FOREIGN KEY (fato_contabil_id) REFERENCES fato_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_contabil_estornado_lancamento_contabil_id FOREIGN KEY (estornado_lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_peca_orcamentaria
  ADD CONSTRAINT fk_lancamento_peca_orcamentaria_linha_id FOREIGN KEY (modelo_peca_orcamentaria_linha_id) REFERENCES modelo_peca_orcamentaria_linha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_peca_orcamentaria_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_peca_orcamentaria_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_peca_orcamentaria_preenchido_usuario_id FOREIGN KEY (preenchido_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE leiaute_bancario
  ADD CONSTRAINT fk_leiaute_bancario_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE leitura_fato_contabil
  ADD CONSTRAINT fk_leitura_fato_contabil_fato_contabil_id FOREIGN KEY (fato_contabil_id) REFERENCES fato_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_fato_contabil_regra_contabilizacao_id FOREIGN KEY (regra_contabilizacao_id) REFERENCES regra_contabilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_fato_contabil_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE linha_extrato
  ADD CONSTRAINT fk_linha_extrato_extrato_bancario_id FOREIGN KEY (extrato_bancario_id) REFERENCES extrato_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_extrato_tipo_lancamento_bancario_id FOREIGN KEY (tipo_lancamento_bancario_id) REFERENCES tipo_lancamento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_extrato_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_extrato_conciliacao_usuario_id FOREIGN KEY (conciliacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE linha_modelo_demonstracao
  ADD CONSTRAINT fk_linha_modelo_demonstracao_modelo_demonstracao_id FOREIGN KEY (modelo_demonstracao_id) REFERENCES modelo_demonstracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_modelo_demonstracao_pai_linha_modelo_demonstracao_id FOREIGN KEY (pai_linha_modelo_demonstracao_id) REFERENCES linha_modelo_demonstracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_modelo_demonstracao_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE linha_orcamento
  ADD CONSTRAINT fk_linha_orcamento_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_grupo_natureza_financeira_id FOREIGN KEY (grupo_natureza_financeira_id) REFERENCES grupo_natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_subgrupo_natureza_financeira_id FOREIGN KEY (subgrupo_natureza_financeira_id) REFERENCES subgrupo_natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_tipo_conta_orcamentaria_id FOREIGN KEY (tipo_conta_orcamentaria_id) REFERENCES tipo_conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_linha_orcamento_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE liquidacao_empenho
  ADD CONSTRAINT fk_liquidacao_empenho_nota_empenho_id FOREIGN KEY (nota_empenho_id) REFERENCES nota_empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liquidacao_empenho_nota_empenho_item_id FOREIGN KEY (nota_empenho_item_id) REFERENCES nota_empenho_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liquidacao_empenho_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liquidacao_empenho_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liquidacao_empenho_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_contabil
  ADD CONSTRAINT fk_lote_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_contabil_periodo_contabil_id FOREIGN KEY (periodo_contabil_id) REFERENCES periodo_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_contabil_liberacao_usuario_id FOREIGN KEY (liberacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_contabil_pai_lote_contabil_id FOREIGN KEY (pai_lote_contabil_id) REFERENCES lote_contabil (id) ON DELETE RESTRICT;
ALTER TABLE lote_exportacao_contabil
  ADD CONSTRAINT fk_lote_exportacao_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_exportacao_contabil_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_exportacao_contabil_conferencia_usuario_id FOREIGN KEY (conferencia_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_nota_servico
  ADD CONSTRAINT fk_lote_nota_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_nota_servico_serie_documento_fiscal_id FOREIGN KEY (serie_documento_fiscal_id) REFERENCES serie_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_nota_servico_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_nota_servico_envio_arquivo_id FOREIGN KEY (envio_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_nota_servico_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE lote_reinf
  ADD CONSTRAINT fk_lote_reinf_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reinf_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reinf_envio_arquivo_id FOREIGN KEY (envio_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reinf_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE medicao_contrato
  ADD CONSTRAINT fk_medicao_contrato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicao_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicao_contrato_apontamento_producao_contrato_id FOREIGN KEY (apontamento_producao_contrato_id) REFERENCES apontamento_producao_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicao_contrato_parcela_contrato_fornecedor_id FOREIGN KEY (parcela_contrato_fornecedor_id) REFERENCES parcela_contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicao_contrato_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicao_contrato_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicao_contrato_aceite_usuario_id FOREIGN KEY (aceite_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medicao_contrato_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE meio_recebimento_particular
  ADD CONSTRAINT fk_meio_recebimento_particular_recebimento_particular_id FOREIGN KEY (recebimento_particular_id) REFERENCES recebimento_particular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meio_recebimento_particular_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meio_recebimento_particular_administradora_cartao_id FOREIGN KEY (administradora_cartao_id) REFERENCES administradora_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meio_recebimento_particular_transacao_cartao_id FOREIGN KEY (transacao_cartao_id) REFERENCES transacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meio_recebimento_particular_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meio_recebimento_particular_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_boleto
  ADD CONSTRAINT fk_mensagem_boleto_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_boleto_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT;
ALTER TABLE modelo_demonstracao
  ADD CONSTRAINT fk_modelo_demonstracao_plano_contas_id FOREIGN KEY (plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_demonstracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE modelo_peca_orcamentaria
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_pai_modelo_peca_orcamentaria_id FOREIGN KEY (pai_modelo_peca_orcamentaria_id) REFERENCES modelo_peca_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_peca_orcamentaria_linha
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_modelo_peca_orcamentaria_id FOREIGN KEY (modelo_peca_orcamentaria_id) REFERENCES modelo_peca_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_pai_id FOREIGN KEY (pai_modelo_peca_orcamentaria_linha_id) REFERENCES modelo_peca_orcamentaria_linha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_linha_relacionada_id FOREIGN KEY (relacionada_modelo_peca_orcamentaria_linha_id) REFERENCES modelo_peca_orcamentaria_linha (id) ON DELETE RESTRICT;
ALTER TABLE modelo_peca_orcamentaria_setor
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_setor_linha_id FOREIGN KEY (modelo_peca_orcamentaria_linha_id) REFERENCES modelo_peca_orcamentaria_linha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_setor_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_peca_orcamentaria_setor_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
