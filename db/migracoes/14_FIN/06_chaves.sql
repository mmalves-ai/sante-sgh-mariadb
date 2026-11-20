-- 14_FIN, lote 06: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE modelo_recibo
  ADD CONSTRAINT fk_modelo_recibo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_recibo_sequencia_negocio_id FOREIGN KEY (sequencia_negocio_id) REFERENCES sequencia_negocio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_recibo_logotipo_arquivo_id FOREIGN KEY (logotipo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE modelo_texto_contrato
  ADD CONSTRAINT fk_modelo_texto_contrato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE motivo_baixa_bem
  ADD CONSTRAINT fk_motivo_baixa_bem_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE motivo_situacao_contrato
  ADD CONSTRAINT fk_motivo_situacao_contrato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motivo_situacao_contrato_evento_contrato_id FOREIGN KEY (evento_contrato_id) REFERENCES evento_contrato (id) ON DELETE RESTRICT;
ALTER TABLE movimento_bancario
  ADD CONSTRAINT fk_movimento_bancario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_tipo_lancamento_bancario_id FOREIGN KEY (tipo_lancamento_bancario_id) REFERENCES tipo_lancamento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_contrapartida_conta_bancaria_id FOREIGN KEY (contrapartida_conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_transferencia_bancaria_id FOREIGN KEY (transferencia_bancaria_id) REFERENCES transferencia_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_cheque_emitido_id FOREIGN KEY (cheque_emitido_id) REFERENCES cheque_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_cheque_devolvido_id FOREIGN KEY (cheque_devolvido_id) REFERENCES cheque_devolvido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_aplicacao_financeira_id FOREIGN KEY (aplicacao_financeira_id) REFERENCES aplicacao_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_conciliacao_bancaria_id FOREIGN KEY (conciliacao_bancaria_id) REFERENCES conciliacao_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bancario_estornado_movimento_bancario_id FOREIGN KEY (estornado_movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT;
ALTER TABLE movimento_bem
  ADD CONSTRAINT fk_movimento_bem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_origem_setor_funcional_id FOREIGN KEY (origem_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_origem_centro_custo_id FOREIGN KEY (origem_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_destino_centro_custo_id FOREIGN KEY (destino_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_motivo_baixa_bem_id FOREIGN KEY (motivo_baixa_bem_id) REFERENCES motivo_baixa_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bem_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE movimento_caixa
  ADD CONSTRAINT fk_movimento_caixa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_tipo_movimento_caixa_id FOREIGN KEY (tipo_movimento_caixa_id) REFERENCES tipo_movimento_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_baixa_titulo_id FOREIGN KEY (baixa_titulo_id) REFERENCES baixa_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_adiantamento_paciente_id FOREIGN KEY (adiantamento_paciente_id) REFERENCES adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_transferencia_movimento_caixa_id FOREIGN KEY (transferencia_movimento_caixa_id) REFERENCES movimento_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_estornado_movimento_caixa_id FOREIGN KEY (estornado_movimento_caixa_id) REFERENCES movimento_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_motivo_devolucao_cheque_id FOREIGN KEY (motivo_devolucao_cheque_id) REFERENCES motivo_devolucao_cheque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE movimento_lalur_parte_b
  ADD CONSTRAINT fk_movimento_lalur_parte_b_saldo_lalur_parte_b_id FOREIGN KEY (saldo_lalur_parte_b_id) REFERENCES saldo_lalur_parte_b (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_lalur_parte_b_ajuste_lalur_id FOREIGN KEY (ajuste_lalur_id) REFERENCES ajuste_lalur (id) ON DELETE RESTRICT;
ALTER TABLE municipio_provedor_nota
  ADD CONSTRAINT fk_municipio_provedor_nota_provedor_nota_municipal_id FOREIGN KEY (provedor_nota_municipal_id) REFERENCES provedor_nota_municipal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_municipio_provedor_nota_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE natureza_financeira
  ADD CONSTRAINT fk_natureza_financeira_subgrupo_natureza_financeira_id FOREIGN KEY (subgrupo_natureza_financeira_id) REFERENCES subgrupo_natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_financeira_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_financeira_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_financeira_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_financeira_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT;
ALTER TABLE natureza_operacao
  ADD CONSTRAINT fk_natureza_operacao_cfop_dentro_estado_id FOREIGN KEY (cfop_dentro_estado_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_operacao_cfop_fora_estado_id FOREIGN KEY (cfop_fora_estado_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_operacao_cfop_exterior_id FOREIGN KEY (cfop_exterior_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_operacao_cfop_entrada_id FOREIGN KEY (cfop_entrada_id) REFERENCES cfop (id) ON DELETE RESTRICT;
ALTER TABLE natureza_rendimento
  ADD CONSTRAINT fk_natureza_rendimento_grupo_natureza_rendimento_id FOREIGN KEY (grupo_natureza_rendimento_id) REFERENCES grupo_natureza_rendimento (id) ON DELETE RESTRICT;
ALTER TABLE natureza_rendimento_deducao
  ADD CONSTRAINT fk_natureza_rendimento_deducao_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_rendimento_deducao_tipo_deducao_irrf_id FOREIGN KEY (tipo_deducao_irrf_id) REFERENCES tipo_deducao_irrf (id) ON DELETE RESTRICT;
ALTER TABLE natureza_rendimento_isencao
  ADD CONSTRAINT fk_natureza_rendimento_isencao_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_natureza_rendimento_isencao_tipo_rendimento_isento_id FOREIGN KEY (tipo_rendimento_isento_id) REFERENCES tipo_rendimento_isento (id) ON DELETE RESTRICT;
ALTER TABLE nota_credito_debito
  ADD CONSTRAINT fk_nota_credito_debito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_motivo_nota_credito_debito_id FOREIGN KEY (motivo_nota_credito_debito_id) REFERENCES motivo_nota_credito_debito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_nota_mercadoria_id FOREIGN KEY (nota_mercadoria_id) REFERENCES nota_mercadoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_motivo_cancelamento_documento_fiscal_id FOREIGN KEY (motivo_cancelamento_documento_fiscal_id) REFERENCES motivo_cancelamento_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_xml_arquivo_id FOREIGN KEY (xml_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_pdf_arquivo_id FOREIGN KEY (pdf_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE nota_credito_debito_item
  ADD CONSTRAINT fk_nota_credito_debito_item_nota_credito_debito_id FOREIGN KEY (nota_credito_debito_id) REFERENCES nota_credito_debito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_credito_debito_item_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT;
ALTER TABLE nota_empenho
  ADD CONSTRAINT fk_nota_empenho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_modalidade_compra_publica_id FOREIGN KEY (modalidade_compra_publica_id) REFERENCES modalidade_compra_publica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_programa_trabalho_id FOREIGN KEY (programa_trabalho_id) REFERENCES programa_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE nota_empenho_item
  ADD CONSTRAINT fk_nota_empenho_item_nota_empenho_id FOREIGN KEY (nota_empenho_id) REFERENCES nota_empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_item_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_empenho_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE nota_explicativa
  ADD CONSTRAINT fk_nota_explicativa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_modelo_demonstracao_id FOREIGN KEY (modelo_demonstracao_id) REFERENCES modelo_demonstracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_linha_modelo_demonstracao_id FOREIGN KEY (linha_modelo_demonstracao_id) REFERENCES linha_modelo_demonstracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_explicativa_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE nota_mercadoria
  ADD CONSTRAINT fk_nota_mercadoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_serie_documento_fiscal_id FOREIGN KEY (serie_documento_fiscal_id) REFERENCES serie_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_transportadora_empresa_fornecedora_id FOREIGN KEY (transportadora_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_xml_arquivo_id FOREIGN KEY (xml_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_danfe_arquivo_id FOREIGN KEY (danfe_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_motivo_cancelamento_documento_fiscal_id FOREIGN KEY (motivo_cancelamento_documento_fiscal_id) REFERENCES motivo_cancelamento_documento_fiscal (id) ON DELETE RESTRICT;
ALTER TABLE nota_mercadoria_item
  ADD CONSTRAINT fk_nota_mercadoria_item_nota_mercadoria_id FOREIGN KEY (nota_mercadoria_id) REFERENCES nota_mercadoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_item_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_item_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_mercadoria_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE nota_servico
  ADD CONSTRAINT fk_nota_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_lote_nota_servico_id FOREIGN KEY (lote_nota_servico_id) REFERENCES lote_nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_serie_documento_fiscal_id FOREIGN KEY (serie_documento_fiscal_id) REFERENCES serie_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_municipio_prestacao_id FOREIGN KEY (municipio_prestacao_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_provedor_nota_municipal_id FOREIGN KEY (provedor_nota_municipal_id) REFERENCES provedor_nota_municipal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_obra_construcao_civil_id FOREIGN KEY (obra_construcao_civil_id) REFERENCES obra_construcao_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_tomador_municipio_id FOREIGN KEY (tomador_municipio_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_substitui_nota_servico_id FOREIGN KEY (substitui_nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_motivo_cancelamento_documento_fiscal_id FOREIGN KEY (motivo_cancelamento_documento_fiscal_id) REFERENCES motivo_cancelamento_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_xml_arquivo_id FOREIGN KEY (xml_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_pdf_arquivo_id FOREIGN KEY (pdf_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE nota_servico_item
  ADD CONSTRAINT fk_nota_servico_item_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_item_servico_municipal_id FOREIGN KEY (servico_municipal_id) REFERENCES servico_municipal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_item_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_servico_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE obra_construcao_civil
  ADD CONSTRAINT fk_obra_construcao_civil_responsavel_pessoa_juridica_id FOREIGN KEY (responsavel_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_obra_construcao_civil_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE obra_construcao_civil_vinculo
  ADD CONSTRAINT fk_obra_construcao_civil_vinculo_obra_construcao_civil_id FOREIGN KEY (obra_construcao_civil_id) REFERENCES obra_construcao_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_obra_construcao_civil_vinculo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_obra_construcao_civil_vinculo_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_bancaria
  ADD CONSTRAINT fk_ocorrencia_bancaria_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_bancaria_leiaute_bancario_id FOREIGN KEY (leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_bancaria_tipo_lancamento_bancario_id FOREIGN KEY (tipo_lancamento_bancario_id) REFERENCES tipo_lancamento_bancario (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_cobranca
  ADD CONSTRAINT fk_ocorrencia_cobranca_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_cobranca_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_cobranca_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_cobranca_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_cobranca_renegociacao_id FOREIGN KEY (renegociacao_id) REFERENCES renegociacao (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_cobranca_bancaria
  ADD CONSTRAINT fk_ocorrencia_cobranca_bancaria_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_cobranca_bancaria_leiaute_bancario_id FOREIGN KEY (leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_contrato
  ADD CONSTRAINT fk_ocorrencia_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_ocorrencia_pai_id FOREIGN KEY (ocorrencia_pai_id) REFERENCES ocorrencia_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_evento_contrato_id FOREIGN KEY (evento_contrato_id) REFERENCES evento_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_sla_contrato_id FOREIGN KEY (sla_contrato_id) REFERENCES sla_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_contrato_fornecedor_item_id FOREIGN KEY (contrato_fornecedor_item_id) REFERENCES contrato_fornecedor_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_parcela_contrato_fornecedor_id FOREIGN KEY (parcela_contrato_fornecedor_id) REFERENCES parcela_contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_motivo_situacao_contrato_id FOREIGN KEY (motivo_situacao_contrato_id) REFERENCES motivo_situacao_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_situacao_anterior_id FOREIGN KEY (situacao_anterior_id) REFERENCES situacao_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contrato_situacao_posterior_id FOREIGN KEY (situacao_posterior_id) REFERENCES situacao_contrato (id) ON DELETE RESTRICT;
ALTER TABLE operacao_cessao_recebivel
  ADD CONSTRAINT fk_operacao_cessao_recebivel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_cessao_recebivel_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_cessao_recebivel_cessionario_pessoa_juridica_id FOREIGN KEY (cessionario_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_cessao_recebivel_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_cessao_recebivel_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_cessao_recebivel_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE operacao_cessao_recebivel_item
  ADD CONSTRAINT fk_operacao_cessao_recebivel_item_operacao_cessao_recebivel_id FOREIGN KEY (operacao_cessao_recebivel_id) REFERENCES operacao_cessao_recebivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_cessao_recebivel_item_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_cessao_recebivel_item_parcela_recebivel_cartao_id FOREIGN KEY (parcela_recebivel_cartao_id) REFERENCES parcela_recebivel_cartao (id) ON DELETE RESTRICT;
ALTER TABLE operador_caixa
  ADD CONSTRAINT fk_operador_caixa_caixa_id FOREIGN KEY (caixa_id) REFERENCES caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operador_caixa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE orcamento_receita_fonte_pagadora
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_receita_fonte_pagadora_linha_origem_id FOREIGN KEY (linha_origem_id) REFERENCES orcamento_receita_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE orgao_arrecadador
  ADD CONSTRAINT fk_orgao_arrecadador_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orgao_arrecadador_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orgao_arrecadador_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE origem_bem
  ADD CONSTRAINT fk_origem_bem_entidade_pessoa_juridica_id FOREIGN KEY (entidade_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_origem_bem_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
