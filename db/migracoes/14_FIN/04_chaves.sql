-- Chaves do módulo FIN, lote 04 (aplicadas depois de todos os tabelas.sql).
ALTER TABLE devolucao_adiantamento_paciente
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_adiantamento_paciente_id FOREIGN KEY (adiantamento_paciente_id) REFERENCES adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_movimento_caixa_id FOREIGN KEY (movimento_caixa_id) REFERENCES movimento_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_favorecido_banco_id FOREIGN KEY (favorecido_banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_adiantamento_paciente_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE devolucao_pix
  ADD CONSTRAINT fk_devolucao_pix_cobranca_pix_id FOREIGN KEY (cobranca_pix_id) REFERENCES cobranca_pix (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_pix_devolucao_adiantamento_paciente_id FOREIGN KEY (devolucao_adiantamento_paciente_id) REFERENCES devolucao_adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_pix_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE devolucao_titulo_pagar
  ADD CONSTRAINT fk_devolucao_titulo_pagar_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_titulo_pagar_devolucao_fornecedor_id FOREIGN KEY (devolucao_fornecedor_id) REFERENCES devolucao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_titulo_pagar_nota_mercadoria_id FOREIGN KEY (nota_mercadoria_id) REFERENCES nota_mercadoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_titulo_pagar_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_titulo_pagar_credito_titulo_pagar_id FOREIGN KEY (credito_titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_titulo_pagar_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_titulo_pagar_bordero_pagamento_id FOREIGN KEY (bordero_pagamento_id) REFERENCES bordero_pagamento (id) ON DELETE RESTRICT;
ALTER TABLE documento_origem_titulo
  ADD CONSTRAINT fk_documento_origem_titulo_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_entrada_servico_id FOREIGN KEY (entrada_servico_id) REFERENCES entrada_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_recibo_id FOREIGN KEY (recibo_id) REFERENCES recibo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_recibo_autonomo_id FOREIGN KEY (recibo_autonomo_id) REFERENCES recibo_autonomo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_guia_recolhimento_id FOREIGN KEY (guia_recolhimento_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_origem_titulo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE elemento_despesa
  ADD CONSTRAINT fk_elemento_despesa_superior_elemento_despesa_id FOREIGN KEY (superior_elemento_despesa_id) REFERENCES elemento_despesa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_elemento_despesa_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_elemento_despesa_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_elemento_despesa_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT;
ALTER TABLE eliminacao_consolidacao
  ADD CONSTRAINT fk_eliminacao_consolidacao_apuracao_consolidacao_id FOREIGN KEY (apuracao_consolidacao_id) REFERENCES apuracao_consolidacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_origem_estabelecimento_id FOREIGN KEY (origem_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_contraparte_estabelecimento_id FOREIGN KEY (contraparte_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_transacao_intercompanhia_id FOREIGN KEY (transacao_intercompanhia_id) REFERENCES transacao_intercompanhia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_eliminado_lancamento_contabil_id FOREIGN KEY (eliminado_lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_debito_conta_contabil_id FOREIGN KEY (debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_credito_conta_contabil_id FOREIGN KEY (credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_eliminacao_consolidacao_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE empresa_fornecedora_estabelecimento
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_adiantamento_conta_contab FOREIGN KEY (adiantamento_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_responsavel_setor_funcion FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_estabelecimento_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT;
ALTER TABLE empresa_grupo_consolidacao
  ADD CONSTRAINT fk_empresa_grupo_consolidacao_grupo_consolidacao_id FOREIGN KEY (grupo_consolidacao_id) REFERENCES grupo_consolidacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_grupo_consolidacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE encontro_contas
  ADD CONSTRAINT fk_encontro_contas_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_nota_credito_debito_id FOREIGN KEY (nota_credito_debito_id) REFERENCES nota_credito_debito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE encontro_contas_item
  ADD CONSTRAINT fk_encontro_contas_item_encontro_contas_id FOREIGN KEY (encontro_contas_id) REFERENCES encontro_contas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_item_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_item_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encontro_contas_item_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT;
ALTER TABLE enquadramento_tributario_participante
  ADD CONSTRAINT fk_enquadramento_tributario_participante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_enquadramento_tributario_participante_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_enquadramento_tributario_participante_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_enquadramento_tributario_participante_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_enquadramento_tributario_participante_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT;
ALTER TABLE entrada_servico
  ADD CONSTRAINT fk_entrada_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_prestacao_municipio_ibge_id FOREIGN KEY (prestacao_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_obra_construcao_civil_id FOREIGN KEY (obra_construcao_civil_id) REFERENCES obra_construcao_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_nota_empenho_id FOREIGN KEY (nota_empenho_id) REFERENCES nota_empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_concluido_por_usuario_id FOREIGN KEY (concluido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE entrada_servico_cambio
  ADD CONSTRAINT fk_entrada_servico_cambio_entrada_servico_id FOREIGN KEY (entrada_servico_id) REFERENCES entrada_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_cambio_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_cambio_cotacao_moeda_id FOREIGN KEY (cotacao_moeda_id) REFERENCES cotacao_moeda (id) ON DELETE RESTRICT;
ALTER TABLE entrada_servico_item
  ADD CONSTRAINT fk_entrada_servico_item_entrada_servico_id FOREIGN KEY (entrada_servico_id) REFERENCES entrada_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_item_pedido_compra_item_id FOREIGN KEY (pedido_compra_item_id) REFERENCES pedido_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_item_elemento_despesa_id FOREIGN KEY (elemento_despesa_id) REFERENCES elemento_despesa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrada_servico_item_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_conta_contabil
  ADD CONSTRAINT fk_equivalencia_conta_contabil_origem_conta_contabil_id FOREIGN KEY (origem_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_conta_contabil_destino_conta_contabil_id FOREIGN KEY (destino_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_conta_contabil_origem_plano_contas_id FOREIGN KEY (origem_plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_conta_contabil_destino_plano_contas_id FOREIGN KEY (destino_plano_contas_id) REFERENCES plano_contas (id) ON DELETE RESTRICT;
ALTER TABLE escrituracao_entrada
  ADD CONSTRAINT fk_escrituracao_entrada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_entrada_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_entrada_entrada_servico_id FOREIGN KEY (entrada_servico_id) REFERENCES entrada_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_entrada_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_entrada_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_entrada_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_entrada_arquivo_efd_fiscal_id FOREIGN KEY (arquivo_efd_fiscal_id) REFERENCES arquivo_efd_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_entrada_arquivo_efd_contribuicoes_id FOREIGN KEY (arquivo_efd_contribuicoes_id) REFERENCES arquivo_efd_contribuicoes (id) ON DELETE RESTRICT;
ALTER TABLE escrituracao_item_entrada
  ADD CONSTRAINT fk_escrituracao_item_entrada_escrituracao_entrada_id FOREIGN KEY (escrituracao_entrada_id) REFERENCES escrituracao_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_item_entrada_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_item_entrada_entrada_servico_item_id FOREIGN KEY (entrada_servico_item_id) REFERENCES entrada_servico_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_item_entrada_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_item_entrada_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_item_entrada_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escrituracao_item_entrada_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE estatistica_centro_mes
  ADD CONSTRAINT fk_estatistica_centro_mes_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estatistica_centro_mes_tipo_dado_estatistico_id FOREIGN KEY (tipo_dado_estatistico_id) REFERENCES tipo_dado_estatistico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estatistica_centro_mes_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estatistica_centro_mes_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estatistica_centro_mes_apuracao_custo_id FOREIGN KEY (apuracao_custo_id) REFERENCES apuracao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estatistica_centro_mes_regra_importacao_custo_id FOREIGN KEY (regra_importacao_custo_id) REFERENCES regra_importacao_custo (id) ON DELETE RESTRICT;
ALTER TABLE etapa_fluxo_aprovacao
  ADD CONSTRAINT fk_etapa_fluxo_aprovacao_fluxo_aprovacao_id FOREIGN KEY (fluxo_aprovacao_id) REFERENCES fluxo_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etapa_fluxo_aprovacao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE etapa_projeto
  ADD CONSTRAINT fk_etapa_projeto_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etapa_projeto_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE evento_contabil
  ADD CONSTRAINT fk_evento_contabil_superior_evento_contabil_id FOREIGN KEY (superior_evento_contabil_id) REFERENCES evento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE evento_contrato
  ADD CONSTRAINT fk_evento_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_contrato_tipo_evento_contrato_id FOREIGN KEY (tipo_evento_contrato_id) REFERENCES tipo_evento_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_contrato_gatilho_evento_contrato_id FOREIGN KEY (gatilho_evento_contrato_id) REFERENCES evento_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_contrato_destino_situacao_contrato_id FOREIGN KEY (destino_situacao_contrato_id) REFERENCES situacao_contrato (id) ON DELETE RESTRICT;
ALTER TABLE evento_nota_mercadoria
  ADD CONSTRAINT fk_evento_nota_mercadoria_nota_mercadoria_id FOREIGN KEY (nota_mercadoria_id) REFERENCES nota_mercadoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_nota_mercadoria_motivo_cancelamento_documento_fiscal_i FOREIGN KEY (motivo_cancelamento_documento_fiscal_id) REFERENCES motivo_cancelamento_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_nota_mercadoria_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_nota_mercadoria_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE evento_nota_servico
  ADD CONSTRAINT fk_evento_nota_servico_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_nota_servico_substituta_nota_servico_id FOREIGN KEY (substituta_nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_nota_servico_motivo_cancelamento_documento_fiscal_id FOREIGN KEY (motivo_cancelamento_documento_fiscal_id) REFERENCES motivo_cancelamento_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_nota_servico_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_nota_servico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE evento_reinf
  ADD CONSTRAINT fk_evento_reinf_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_lote_reinf_id FOREIGN KEY (lote_reinf_id) REFERENCES lote_reinf (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_retificado_evento_reinf_id FOREIGN KEY (retificado_evento_reinf_id) REFERENCES evento_reinf (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_envio_arquivo_id FOREIGN KEY (envio_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE evento_reinf_item
  ADD CONSTRAINT fk_evento_reinf_item_evento_reinf_id FOREIGN KEY (evento_reinf_id) REFERENCES evento_reinf (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_entrada_servico_id FOREIGN KEY (entrada_servico_id) REFERENCES entrada_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_obra_construcao_civil_id FOREIGN KEY (obra_construcao_civil_id) REFERENCES obra_construcao_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_reinf_item_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT;
ALTER TABLE excecao_consumo_custo
  ADD CONSTRAINT fk_excecao_consumo_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_consumo_custo_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_consumo_custo_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_consumo_custo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_consumo_custo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_consumo_custo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE excecao_orcamentaria
  ADD CONSTRAINT fk_excecao_orcamentaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_orcamentaria_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_orcamentaria_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_orcamentaria_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_orcamentaria_reserva_orcamentaria_id FOREIGN KEY (reserva_orcamentaria_id) REFERENCES reserva_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_orcamentaria_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_orcamentaria_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_orcamentaria_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE exportacao_custo
  ADD CONSTRAINT fk_exportacao_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_custo_grupo_exportacao_custo_id FOREIGN KEY (grupo_exportacao_custo_id) REFERENCES grupo_exportacao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_custo_apuracao_custo_id FOREIGN KEY (apuracao_custo_id) REFERENCES apuracao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_custo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE extrato_bancario
  ADD CONSTRAINT fk_extrato_bancario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_extrato_bancario_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_extrato_bancario_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_extrato_bancario_importado_por_usuario_id FOREIGN KEY (importado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE faixa_sla_contrato
  ADD CONSTRAINT fk_faixa_sla_contrato_sla_contrato_id FOREIGN KEY (sla_contrato_id) REFERENCES sla_contrato (id) ON DELETE RESTRICT;
ALTER TABLE fato_contabil
  ADD CONSTRAINT fk_fato_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fato_contabil_evento_contabil_id FOREIGN KEY (evento_contabil_id) REFERENCES evento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fato_contabil_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fato_contabil_estornado_fato_contabil_id FOREIGN KEY (estornado_fato_contabil_id) REFERENCES fato_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fato_contabil_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE ficha_custo_padrao
  ADD CONSTRAINT fk_ficha_custo_padrao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE ficha_custo_padrao_item
  ADD CONSTRAINT fk_ficha_custo_padrao_item_ficha_custo_padrao_id FOREIGN KEY (ficha_custo_padrao_id) REFERENCES ficha_custo_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_referencia_setor_funcional_id FOREIGN KEY (referencia_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_custo_padrao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE finalidade_transferencia
  ADD CONSTRAINT fk_finalidade_transferencia_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE fluxo_aprovacao
  ADD CONSTRAINT fk_fluxo_aprovacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_aprovacao_tipo_documento_aprovacao_id FOREIGN KEY (tipo_documento_aprovacao_id) REFERENCES tipo_documento_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_aprovacao_alcada_aprovacao_id FOREIGN KEY (alcada_aprovacao_id) REFERENCES alcada_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_aprovacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE forma_pagamento_banco
  ADD CONSTRAINT fk_forma_pagamento_banco_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE forma_pagamento_credor
  ADD CONSTRAINT fk_forma_pagamento_credor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_forma_pagamento_credor_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_forma_pagamento_credor_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_forma_pagamento_credor_chave_pix_credor_id FOREIGN KEY (chave_pix_credor_id) REFERENCES chave_pix_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_forma_pagamento_credor_forma_pagamento_banco_id FOREIGN KEY (forma_pagamento_banco_id) REFERENCES forma_pagamento_banco (id) ON DELETE RESTRICT;
ALTER TABLE forma_recebimento
  ADD CONSTRAINT fk_forma_recebimento_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_forma_recebimento_origem_recebimento_id FOREIGN KEY (origem_recebimento_id) REFERENCES origem_recebimento (id) ON DELETE RESTRICT;
ALTER TABLE formula_orcamentaria
  ADD CONSTRAINT fk_formula_orcamentaria_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_orcamentaria_homologada_por_usuario_id FOREIGN KEY (homologada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_orcamentaria_copia_formula_orcamentaria_id FOREIGN KEY (copia_formula_orcamentaria_id) REFERENCES formula_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE formula_orcamentaria_parametro
  ADD CONSTRAINT fk_formula_orcamentaria_parametro_formula_orcamentaria_id FOREIGN KEY (formula_orcamentaria_id) REFERENCES formula_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_orcamentaria_parametro_copia_formula_orcamentaria_par FOREIGN KEY (copia_formula_orcamentaria_parametro_id) REFERENCES formula_orcamentaria_parametro (id) ON DELETE RESTRICT;
ALTER TABLE funcao_orcamentaria
  ADD CONSTRAINT fk_funcao_orcamentaria_superior_funcao_orcamentaria_id FOREIGN KEY (superior_funcao_orcamentaria_id) REFERENCES funcao_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE garantia_contrato
  ADD CONSTRAINT fk_garantia_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_garantia_contrato_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
