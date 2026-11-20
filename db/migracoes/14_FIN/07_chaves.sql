-- 14_FIN, lote 07: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE pagamento_pix
  ADD CONSTRAINT fk_pagamento_pix_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pagamento_pix_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pagamento_pix_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pagamento_pix_chave_pix_credor_id FOREIGN KEY (chave_pix_credor_id) REFERENCES chave_pix_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pagamento_pix_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pagamento_pix_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pagamento_pix_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE parcela_adiantamento
  ADD CONSTRAINT fk_parcela_adiantamento_adiantamento_id FOREIGN KEY (adiantamento_id) REFERENCES adiantamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_adiantamento_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_adiantamento_compensacao_adiantamento_id FOREIGN KEY (compensacao_adiantamento_id) REFERENCES compensacao_adiantamento (id) ON DELETE RESTRICT;
ALTER TABLE parcela_apuracao_custo
  ADD CONSTRAINT fk_parcela_apuracao_custo_apuracao_custo_id FOREIGN KEY (apuracao_custo_id) REFERENCES apuracao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_apuracao_custo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_apuracao_custo_origem_centro_custo_id FOREIGN KEY (origem_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_apuracao_custo_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_apuracao_custo_tipo_custo_id FOREIGN KEY (tipo_custo_id) REFERENCES tipo_custo (id) ON DELETE RESTRICT;
ALTER TABLE parcela_contrato_fornecedor
  ADD CONSTRAINT fk_parcela_contrato_fornecedor_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_contrato_fornecedor_contrato_fornecedor_item_id FOREIGN KEY (contrato_fornecedor_item_id) REFERENCES contrato_fornecedor_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_contrato_fornecedor_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE parcela_pagar
  ADD CONSTRAINT fk_parcela_pagar_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_pagar_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_pagar_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT;
ALTER TABLE parcela_previsao_financeira
  ADD CONSTRAINT fk_parcela_previsao_financeira_previsao_financeira_id FOREIGN KEY (previsao_financeira_id) REFERENCES previsao_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_previsao_financeira_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_previsao_financeira_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT;
ALTER TABLE parcela_receber
  ADD CONSTRAINT fk_parcela_receber_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_receber_portador_titulo_id FOREIGN KEY (portador_titulo_id) REFERENCES portador_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_receber_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_receber_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT;
ALTER TABLE parcela_recebivel_cartao
  ADD CONSTRAINT fk_parcela_recebivel_cartao_transacao_cartao_id FOREIGN KEY (transacao_cartao_id) REFERENCES transacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_recebivel_cartao_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_recebivel_cartao_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_recebivel_cartao_conciliacao_recebivel_cartao_id FOREIGN KEY (conciliacao_recebivel_cartao_id) REFERENCES conciliacao_recebivel_cartao (id) ON DELETE RESTRICT;
ALTER TABLE parte_contrato
  ADD CONSTRAINT fk_parte_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parte_contrato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parte_contrato_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parte_contrato_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parte_contrato_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parte_contrato_unidade_negocio_id FOREIGN KEY (unidade_negocio_id) REFERENCES unidade_negocio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parte_contrato_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE partida_contabil
  ADD CONSTRAINT fk_partida_contabil_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partida_contabil_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partida_contabil_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partida_contabil_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partida_contabil_unidade_negocio_id FOREIGN KEY (unidade_negocio_id) REFERENCES unidade_negocio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partida_contabil_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partida_contabil_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_partida_contabil_conciliacao_conta_contabil_id FOREIGN KEY (conciliacao_conta_contabil_id) REFERENCES conciliacao_conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE periodo_contabil
  ADD CONSTRAINT fk_periodo_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_contabil_plano_contas_id FOREIGN KEY (plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_contabil_encerrante_usuario_id FOREIGN KEY (encerrante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_contabil_reabertura_usuario_id FOREIGN KEY (reabertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE periodo_escrituracao
  ADD CONSTRAINT fk_periodo_escrituracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE periodo_financeiro
  ADD CONSTRAINT fk_periodo_financeiro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_financeiro_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_financeiro_reabertura_usuario_id FOREIGN KEY (reabertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_financeiro_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE permissao_adiantamento_usuario
  ADD CONSTRAINT fk_permissao_adiantamento_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_adiantamento_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_adiantamento_usuario_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE permissao_conta_bancaria
  ADD CONSTRAINT fk_permissao_conta_bancaria_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_conta_bancaria_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_conta_bancaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE permissao_tipo_lancamento
  ADD CONSTRAINT fk_permissao_tipo_lancamento_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_tipo_lancamento_tipo_credor_id FOREIGN KEY (tipo_credor_id) REFERENCES tipo_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_tipo_lancamento_tipo_lancamento_bancario_id FOREIGN KEY (tipo_lancamento_bancario_id) REFERENCES tipo_lancamento_bancario (id) ON DELETE RESTRICT;
ALTER TABLE plano_contas
  ADD CONSTRAINT fk_plano_contas_grupo_consolidacao_id FOREIGN KEY (grupo_consolidacao_id) REFERENCES grupo_consolidacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_contas_plano_anterior_id FOREIGN KEY (plano_anterior_id) REFERENCES plano_contas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_contas_plano_referencial_id FOREIGN KEY (plano_referencial_id) REFERENCES plano_referencial (id) ON DELETE RESTRICT;
ALTER TABLE plano_orcamentario
  ADD CONSTRAINT fk_plano_orcamentario_tipo_plano_orcamentario_id FOREIGN KEY (tipo_plano_orcamentario_id) REFERENCES tipo_plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_orcamentario_plano_contas_id FOREIGN KEY (plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT;
ALTER TABLE plano_orcamentario_estabelecimento
  ADD CONSTRAINT fk_plano_orcamentario_estabelecimento_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_orcamentario_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE plaqueta_bem
  ADD CONSTRAINT fk_plaqueta_bem_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plaqueta_bem_substituta_plaqueta_bem_id FOREIGN KEY (substituta_plaqueta_bem_id) REFERENCES plaqueta_bem (id) ON DELETE RESTRICT;
ALTER TABLE portador_titulo
  ADD CONSTRAINT fk_portador_titulo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portador_titulo_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portador_titulo_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portador_titulo_administradora_cartao_id FOREIGN KEY (administradora_cartao_id) REFERENCES administradora_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portador_titulo_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE premissa_orcamento
  ADD CONSTRAINT fk_premissa_orcamento_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_premissa_orcamento_indice_reajuste_id FOREIGN KEY (indice_reajuste_id) REFERENCES indice_reajuste (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_premissa_orcamento_copiada_premissa_orcamento_id FOREIGN KEY (copiada_premissa_orcamento_id) REFERENCES premissa_orcamento (id) ON DELETE RESTRICT;
ALTER TABLE premissa_recebimento_fonte_pagadora
  ADD CONSTRAINT fk_premissa_recebimento_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_premissa_recebimento_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE prestacao_contas_adiantamento
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_adiantamento_id FOREIGN KEY (adiantamento_id) REFERENCES adiantamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE prestacao_contas_adiantamento_item
  ADD CONSTRAINT fk_prestacao_contas_adiant_item_prestacao_contas_adiantamento_id FOREIGN KEY (prestacao_contas_adiantamento_id) REFERENCES prestacao_contas_adiantamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiant_item_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_item_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_item_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestacao_contas_adiantamento_item_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE previsao_financeira
  ADD CONSTRAINT fk_previsao_financeira_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_financeira_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_financeira_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_financeira_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_financeira_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_financeira_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_financeira_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT;
ALTER TABLE processo_tributario
  ADD CONSTRAINT fk_processo_tributario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_tributario_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE programa_trabalho
  ADD CONSTRAINT fk_programa_trabalho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_trabalho_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_trabalho_funcao_orcamentaria_id FOREIGN KEY (funcao_orcamentaria_id) REFERENCES funcao_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_trabalho_subfuncao_funcao_orcamentaria_id FOREIGN KEY (subfuncao_funcao_orcamentaria_id) REFERENCES funcao_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE programa_trabalho_acao
  ADD CONSTRAINT fk_programa_trabalho_acao_programa_trabalho_id FOREIGN KEY (programa_trabalho_id) REFERENCES programa_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_trabalho_acao_acao_pai_id FOREIGN KEY (acao_pai_id) REFERENCES programa_trabalho_acao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_trabalho_acao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE projeto
  ADD CONSTRAINT fk_projeto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE projeto_centro_custo
  ADD CONSTRAINT fk_projeto_centro_custo_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_centro_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_centro_custo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE projeto_produto
  ADD CONSTRAINT fk_projeto_produto_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_projeto_produto_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE prorrogacao_parcela
  ADD CONSTRAINT fk_prorrogacao_parcela_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prorrogacao_parcela_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prorrogacao_parcela_motivo_prorrogacao_id FOREIGN KEY (motivo_prorrogacao_id) REFERENCES motivo_prorrogacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prorrogacao_parcela_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE provisao_passivo
  ADD CONSTRAINT fk_provisao_passivo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_passivo_reversao_lancamento_contabil_id FOREIGN KEY (reversao_lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE rateio_contrato
  ADD CONSTRAINT fk_rateio_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_contrato_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_contrato_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_contrato_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_contrato_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT;
ALTER TABLE rateio_depreciacao
  ADD CONSTRAINT fk_rateio_depreciacao_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_depreciacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_depreciacao_cota_depreciacao_id FOREIGN KEY (cota_depreciacao_id) REFERENCES cota_depreciacao (id) ON DELETE RESTRICT;
ALTER TABLE rateio_lancamento
  ADD CONSTRAINT fk_rateio_lancamento_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_movimento_caixa_id FOREIGN KEY (movimento_caixa_id) REFERENCES movimento_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_lancamento_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE rateio_orcamento_setor
  ADD CONSTRAINT fk_rateio_orcamento_setor_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_orcamento_setor_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_orcamento_setor_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_orcamento_setor_origem_centro_custo_id FOREIGN KEY (origem_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_orcamento_setor_destino_centro_custo_id FOREIGN KEY (destino_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_orcamento_setor_criterio_rateio_id FOREIGN KEY (criterio_rateio_id) REFERENCES criterio_rateio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rateio_orcamento_setor_copiada_rateio_orcamento_setor_id FOREIGN KEY (copiada_rateio_orcamento_setor_id) REFERENCES rateio_orcamento_setor (id) ON DELETE RESTRICT;
ALTER TABLE reajuste_contrato
  ADD CONSTRAINT fk_reajuste_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_indice_reajuste_id FOREIGN KEY (indice_reajuste_id) REFERENCES indice_reajuste (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_aditivo_contrato_id FOREIGN KEY (aditivo_contrato_id) REFERENCES aditivo_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE realizado_orcamento
  ADD CONSTRAINT fk_realizado_orcamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE realizado_orcamento_origem
  ADD CONSTRAINT fk_realizado_orcamento_origem_realizado_orcamento_id FOREIGN KEY (realizado_orcamento_id) REFERENCES realizado_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_tipo_origem_realizado_id FOREIGN KEY (tipo_origem_realizado_id) REFERENCES tipo_origem_realizado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_nota_mercadoria_id FOREIGN KEY (nota_mercadoria_id) REFERENCES nota_mercadoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_realizado_orcamento_origem_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
