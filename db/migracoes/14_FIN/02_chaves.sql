-- Chaves do módulo FIN, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE beneficiario_adiantamento
  ADD CONSTRAINT fk_beneficiario_adiantamento_adiantamento_id FOREIGN KEY (adiantamento_id) REFERENCES adiantamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_adiantamento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE beneficiario_dmed
  ADD CONSTRAINT fk_beneficiario_dmed_item_dmed_id FOREIGN KEY (item_dmed_id) REFERENCES item_dmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_dmed_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE beneficiario_exterior
  ADD CONSTRAINT fk_beneficiario_exterior_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_exterior_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_exterior_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_exterior_relacao_fonte_codigo_fiscal_oficial_id FOREIGN KEY (relacao_fonte_codigo_fiscal_oficial_id) REFERENCES codigo_fiscal_oficial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_benef_exterior_forma_tributacao_codigo_fiscal_oficial_id FOREIGN KEY (forma_tributacao_codigo_fiscal_oficial_id) REFERENCES codigo_fiscal_oficial (id) ON DELETE RESTRICT;
ALTER TABLE beneficiario_titulo_pagar
  ADD CONSTRAINT fk_beneficiario_titulo_pagar_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_titulo_pagar_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE bloqueio_titulo
  ADD CONSTRAINT fk_bloqueio_titulo_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_titulo_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_titulo_motivo_bloqueio_titulo_id FOREIGN KEY (motivo_bloqueio_titulo_id) REFERENCES motivo_bloqueio_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_titulo_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_titulo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE boleto
  ADD CONSTRAINT fk_boleto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_remessa_cobranca_id FOREIGN KEY (remessa_cobranca_id) REFERENCES remessa_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE boleto_parcela
  ADD CONSTRAINT fk_boleto_parcela_boleto_id FOREIGN KEY (boleto_id) REFERENCES boleto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_parcela_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_boleto_parcela_mensalidade_beneficiario_id FOREIGN KEY (mensalidade_beneficiario_id) REFERENCES mensalidade_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE bordero_pagamento
  ADD CONSTRAINT fk_bordero_pagamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bordero_pagamento_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bordero_pagamento_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bordero_pagamento_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bordero_pagamento_remessa_bancaria_id FOREIGN KEY (remessa_bancaria_id) REFERENCES remessa_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bordero_pagamento_retorno_bancario_id FOREIGN KEY (retorno_bancario_id) REFERENCES retorno_bancario (id) ON DELETE RESTRICT;
ALTER TABLE caixa
  ADD CONSTRAINT fk_caixa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_pre_datado_conta_contabil_id FOREIGN KEY (pre_datado_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_custodia_conta_contabil_id FOREIGN KEY (custodia_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caixa_devolvido_conta_contabil_id FOREIGN KEY (devolvido_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE camara_compensacao
  ADD CONSTRAINT fk_camara_compensacao_camara_pai_id FOREIGN KEY (camara_pai_id) REFERENCES camara_compensacao (id) ON DELETE RESTRICT;
ALTER TABLE carteira_cobranca
  ADD CONSTRAINT fk_carteira_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_cobranca_contrato_cobranca_bancaria_id FOREIGN KEY (contrato_cobranca_bancaria_id) REFERENCES contrato_cobranca_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_cobranca_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_cobranca_remessa_leiaute_bancario_id FOREIGN KEY (remessa_leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_cobranca_retorno_leiaute_bancario_id FOREIGN KEY (retorno_leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT;
ALTER TABLE cenario_fluxo_caixa
  ADD CONSTRAINT fk_cenario_fluxo_caixa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_fluxo_caixa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cenario_fluxo_caixa_conta
  ADD CONSTRAINT fk_cenario_fluxo_caixa_conta_cenario_fluxo_caixa_id FOREIGN KEY (cenario_fluxo_caixa_id) REFERENCES cenario_fluxo_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_fluxo_caixa_conta_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT;
ALTER TABLE centro_custo
  ADD CONSTRAINT fk_centro_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_centro_custo_centro_custo_pai_id FOREIGN KEY (centro_custo_pai_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_centro_custo_classificacao_centro_custo_id FOREIGN KEY (classificacao_centro_custo_id) REFERENCES classificacao_centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_centro_custo_criterio_tipo_dado_estatistico_id FOREIGN KEY (criterio_tipo_dado_estatistico_id) REFERENCES tipo_dado_estatistico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_centro_custo_unidade_mensuracao_custo_id FOREIGN KEY (unidade_mensuracao_custo_id) REFERENCES unidade_mensuracao_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_centro_custo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_centro_custo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_centro_custo_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE chave_pix_conta
  ADD CONSTRAINT fk_chave_pix_conta_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT;
ALTER TABLE chave_pix_credor
  ADD CONSTRAINT fk_chave_pix_credor_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT;
ALTER TABLE cheque_devolvido
  ADD CONSTRAINT fk_cheque_devolvido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_devolvido_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_devolvido_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_devolvido_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_devolvido_motivo_devolucao_cheque_id FOREIGN KEY (motivo_devolucao_cheque_id) REFERENCES motivo_devolucao_cheque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_devolvido_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT;
ALTER TABLE cheque_emitido
  ADD CONSTRAINT fk_cheque_emitido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_emitido_talao_cheque_id FOREIGN KEY (talao_cheque_id) REFERENCES talao_cheque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_emitido_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_emitido_bordero_pagamento_id FOREIGN KEY (bordero_pagamento_id) REFERENCES bordero_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_emitido_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cheque_emitido_motivo_cancelamento_cheque_id FOREIGN KEY (motivo_cancelamento_cheque_id) REFERENCES motivo_cancelamento_cheque (id) ON DELETE RESTRICT;
ALTER TABLE clausula_contrato
  ADD CONSTRAINT fk_clausula_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_clausula_contrato_modelo_texto_contrato_id FOREIGN KEY (modelo_texto_contrato_id) REFERENCES modelo_texto_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_clausula_contrato_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cliente_financeiro
  ADD CONSTRAINT fk_cliente_financeiro_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cliente_financeiro_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cliente_financeiro_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE cnae_estabelecimento
  ADD CONSTRAINT fk_cnae_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cnae_estabelecimento_atividade_economica_id FOREIGN KEY (atividade_economica_id) REFERENCES atividade_economica (id) ON DELETE RESTRICT;
ALTER TABLE cobranca_pix
  ADD CONSTRAINT fk_cobranca_pix_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobranca_pix_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobranca_pix_chave_pix_conta_id FOREIGN KEY (chave_pix_conta_id) REFERENCES chave_pix_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobranca_pix_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobranca_pix_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobranca_pix_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE codigo_fiscal_oficial
  ADD CONSTRAINT fk_codigo_fiscal_oficial_tabela_fiscal_oficial_id FOREIGN KEY (tabela_fiscal_oficial_id) REFERENCES tabela_fiscal_oficial (id) ON DELETE RESTRICT;
ALTER TABLE codigo_receita_federal
  ADD CONSTRAINT fk_codigo_receita_federal_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT;
ALTER TABLE comodato_bem
  ADD CONSTRAINT fk_comodato_bem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comodato_bem_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comodato_bem_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comodato_bem_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comodato_bem_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comodato_bem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comodato_bem_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE compensacao_adiantamento
  ADD CONSTRAINT fk_compensacao_adiantamento_adiantamento_id FOREIGN KEY (adiantamento_id) REFERENCES adiantamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compensacao_adiantamento_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compensacao_adiantamento_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compensacao_adiantamento_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE competencia_orcamento
  ADD CONSTRAINT fk_competencia_orcamento_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_orcamento_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_orcamento_responsavel_perfil_acesso_id FOREIGN KEY (responsavel_perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE composicao_linha_demonstracao
  ADD CONSTRAINT fk_composicao_linha_demonstracao_linha_modelo_demonstracao_id FOREIGN KEY (linha_modelo_demonstracao_id) REFERENCES linha_modelo_demonstracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_composicao_linha_demonstracao_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comp_linha_demonstracao_somada_linha_modelo_demonstracao_id FOREIGN KEY (somada_linha_modelo_demonstracao_id) REFERENCES linha_modelo_demonstracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_composicao_linha_demonstracao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_bancaria
  ADD CONSTRAINT fk_conciliacao_bancaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_bancaria_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_bancaria_extrato_bancario_id FOREIGN KEY (extrato_bancario_id) REFERENCES extrato_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_bancaria_confirmado_por_usuario_id FOREIGN KEY (confirmado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_bancaria_item
  ADD CONSTRAINT fk_conciliacao_bancaria_item_conciliacao_bancaria_id FOREIGN KEY (conciliacao_bancaria_id) REFERENCES conciliacao_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_bancaria_item_linha_extrato_id FOREIGN KEY (linha_extrato_id) REFERENCES linha_extrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_bancaria_item_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_bancaria_item_regra_conciliacao_bancaria_id FOREIGN KEY (regra_conciliacao_bancaria_id) REFERENCES regra_conciliacao_bancaria (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_conta_contabil
  ADD CONSTRAINT fk_conciliacao_conta_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_periodo_contabil_id FOREIGN KEY (periodo_contabil_id) REFERENCES periodo_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_ajuste_lancamento_contabil_id FOREIGN KEY (ajuste_lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_conta_contabil_item
  ADD CONSTRAINT fk_conciliacao_conta_contabil_item_conciliacao_conta_contabil_id FOREIGN KEY (conciliacao_conta_contabil_id) REFERENCES conciliacao_conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_item_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_item_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_item_adiantamento_id FOREIGN KEY (adiantamento_id) REFERENCES adiantamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_item_provisao_passivo_id FOREIGN KEY (provisao_passivo_id) REFERENCES provisao_passivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_conta_contabil_item_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_previsao_realizado
  ADD CONSTRAINT fk_conciliacao_previsao_realizado_parcela_previsao_financeira_id FOREIGN KEY (parcela_previsao_financeira_id) REFERENCES parcela_previsao_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_previsao_realizado_provisao_passivo_id FOREIGN KEY (provisao_passivo_id) REFERENCES provisao_passivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_previsao_realizado_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_previsao_realizado_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_previsao_realizado_lote_exportacao_contabil_id FOREIGN KEY (lote_exportacao_contabil_id) REFERENCES lote_exportacao_contabil (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_recebivel_cartao
  ADD CONSTRAINT fk_conciliacao_recebivel_cartao_parcela_recebivel_cartao_id FOREIGN KEY (parcela_recebivel_cartao_id) REFERENCES parcela_recebivel_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_recebivel_cartao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_recebivel_cartao_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_recebivel_cartao_conciliado_por_usuario_id FOREIGN KEY (conciliado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE condicao_pagamento_parcela
  ADD CONSTRAINT fk_condicao_pagamento_parcela_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT;
ALTER TABLE condicao_portador
  ADD CONSTRAINT fk_condicao_portador_portador_titulo_id FOREIGN KEY (portador_titulo_id) REFERENCES portador_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_condicao_portador_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_condicao_portador_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_saldo_fechamento
  ADD CONSTRAINT fk_conferencia_saldo_fechamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_saldo_fechamento_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
