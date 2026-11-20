-- Chaves do lote 14_FIN-09 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE saldo_consolidado_mensal
  ADD CONSTRAINT fk_saldo_consolidado_mensal_conta_gerencial_consolidada_id FOREIGN KEY (conta_gerencial_consolidada_id) REFERENCES conta_gerencial_consolidada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_consolidado_mensal_estabelecimento_origem_id FOREIGN KEY (estabelecimento_origem_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_consolidado_mensal_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_contabil_auxiliar_mensal
  ADD CONSTRAINT fk_saldo_contabil_auxiliar_mensal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_auxiliar_mensal_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_auxiliar_mensal_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_auxiliar_mensal_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_auxiliar_mensal_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_auxiliar_mensal_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_auxiliar_mensal_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_contabil_centro_mensal
  ADD CONSTRAINT fk_saldo_contabil_centro_mensal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_centro_mensal_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_centro_mensal_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_centro_mensal_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_contabil_mensal
  ADD CONSTRAINT fk_saldo_contabil_mensal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_mensal_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_mensal_periodo_contabil_id FOREIGN KEY (periodo_contabil_id) REFERENCES periodo_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_contabil_mensal_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_diario_conta
  ADD CONSTRAINT fk_saldo_diario_conta_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_diario_conta_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_financeiro_periodo
  ADD CONSTRAINT fk_saldo_financeiro_periodo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_financeiro_periodo_periodo_financeiro_id FOREIGN KEY (periodo_financeiro_id) REFERENCES periodo_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_financeiro_periodo_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_financeiro_periodo_cliente_financeiro_id FOREIGN KEY (cliente_financeiro_id) REFERENCES cliente_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_financeiro_periodo_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_financeiro_periodo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_financeiro_periodo_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_financeiro_periodo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_lalur_parte_b
  ADD CONSTRAINT fk_saldo_lalur_parte_b_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_lalur_parte_b_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_lalur_parte_b_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT;
ALTER TABLE sangria_caixa
  ADD CONSTRAINT fk_sangria_caixa_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sangria_caixa_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sangria_caixa_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sangria_caixa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sangria_caixa_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE serie_documento_fiscal
  ADD CONSTRAINT fk_serie_documento_fiscal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_serie_documento_fiscal_sequencia_negocio_id FOREIGN KEY (sequencia_negocio_id) REFERENCES sequencia_negocio (id) ON DELETE RESTRICT;
ALTER TABLE servico_municipal
  ADD CONSTRAINT fk_servico_municipal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_municipal_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_municipal_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT;
ALTER TABLE sessao_caixa
  ADD CONSTRAINT fk_sessao_caixa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_caixa_caixa_id FOREIGN KEY (caixa_id) REFERENCES caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_caixa_operador_usuario_id FOREIGN KEY (operador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_caixa_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_caixa_sessao_origem_id FOREIGN KEY (sessao_origem_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_caixa_movimento_bancario_fechamento_id FOREIGN KEY (movimento_bancario_fechamento_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT;
ALTER TABLE signatario_escrituracao
  ADD CONSTRAINT fk_signatario_escrituracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_signatario_escrituracao_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_signatario_escrituracao_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_signatario_escrituracao_certificado_usuario_id FOREIGN KEY (certificado_usuario_id) REFERENCES certificado_usuario (id) ON DELETE RESTRICT;
ALTER TABLE situacao_contrato
  ADD CONSTRAINT fk_situacao_contrato_evento_contrato_id FOREIGN KEY (evento_contrato_id) REFERENCES evento_contrato (id) ON DELETE RESTRICT;
ALTER TABLE situacao_especial_empresa
  ADD CONSTRAINT fk_situacao_especial_empresa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_especial_empresa_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_especial_empresa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE sla_contrato
  ADD CONSTRAINT fk_sla_contrato_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sla_contrato_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT;
ALTER TABLE socio_titular_ecf
  ADD CONSTRAINT fk_socio_titular_ecf_periodo_escrituracao_id FOREIGN KEY (periodo_escrituracao_id) REFERENCES periodo_escrituracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_socio_titular_ecf_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_socio_titular_ecf_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_socio_titular_ecf_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_socio_titular_ecf_representante_pessoa_fisica_id FOREIGN KEY (representante_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT;
ALTER TABLE subgrupo_natureza_financeira
  ADD CONSTRAINT fk_subgrupo_natureza_financeira_grupo_natureza_financeira_id FOREIGN KEY (grupo_natureza_financeira_id) REFERENCES grupo_natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_subgrupo_natureza_financeira_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_subgrupo_natureza_financeira_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE suprimento_caixa
  ADD CONSTRAINT fk_suprimento_caixa_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suprimento_caixa_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suprimento_caixa_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suprimento_caixa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suprimento_caixa_entregador_usuario_id FOREIGN KEY (entregador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE suspensao_processo_tributario
  ADD CONSTRAINT fk_suspensao_processo_tributario_processo_tributario_id FOREIGN KEY (processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT;
ALTER TABLE talao_cheque
  ADD CONSTRAINT fk_talao_cheque_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT;
ALTER TABLE tarifa_bancaria
  ADD CONSTRAINT fk_tarifa_bancaria_retorno_bancario_id FOREIGN KEY (retorno_bancario_id) REFERENCES retorno_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarifa_bancaria_contrato_cobranca_bancaria_id FOREIGN KEY (contrato_cobranca_bancaria_id) REFERENCES contrato_cobranca_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarifa_bancaria_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarifa_bancaria_tipo_lancamento_bancario_id FOREIGN KEY (tipo_lancamento_bancario_id) REFERENCES tipo_lancamento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarifa_bancaria_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarifa_bancaria_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE taxa_administradora
  ADD CONSTRAINT fk_taxa_administradora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_administradora_administradora_cartao_id FOREIGN KEY (administradora_cartao_id) REFERENCES administradora_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_administradora_bandeira_cartao_id FOREIGN KEY (bandeira_cartao_id) REFERENCES bandeira_cartao (id) ON DELETE RESTRICT;
ALTER TABLE terminal_cartao
  ADD CONSTRAINT fk_terminal_cartao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminal_cartao_administradora_cartao_id FOREIGN KEY (administradora_cartao_id) REFERENCES administradora_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminal_cartao_caixa_id FOREIGN KEY (caixa_id) REFERENCES caixa (id) ON DELETE RESTRICT;
ALTER TABLE teto_orcamentario
  ADD CONSTRAINT fk_teto_orcamentario_programa_trabalho_id FOREIGN KEY (programa_trabalho_id) REFERENCES programa_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_orcamentario_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_orcamentario_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_orcamentario_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_orcamentario_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE tipo_ajuste_titulo
  ADD CONSTRAINT fk_tipo_ajuste_titulo_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_ajuste_titulo_orgao_arrecadador_id FOREIGN KEY (orgao_arrecadador_id) REFERENCES orgao_arrecadador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_ajuste_titulo_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_ajuste_titulo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_ajuste_titulo_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE tipo_contrato_fornecedor
  ADD CONSTRAINT fk_tipo_contrato_fornecedor_situacao_inicial_id FOREIGN KEY (situacao_inicial_id) REFERENCES situacao_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_contrato_fornecedor_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_contrato_fornecedor_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE tipo_lancamento_bancario
  ADD CONSTRAINT fk_tipo_lancamento_bancario_contrapartida_tipo_lancamento_bancar FOREIGN KEY (contrapartida_tipo_lancamento_bancario_id) REFERENCES tipo_lancamento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_bancario_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_bancario_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_bancario_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE tipo_lancamento_estabelecimento
  ADD CONSTRAINT fk_tipo_lancamento_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_estabelecimento_tipo_credor_id FOREIGN KEY (tipo_credor_id) REFERENCES tipo_credor (id) ON DELETE RESTRICT;
ALTER TABLE tipo_movimento_caixa
  ADD CONSTRAINT fk_tipo_movimento_caixa_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_movimento_caixa_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE tipo_nota_credito_debito
  ADD CONSTRAINT fk_tipo_nota_credito_debito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_nota_credito_debito_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_nota_credito_debito_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_nota_credito_debito_serie_documento_fiscal_id FOREIGN KEY (serie_documento_fiscal_id) REFERENCES serie_documento_fiscal (id) ON DELETE RESTRICT;
