-- Chaves do módulo FIN, lote 01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE adiantamento
  ADD CONSTRAINT fk_adiantamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_cheque_emitido_id FOREIGN KEY (cheque_emitido_id) REFERENCES cheque_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE adiantamento_paciente
  ADD CONSTRAINT fk_adiantamento_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_responsavel_paciente_id FOREIGN KEY (responsavel_paciente_id) REFERENCES responsavel_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_motivo_adiantamento_paciente_id FOREIGN KEY (motivo_adiantamento_paciente_id) REFERENCES motivo_adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_contrato_adiantamento_paciente_id FOREIGN KEY (contrato_adiantamento_paciente_id) REFERENCES contrato_adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_administradora_cartao_id FOREIGN KEY (administradora_cartao_id) REFERENCES administradora_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_bandeira_cartao_id FOREIGN KEY (bandeira_cartao_id) REFERENCES bandeira_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_transacao_cartao_id FOREIGN KEY (transacao_cartao_id) REFERENCES transacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_cheque_banco_id FOREIGN KEY (cheque_banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_paciente_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT;
ALTER TABLE aditivo_contrato
  ADD CONSTRAINT fk_aditivo_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aditivo_contrato_contrato_vinculado_id FOREIGN KEY (contrato_vinculado_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aditivo_contrato_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE administradora_cartao
  ADD CONSTRAINT fk_administradora_cartao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administradora_cartao_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administradora_cartao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administradora_cartao_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administradora_cartao_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administradora_cartao_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_administradora_cartao_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT;
ALTER TABLE agencia_bancaria
  ADD CONSTRAINT fk_agencia_bancaria_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agencia_bancaria_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE agregacao_bem
  ADD CONSTRAINT fk_agregacao_bem_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agregacao_bem_bem_agregado_id FOREIGN KEY (bem_agregado_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agregacao_bem_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agregacao_bem_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agregacao_bem_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE agrupador_aprovacao
  ADD CONSTRAINT fk_agrupador_aprovacao_fluxo_aprovacao_id FOREIGN KEY (fluxo_aprovacao_id) REFERENCES fluxo_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_lalur
  ADD CONSTRAINT fk_ajuste_lalur_apuracao_irpj_csll_id FOREIGN KEY (apuracao_irpj_csll_id) REFERENCES apuracao_irpj_csll (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_lalur_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_lalur_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_lalur_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_orcamento_nota
  ADD CONSTRAINT fk_ajuste_orcamento_nota_reserva_orcamentaria_id FOREIGN KEY (reserva_orcamentaria_id) REFERENCES reserva_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_orcamento_nota_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_orcamento_nota_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_orcamento_nota_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_orcamento_nota_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_orcamento_nota_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_orcamento_nota_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_provisao_passivo
  ADD CONSTRAINT fk_ajuste_provisao_passivo_provisao_passivo_id FOREIGN KEY (provisao_passivo_id) REFERENCES provisao_passivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_provisao_passivo_tipo_ajuste_titulo_id FOREIGN KEY (tipo_ajuste_titulo_id) REFERENCES tipo_ajuste_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_provisao_passivo_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_titulo
  ADD CONSTRAINT fk_ajuste_titulo_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_titulo_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_titulo_tipo_ajuste_titulo_id FOREIGN KEY (tipo_ajuste_titulo_id) REFERENCES tipo_ajuste_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_titulo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE aliquota_tributo_excecao
  ADD CONSTRAINT fk_aliquota_tributo_excecao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_tributo_excecao_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_tributo_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_tributo_excecao_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_tributo_excecao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_tributo_excecao_classificacao_tributaria_ibs_cbs_id FOREIGN KEY (classificacao_tributaria_ibs_cbs_id) REFERENCES classificacao_tributaria_ibs_cbs (id) ON DELETE RESTRICT;
ALTER TABLE aliquota_tributo_vigencia
  ADD CONSTRAINT fk_aliquota_tributo_vigencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_tributo_vigencia_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_tributo_vigencia_codigo_receita_federal_id FOREIGN KEY (codigo_receita_federal_id) REFERENCES codigo_receita_federal (id) ON DELETE RESTRICT;
ALTER TABLE anexo_contrato
  ADD CONSTRAINT fk_anexo_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_contrato_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_contrato_aditivo_contrato_id FOREIGN KEY (aditivo_contrato_id) REFERENCES aditivo_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anexo_contrato_autenticador_usuario_id FOREIGN KEY (autenticador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aplicacao_adiantamento_paciente
  ADD CONSTRAINT fk_aplicacao_adiantamento_paciente_adiantamento_paciente_id FOREIGN KEY (adiantamento_paciente_id) REFERENCES adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_adiantamento_paciente_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_adiantamento_paciente_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_adiantamento_paciente_aplicador_usuario_id FOREIGN KEY (aplicador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aplicacao_credito_fonte_pagadora
  ADD CONSTRAINT fk_aplicacao_credito_fonte_pagadora_credito_fonte_pagadora_id FOREIGN KEY (credito_fonte_pagadora_id) REFERENCES credito_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_credito_fonte_pagadora_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_credito_fonte_pagadora_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_credito_fonte_pagadora_aplicador_usuario_id FOREIGN KEY (aplicador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aplicacao_financeira
  ADD CONSTRAINT fk_aplicacao_financeira_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_financeira_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_financeira_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_financeira_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aplicacao_financeira_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE apolice_seguro
  ADD CONSTRAINT fk_apolice_seguro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apolice_seguro_seguradora_empresa_fornecedora_id FOREIGN KEY (seguradora_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apolice_seguro_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apolice_seguro_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apolice_seguro_apolice_anterior_id FOREIGN KEY (apolice_anterior_id) REFERENCES apolice_seguro (id) ON DELETE RESTRICT;
ALTER TABLE apontamento_producao_contrato
  ADD CONSTRAINT fk_apontamento_producao_contrato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apontamento_producao_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apontamento_producao_contrato_evento_contrato_id FOREIGN KEY (evento_contrato_id) REFERENCES evento_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apontamento_producao_contrato_liberador_usuario_id FOREIGN KEY (liberador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apontamento_producao_contrato_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apontamento_producao_contrato_medicao_contrato_id FOREIGN KEY (medicao_contrato_id) REFERENCES medicao_contrato (id) ON DELETE RESTRICT;
ALTER TABLE apropriacao_imobilizado_andamento
  ADD CONSTRAINT fk_apropriacao_imobilizado_andamento_imobilizado_andamento_id FOREIGN KEY (imobilizado_andamento_id) REFERENCES imobilizado_andamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_imobilizado_andamento_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_imobilizado_andamento_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_imobilizado_andamento_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_imobilizado_andamento_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE apropriacao_projeto
  ADD CONSTRAINT fk_apropriacao_projeto_projeto_id FOREIGN KEY (projeto_id) REFERENCES projeto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_projeto_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_projeto_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_projeto_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apropriacao_projeto_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE aprovacao_orcamento
  ADD CONSTRAINT fk_aprovacao_orcamento_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovacao_orcamento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovacao_orcamento_fase_orcamentaria_id FOREIGN KEY (fase_orcamentaria_id) REFERENCES fase_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovacao_orcamento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovacao_orcamento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aprovador_etapa
  ADD CONSTRAINT fk_aprovador_etapa_etapa_fluxo_aprovacao_id FOREIGN KEY (etapa_fluxo_aprovacao_id) REFERENCES etapa_fluxo_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovador_etapa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovador_etapa_papel_seguranca_id FOREIGN KEY (papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovador_etapa_substituto_usuario_id FOREIGN KEY (substituto_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aprovador_etapa_agrupador_aprovacao_id FOREIGN KEY (agrupador_aprovacao_id) REFERENCES agrupador_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_consolidacao
  ADD CONSTRAINT fk_apuracao_consolidacao_grupo_consolidacao_id FOREIGN KEY (grupo_consolidacao_id) REFERENCES grupo_consolidacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_consolidacao_rodada_anterior_id FOREIGN KEY (rodada_anterior_id) REFERENCES apuracao_consolidacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_consolidacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_cprb
  ADD CONSTRAINT fk_apuracao_cprb_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_cprb_atividade_cprb_id FOREIGN KEY (atividade_cprb_id) REFERENCES atividade_cprb (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_cprb_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_cprb_evento_reinf_id FOREIGN KEY (evento_reinf_id) REFERENCES evento_reinf (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_custo
  ADD CONSTRAINT fk_apuracao_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_custo_fechador_usuario_id FOREIGN KEY (fechador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_irpj_csll
  ADD CONSTRAINT fk_apuracao_irpj_csll_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_irpj_csll_provisao_lancamento_contabil_id FOREIGN KEY (provisao_lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_irpj_csll_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_pis_cofins
  ADD CONSTRAINT fk_apuracao_pis_cofins_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_pis_cofins_guia_recolhimento_pis_id FOREIGN KEY (guia_recolhimento_pis_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_pis_cofins_guia_recolhimento_cofins_id FOREIGN KEY (guia_recolhimento_cofins_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_pis_cofins_arquivo_efd_contribuicoes_id FOREIGN KEY (arquivo_efd_contribuicoes_id) REFERENCES arquivo_efd_contribuicoes (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_resultado
  ADD CONSTRAINT fk_apuracao_resultado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_resultado_periodo_contabil_id FOREIGN KEY (periodo_contabil_id) REFERENCES periodo_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_resultado_conta_resultado_conta_contabil_id FOREIGN KEY (conta_resultado_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_resultado_conta_destino_conta_contabil_id FOREIGN KEY (conta_destino_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_resultado_lote_contabil_id FOREIGN KEY (lote_contabil_id) REFERENCES lote_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_resultado_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_retencao
  ADD CONSTRAINT fk_apuracao_retencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_codigo_receita_federal_id FOREIGN KEY (codigo_receita_federal_id) REFERENCES codigo_receita_federal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_guia_recolhimento_id FOREIGN KEY (guia_recolhimento_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_abridor_usuario_id FOREIGN KEY (abridor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_fechador_usuario_id FOREIGN KEY (fechador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_retencao_item
  ADD CONSTRAINT fk_apuracao_retencao_item_apuracao_retencao_id FOREIGN KEY (apuracao_retencao_id) REFERENCES apuracao_retencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_item_retencao_titulo_id FOREIGN KEY (retencao_titulo_id) REFERENCES retencao_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_item_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_retencao_item_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_efd_contribuicoes
  ADD CONSTRAINT fk_arquivo_efd_contribuicoes_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_efd_contribuicoes_arquivo_retificado_id FOREIGN KEY (arquivo_retificado_id) REFERENCES arquivo_efd_contribuicoes (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_efd_contribuicoes_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_efd_contribuicoes_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_efd_fiscal
  ADD CONSTRAINT fk_arquivo_efd_fiscal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_efd_fiscal_arquivo_retificado_id FOREIGN KEY (arquivo_retificado_id) REFERENCES arquivo_efd_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_efd_fiscal_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_efd_fiscal_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_sped_contabil
  ADD CONSTRAINT fk_arquivo_sped_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_sped_contabil_arquivo_substituido_id FOREIGN KEY (arquivo_substituido_id) REFERENCES arquivo_sped_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_sped_contabil_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_sped_contabil_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_contrato
  ADD CONSTRAINT fk_auditoria_contrato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_contrato_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_contrato_item
  ADD CONSTRAINT fk_auditoria_contrato_item_auditoria_contrato_id FOREIGN KEY (auditoria_contrato_id) REFERENCES auditoria_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_contrato_item_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE auditor_independente
  ADD CONSTRAINT fk_auditor_independente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE baixa_bem
  ADD CONSTRAINT fk_baixa_bem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_motivo_baixa_bem_id FOREIGN KEY (motivo_baixa_bem_id) REFERENCES motivo_baixa_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_apolice_seguro_id FOREIGN KEY (apolice_seguro_id) REFERENCES apolice_seguro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_movimento_bem_id FOREIGN KEY (movimento_bem_id) REFERENCES movimento_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_bem_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE baixa_titulo
  ADD CONSTRAINT fk_baixa_titulo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_bordero_pagamento_id FOREIGN KEY (bordero_pagamento_id) REFERENCES bordero_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_cheque_emitido_id FOREIGN KEY (cheque_emitido_id) REFERENCES cheque_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_pagamento_pix_id FOREIGN KEY (pagamento_pix_id) REFERENCES pagamento_pix (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_estornador_usuario_id FOREIGN KEY (estornador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_baixa_titulo_estorno_lancamento_contabil_id FOREIGN KEY (estorno_lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE bem_patrimonial
  ADD CONSTRAINT fk_bem_patrimonial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_grupo_bem_id FOREIGN KEY (grupo_bem_id) REFERENCES grupo_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_origem_bem_id FOREIGN KEY (origem_bem_id) REFERENCES origem_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_tipo_responsavel_bem_id FOREIGN KEY (tipo_responsavel_bem_id) REFERENCES tipo_responsavel_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_bem_agregador_id FOREIGN KEY (bem_agregador_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_imobilizado_andamento_id FOREIGN KEY (imobilizado_andamento_id) REFERENCES imobilizado_andamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_coeficiente_turno_id FOREIGN KEY (coeficiente_turno_id) REFERENCES coeficiente_turno (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_patrimonial_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE bem_segurado
  ADD CONSTRAINT fk_bem_segurado_apolice_seguro_id FOREIGN KEY (apolice_seguro_id) REFERENCES apolice_seguro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bem_segurado_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT;
