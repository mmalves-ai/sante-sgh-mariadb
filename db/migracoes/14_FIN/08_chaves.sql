-- Chaves do módulo FIN, lote 08 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE reavaliacao_bem
  ADD CONSTRAINT fk_reavaliacao_bem_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reavaliacao_bem_laudo_arquivo_id FOREIGN KEY (laudo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reavaliacao_bem_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE recebimento
  ADD CONSTRAINT fk_recebimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_caixa_id FOREIGN KEY (caixa_id) REFERENCES caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_movimento_caixa_id FOREIGN KEY (movimento_caixa_id) REFERENCES movimento_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_estorno_usuario_id FOREIGN KEY (estorno_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE recebimento_item_conta
  ADD CONSTRAINT fk_recebimento_item_conta_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_item_conta_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_item_conta_demonstrativo_pagamento_item_id FOREIGN KEY (demonstrativo_pagamento_item_id) REFERENCES demonstrativo_pagamento_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_item_conta_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE recebimento_particular
  ADD CONSTRAINT fk_recebimento_particular_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_adiantamento_paciente_id FOREIGN KEY (adiantamento_paciente_id) REFERENCES adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_caixa_id FOREIGN KEY (caixa_id) REFERENCES caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_movimento_caixa_id FOREIGN KEY (movimento_caixa_id) REFERENCES movimento_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_forma_recebimento_id FOREIGN KEY (forma_recebimento_id) REFERENCES forma_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recebimento_particular_estorno_usuario_id FOREIGN KEY (estorno_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE receita_centro_custo_mensal
  ADD CONSTRAINT fk_receita_centro_custo_mensal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_centro_custo_mensal_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_centro_custo_mensal_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_centro_custo_mensal_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE recibo
  ADD CONSTRAINT fk_recibo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_recebimento_particular_id FOREIGN KEY (recebimento_particular_id) REFERENCES recebimento_particular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_adiantamento_paciente_id FOREIGN KEY (adiantamento_paciente_id) REFERENCES adiantamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_substituto_recibo_id FOREIGN KEY (substituto_recibo_id) REFERENCES recibo (id) ON DELETE RESTRICT;
ALTER TABLE recibo_autonomo
  ADD CONSTRAINT fk_recibo_autonomo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_autonomo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_autonomo_trabalhador_sem_vinculo_id FOREIGN KEY (trabalhador_sem_vinculo_id) REFERENCES trabalhador_sem_vinculo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_autonomo_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_autonomo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE recibo_autonomo_item
  ADD CONSTRAINT fk_recibo_autonomo_item_recibo_autonomo_id FOREIGN KEY (recibo_autonomo_id) REFERENCES recibo_autonomo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_autonomo_item_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_autonomo_item_producao_repasse_id FOREIGN KEY (producao_repasse_id) REFERENCES producao_repasse (id) ON DELETE RESTRICT;
ALTER TABLE reclassificacao_lancamento
  ADD CONSTRAINT fk_reclassificacao_lancamento_rateio_lancamento_id FOREIGN KEY (rateio_lancamento_id) REFERENCES rateio_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_anterior_natureza_financeira_id FOREIGN KEY (anterior_natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_nova_natureza_financeira_id FOREIGN KEY (nova_natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_anterior_centro_custo_id FOREIGN KEY (anterior_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_novo_centro_custo_id FOREIGN KEY (novo_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_anterior_conta_contabil_id FOREIGN KEY (anterior_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_nova_conta_contabil_id FOREIGN KEY (nova_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reclassificacao_lancamento_ajuste_lancamento_contabil_id FOREIGN KEY (ajuste_lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE referencia_nota_mercadoria
  ADD CONSTRAINT fk_referencia_nota_mercadoria_nota_mercadoria_id FOREIGN KEY (nota_mercadoria_id) REFERENCES nota_mercadoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_referencia_nota_mercadoria_referenciada_nota_mercadoria_id FOREIGN KEY (referenciada_nota_mercadoria_id) REFERENCES nota_mercadoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_referencia_nota_mercadoria_referenciada_nota_entrada_id FOREIGN KEY (referenciada_nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT;
ALTER TABLE registro_empresa_junta
  ADD CONSTRAINT fk_registro_empresa_junta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_empresa_junta_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_empresa_junta_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE regra_adiantamento_paciente
  ADD CONSTRAINT fk_regra_adiantamento_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_adiantamento_paciente_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_adiantamento_paciente_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_alocacao_receita_custo
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alocacao_receita_custo_destino_centro_custo_id FOREIGN KEY (destino_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE regra_bloqueio_periodo_contabil
  ADD CONSTRAINT fk_regra_bloqueio_periodo_contabil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_bloqueio_periodo_contabil_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_bloqueio_periodo_contabil_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_bloqueio_periodo_contabil_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_bloqueio_periodo_contabil_periodo_contabil_id FOREIGN KEY (periodo_contabil_id) REFERENCES periodo_contabil (id) ON DELETE RESTRICT;
ALTER TABLE regra_conciliacao_bancaria
  ADD CONSTRAINT fk_regra_conciliacao_bancaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conciliacao_bancaria_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conciliacao_bancaria_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conciliacao_bancaria_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE regra_contabilizacao
  ADD CONSTRAINT fk_regra_contabilizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_evento_contabil_id FOREIGN KEY (evento_contabil_id) REFERENCES evento_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_grupo_bem_id FOREIGN KEY (grupo_bem_id) REFERENCES grupo_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT;
ALTER TABLE regra_contabilizacao_item
  ADD CONSTRAINT fk_regra_contabilizacao_item_regra_contabilizacao_id FOREIGN KEY (regra_contabilizacao_id) REFERENCES regra_contabilizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_item_debito_conta_contabil_id FOREIGN KEY (debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_item_credito_conta_contabil_id FOREIGN KEY (credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_item_historico_padrao_id FOREIGN KEY (historico_padrao_id) REFERENCES historico_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabilizacao_item_contraparte_estabelecimento_id FOREIGN KEY (contraparte_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_controle_orcamentario
  ADD CONSTRAINT fk_regra_controle_orcamentario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_orcamentario_plano_orcamentario_id FOREIGN KEY (plano_orcamentario_id) REFERENCES plano_orcamentario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_orcamentario_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_orcamentario_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_orcamentario_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_orcamentario_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE regra_deducao_nota_servico
  ADD CONSTRAINT fk_regra_deducao_nota_servico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_deducao_nota_servico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_deducao_nota_servico_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_deducao_nota_servico_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_deducao_nota_servico_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT;
ALTER TABLE regra_importacao_custo
  ADD CONSTRAINT fk_regra_importacao_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_importacao_custo_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_importacao_custo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_importacao_custo_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE regra_iss_municipio
  ADD CONSTRAINT fk_regra_iss_municipio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_iss_municipio_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_iss_municipio_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT;
ALTER TABLE regra_pis_cofins_conta
  ADD CONSTRAINT fk_regra_pis_cofins_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pis_cofins_conta_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE regra_rateio_financeiro
  ADD CONSTRAINT fk_regra_rateio_financeiro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_financeiro_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE regra_rateio_financeiro_item
  ADD CONSTRAINT fk_regra_rateio_financeiro_item_regra_rateio_financeiro_id FOREIGN KEY (regra_rateio_financeiro_id) REFERENCES regra_rateio_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_financeiro_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_financeiro_item_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_financeiro_item_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_financeiro_item_contrapartida_conta_contabil_id FOREIGN KEY (contrapartida_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE regra_retencao
  ADD CONSTRAINT fk_regra_retencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retencao_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retencao_codigo_receita_federal_id FOREIGN KEY (codigo_receita_federal_id) REFERENCES codigo_receita_federal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retencao_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retencao_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retencao_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retencao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_retencao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE regra_servico_compartilhado
  ADD CONSTRAINT fk_regra_servico_compartilhado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_compartilhado_compartilhado_centro_custo_id FOREIGN KEY (compartilhado_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_compartilhado_origem_estabelecimento_id FOREIGN KEY (origem_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_compartilhado_origem_centro_custo_id FOREIGN KEY (origem_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_compartilhado_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_compartilhado_destino_centro_custo_id FOREIGN KEY (destino_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_servico_compartilhado_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE remanejamento_orcamentario
  ADD CONSTRAINT fk_remanejamento_orcamentario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remanejamento_orcamentario_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remanejamento_orcamentario_origem_linha_orcamento_id FOREIGN KEY (origem_linha_orcamento_id) REFERENCES linha_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remanejamento_orcamentario_destino_linha_orcamento_id FOREIGN KEY (destino_linha_orcamento_id) REFERENCES linha_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remanejamento_orcamentario_motivo_movimento_orcamento_id FOREIGN KEY (motivo_movimento_orcamento_id) REFERENCES motivo_movimento_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remanejamento_orcamentario_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remanejamento_orcamentario_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remanejamento_orcamentario_resposta_padrao_aprovacao_id FOREIGN KEY (resposta_padrao_aprovacao_id) REFERENCES resposta_padrao_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE remessa_bancaria
  ADD CONSTRAINT fk_remessa_bancaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bancaria_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bancaria_leiaute_bancario_id FOREIGN KEY (leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bancaria_bordero_pagamento_id FOREIGN KEY (bordero_pagamento_id) REFERENCES bordero_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bancaria_gerado_usuario_id FOREIGN KEY (gerado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bancaria_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE remessa_cobranca
  ADD CONSTRAINT fk_remessa_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cobranca_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cobranca_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cobranca_leiaute_bancario_id FOREIGN KEY (leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cobranca_gerado_usuario_id FOREIGN KEY (gerado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cobranca_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE remessa_cobranca_item
  ADD CONSTRAINT fk_remessa_cobranca_item_remessa_cobranca_id FOREIGN KEY (remessa_cobranca_id) REFERENCES remessa_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cobranca_item_boleto_id FOREIGN KEY (boleto_id) REFERENCES boleto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cobranca_item_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT;
ALTER TABLE rendimento_aplicacao
  ADD CONSTRAINT fk_rendimento_aplicacao_aplicacao_financeira_id FOREIGN KEY (aplicacao_financeira_id) REFERENCES aplicacao_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rendimento_aplicacao_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rendimento_aplicacao_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE renegociacao
  ADD CONSTRAINT fk_renegociacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_renegociacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_renegociacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_renegociacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_renegociacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_renegociacao_novo_titulo_receber_id FOREIGN KEY (novo_titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_renegociacao_novo_titulo_pagar_id FOREIGN KEY (novo_titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_renegociacao_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE reserva_numero_nota
  ADD CONSTRAINT fk_reserva_numero_nota_serie_documento_fiscal_id FOREIGN KEY (serie_documento_fiscal_id) REFERENCES serie_documento_fiscal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_numero_nota_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_numero_nota_reservado_usuario_id FOREIGN KEY (reservado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_numero_nota_nota_servico_id FOREIGN KEY (nota_servico_id) REFERENCES nota_servico (id) ON DELETE RESTRICT;
ALTER TABLE reserva_orcamentaria
  ADD CONSTRAINT fk_reserva_orcamentaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_linha_orcamento_id FOREIGN KEY (linha_orcamento_id) REFERENCES linha_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_orcamentaria_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_bem
  ADD CONSTRAINT fk_responsavel_bem_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_tipo_responsavel_bem_id FOREIGN KEY (tipo_responsavel_bem_id) REFERENCES tipo_responsavel_bem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_bem_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_orcamento
  ADD CONSTRAINT fk_responsavel_orcamento_versao_orcamento_id FOREIGN KEY (versao_orcamento_id) REFERENCES versao_orcamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_orcamento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_orcamento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_orcamento_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT;
ALTER TABLE resposta_padrao_aprovacao
  ADD CONSTRAINT fk_resposta_padrao_aprovacao_fluxo_aprovacao_id FOREIGN KEY (fluxo_aprovacao_id) REFERENCES fluxo_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE retencao_entrada_servico
  ADD CONSTRAINT fk_retencao_entrada_servico_entrada_servico_item_id FOREIGN KEY (entrada_servico_item_id) REFERENCES entrada_servico_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_entrada_servico_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_entrada_servico_regra_retencao_id FOREIGN KEY (regra_retencao_id) REFERENCES regra_retencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_entrada_servico_codigo_receita_federal_id FOREIGN KEY (codigo_receita_federal_id) REFERENCES codigo_receita_federal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_entrada_servico_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_entrada_servico_evento_reinf_id FOREIGN KEY (evento_reinf_id) REFERENCES evento_reinf (id) ON DELETE RESTRICT;
ALTER TABLE retencao_titulo
  ADD CONSTRAINT fk_retencao_titulo_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_titulo_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_titulo_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_titulo_regra_retencao_id FOREIGN KEY (regra_retencao_id) REFERENCES regra_retencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_titulo_codigo_receita_federal_id FOREIGN KEY (codigo_receita_federal_id) REFERENCES codigo_receita_federal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_titulo_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_titulo_recolhimento_titulo_pagar_id FOREIGN KEY (recolhimento_titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retencao_titulo_evento_reinf_id FOREIGN KEY (evento_reinf_id) REFERENCES evento_reinf (id) ON DELETE RESTRICT;
ALTER TABLE retorno_bancario
  ADD CONSTRAINT fk_retorno_bancario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_leiaute_bancario_id FOREIGN KEY (leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_remessa_bancaria_id FOREIGN KEY (remessa_bancaria_id) REFERENCES remessa_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_importado_usuario_id FOREIGN KEY (importado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE retorno_bancario_item
  ADD CONSTRAINT fk_retorno_bancario_item_retorno_bancario_id FOREIGN KEY (retorno_bancario_id) REFERENCES retorno_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_item_item_bordero_id FOREIGN KEY (item_bordero_id) REFERENCES item_bordero (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_item_parcela_pagar_id FOREIGN KEY (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_item_ocorrencia_bancaria_id FOREIGN KEY (ocorrencia_bancaria_id) REFERENCES ocorrencia_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_bancario_item_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT;
ALTER TABLE retorno_cobranca
  ADD CONSTRAINT fk_retorno_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_leiaute_bancario_id FOREIGN KEY (leiaute_bancario_id) REFERENCES leiaute_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_importado_usuario_id FOREIGN KEY (importado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE retorno_cobranca_item
  ADD CONSTRAINT fk_retorno_cobranca_item_retorno_cobranca_id FOREIGN KEY (retorno_cobranca_id) REFERENCES retorno_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_item_boleto_id FOREIGN KEY (boleto_id) REFERENCES boleto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_item_parcela_receber_id FOREIGN KEY (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_item_remessa_cobranca_item_id FOREIGN KEY (remessa_cobranca_item_id) REFERENCES remessa_cobranca_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_item_ocorrencia_cobranca_bancaria_id FOREIGN KEY (ocorrencia_cobranca_bancaria_id) REFERENCES ocorrencia_cobranca_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_item_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_cobranca_item_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT;
ALTER TABLE retorno_pix
  ADD CONSTRAINT fk_retorno_pix_cobranca_pix_id FOREIGN KEY (cobranca_pix_id) REFERENCES cobranca_pix (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_pix_recebimento_id FOREIGN KEY (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_pix_movimento_bancario_id FOREIGN KEY (movimento_bancario_id) REFERENCES movimento_bancario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_pix_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE retorno_reinf
  ADD CONSTRAINT fk_retorno_reinf_evento_reinf_id FOREIGN KEY (evento_reinf_id) REFERENCES evento_reinf (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_reinf_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_reinf_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
