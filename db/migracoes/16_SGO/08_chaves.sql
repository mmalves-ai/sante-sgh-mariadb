-- Chaves do módulo SGO, lote 08 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE regra_arquivo_prestador
  ADD CONSTRAINT fk_regra_arquivo_prestador_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_arquivo_prestador_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE regra_ato_cooperativo
  ADD CONSTRAINT fk_regra_ato_cooperativo_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_ato_cooperativo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobertura_rol
  ADD CONSTRAINT fk_regra_cobertura_rol_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobertura_rol_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobertura_rol_rol_procedimento_ans_id FOREIGN KEY (rol_procedimento_ans_id) REFERENCES rol_procedimento_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobertura_rol_diretriz_utilizacao_ans_id FOREIGN KEY (diretriz_utilizacao_ans_id) REFERENCES diretriz_utilizacao_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobertura_rol_tipo_regulacao_cobertura_id FOREIGN KEY (tipo_regulacao_cobertura_id) REFERENCES tipo_regulacao_cobertura (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobranca_intercambio
  ADD CONSTRAINT fk_regra_cobranca_intercambio_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_intercambio_classe_despesa_assistencial_id FOREIGN KEY (classe_despesa_assistencial_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_intercambio_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE regra_comissao_parcela
  ADD CONSTRAINT fk_regra_comissao_parcela_regra_comissao_venda_id FOREIGN KEY (regra_comissao_venda_id) REFERENCES regra_comissao_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_parcela_papel_venda_id FOREIGN KEY (papel_venda_id) REFERENCES papel_venda (id) ON DELETE RESTRICT;
ALTER TABLE regra_comissao_venda
  ADD CONSTRAINT fk_regra_comissao_venda_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_incidencia_comissao_id FOREIGN KEY (incidencia_comissao_id) REFERENCES incidencia_comissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_classificacao_plano_id FOREIGN KEY (classificacao_plano_id) REFERENCES classificacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_canal_venda_plano_id FOREIGN KEY (canal_venda_plano_id) REFERENCES canal_venda_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_comissao_venda_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT;
ALTER TABLE regra_concomitancia
  ADD CONSTRAINT fk_regra_concomitancia_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_concomitancia_principal_item_faturavel_id FOREIGN KEY (principal_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_concomitancia_regime_atendimento_rede_id FOREIGN KEY (regime_atendimento_rede_id) REFERENCES regime_atendimento_rede (id) ON DELETE RESTRICT;
ALTER TABLE regra_concomitancia_excecao
  ADD CONSTRAINT fk_regra_concomitancia_excecao_regra_concomitancia_id FOREIGN KEY (regra_concomitancia_id) REFERENCES regra_concomitancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_concomitancia_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_concomitancia_excecao_regime_atendimento_rede_id FOREIGN KEY (regime_atendimento_rede_id) REFERENCES regime_atendimento_rede (id) ON DELETE RESTRICT;
ALTER TABLE regra_concomitancia_item
  ADD CONSTRAINT fk_regra_concomitancia_item_regra_concomitancia_id FOREIGN KEY (regra_concomitancia_id) REFERENCES regra_concomitancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_concomitancia_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_coparticipacao
  ADD CONSTRAINT fk_regra_coparticipacao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_regime_atendimento_rede_id FOREIGN KEY (regime_atendimento_rede_id) REFERENCES regime_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_condicao_cobranca_coparticipacao_id FOREIGN KEY (condicao_cobranca_coparticipacao_id) REFERENCES condicao_cobranca_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_forma_pagamento_coparticipacao_id FOREIGN KEY (forma_pagamento_coparticipacao_id) REFERENCES forma_pagamento_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_coparticipacao_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE regra_critica_conta
  ADD CONSTRAINT fk_regra_critica_conta_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_conta_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_conta_relacionado_item_faturavel_id FOREIGN KEY (relacionado_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_conta_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_conta_classe_despesa_assistencial_id FOREIGN KEY (classe_despesa_assistencial_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_critica_conta_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE regra_distribuicao_analise
  ADD CONSTRAINT fk_regra_distribuicao_analise_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_distribuicao_analise_analista_usuario_id FOREIGN KEY (analista_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_documento_solicitacao_portal
  ADD CONSTRAINT fk_regra_documento_solicitacao_portal_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_documento_solicitacao_portal_grau_parentesco_d_aef64297 FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT;
ALTER TABLE regra_fator_custeio
  ADD CONSTRAINT fk_regra_fator_custeio_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fator_custeio_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE regra_favorecido_pagamento_rede
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_executante_prestador_rede_id FOREIGN KEY (executante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_grupo_procedimento_o_0e037e9b FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_principal_prestador_rede_id FOREIGN KEY (principal_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_favorecido_prestador_rede_id FOREIGN KEY (favorecido_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_favorecido_pagamento_rede_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_franquia_excecao
  ADD CONSTRAINT fk_regra_franquia_excecao_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_excecao_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_excecao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_excecao_agrupamento_prestador_rede_id FOREIGN KEY (agrupamento_prestador_rede_id) REFERENCES agrupamento_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_excecao_conjunto_criterio_aplicacao_id FOREIGN KEY (conjunto_criterio_aplicacao_id) REFERENCES conjunto_criterio_aplicacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_excecao_modelo_horario_atendimento_id FOREIGN KEY (modelo_horario_atendimento_id) REFERENCES modelo_horario_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_excecao_tabela_remuneracao_rede_id FOREIGN KEY (tabela_remuneracao_rede_id) REFERENCES tabela_remuneracao_rede (id) ON DELETE RESTRICT;
ALTER TABLE regra_franquia_plano
  ADD CONSTRAINT fk_regra_franquia_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_tipo_franquia_id FOREIGN KEY (tipo_franquia_id) REFERENCES tipo_franquia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_pai_regra_franquia_plano_id FOREIGN KEY (pai_regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_regime_atendimento_rede_id FOREIGN KEY (regime_atendimento_rede_id) REFERENCES regime_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_tabela_remuneracao_rede_id FOREIGN KEY (tabela_remuneracao_rede_id) REFERENCES tabela_remuneracao_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_ressarcimento_tipo_lancamento_fatura_id FOREIGN KEY (ressarcimento_tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_franquia_plano_regra_subsidio_coparticipacao_id FOREIGN KEY (regra_subsidio_coparticipacao_id) REFERENCES regra_subsidio_coparticipacao (id) ON DELETE RESTRICT;
ALTER TABLE regra_livro_auxiliar_ans
  ADD CONSTRAINT fk_regra_livro_auxiliar_ans_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_livro_auxiliar_ans_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE regra_maioridade_dependente
  ADD CONSTRAINT fk_regra_maioridade_dependente_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_maioridade_dependente_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_maioridade_dependente_grau_parentesco_dependente_id FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_maioridade_dependente_motivo_movimento_cadastral_id FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT;
ALTER TABLE regra_numeracao_carteira
  ADD CONSTRAINT fk_regra_numeracao_carteira_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT;
ALTER TABLE regra_numeracao_carteira_item
  ADD CONSTRAINT fk_regra_numeracao_carteira_item_regra_numeracao_carteira_id FOREIGN KEY (regra_numeracao_carteira_id) REFERENCES regra_numeracao_carteira (id) ON DELETE RESTRICT;
ALTER TABLE regra_preco_previdencia
  ADD CONSTRAINT fk_regra_preco_previdencia_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_previdencia_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_previdencia_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT;
ALTER TABLE regra_preco_previdencia_condicao
  ADD CONSTRAINT fk_regra_preco_previdencia_condicao_regra_preco_previdencia_id FOREIGN KEY (regra_preco_previdencia_id) REFERENCES regra_preco_previdencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_previdencia_condicao_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_previdencia_condicao_grau_parentesco_dep_ba77550f FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_preco_previdencia_condicao_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT;
ALTER TABLE regra_reajuste_sinistralidade
  ADD CONSTRAINT fk_regra_reajuste_sinistralidade_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT;
ALTER TABLE regra_reajuste_sinistralidade_faixa
  ADD CONSTRAINT fk_regra_reajuste_sinistralidade_faixa_regra_reajuste_s_27084750 FOREIGN KEY (regra_reajuste_sinistralidade_id) REFERENCES regra_reajuste_sinistralidade (id) ON DELETE RESTRICT;
ALTER TABLE regra_reembolso_plano
  ADD CONSTRAINT fk_regra_reembolso_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_reembolso_plano_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_reembolso_plano_modalidade_reembolso_id FOREIGN KEY (modalidade_reembolso_id) REFERENCES modalidade_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_reembolso_plano_tabela_reembolso_referencia_id FOREIGN KEY (tabela_reembolso_referencia_id) REFERENCES tabela_reembolso_referencia (id) ON DELETE RESTRICT;
ALTER TABLE regra_subsidio_coparticipacao
  ADD CONSTRAINT fk_regra_subsidio_coparticipacao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subsidio_coparticipacao_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT;
ALTER TABLE regra_subsidio_coparticipacao_item
  ADD CONSTRAINT fk_regra_subsidio_coparticipacao_item_regra_subsidio_co_3535b295 FOREIGN KEY (regra_subsidio_coparticipacao_id) REFERENCES regra_subsidio_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subsidio_coparticipacao_item_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subsidio_coparticipacao_item_grupo_procediment_58b3c613 FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subsidio_coparticipacao_item_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subsidio_coparticipacao_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_suspensao_atendimento
  ADD CONSTRAINT fk_regra_suspensao_atendimento_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_suspensao_atendimento_motivo_movimento_cadastral_id FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_suspensao_atendimento_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_suspensao_atendimento_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_suspensao_atendimento_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_suspensao_atendimento_procedimentos_excetuados_1b8f797a FOREIGN KEY (procedimentos_excetuados_grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_suspensao_atendimento_ativado_por_usuario_id FOREIGN KEY (ativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_suspensao_atendimento_desativado_por_usuario_id FOREIGN KEY (desativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_titulo_receita_contrato
  ADD CONSTRAINT fk_regra_titulo_receita_contrato_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_titulo_receita_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_titulo_receita_contrato_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_titulo_receita_contrato_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_titulo_receita_contrato_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE regra_validade_cartao
  ADD CONSTRAINT fk_regra_validade_cartao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_validade_cartao_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_validade_cartao_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_validade_cartao_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE regra_valor_motivo_glosa
  ADD CONSTRAINT fk_regra_valor_motivo_glosa_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valor_motivo_glosa_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valor_motivo_glosa_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE regra_valoracao_item
  ADD CONSTRAINT fk_regra_valoracao_item_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_agrupamento_prestador_rede_id FOREIGN KEY (agrupamento_prestador_rede_id) REFERENCES agrupamento_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_regime_atendimento_rede_id FOREIGN KEY (regime_atendimento_rede_id) REFERENCES regime_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_conjunto_criterio_aplicacao_id FOREIGN KEY (conjunto_criterio_aplicacao_id) REFERENCES conjunto_criterio_aplicacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valoracao_item_tabela_remuneracao_rede_id FOREIGN KEY (tabela_remuneracao_rede_id) REFERENCES tabela_remuneracao_rede (id) ON DELETE RESTRICT;
ALTER TABLE remessa_desconto_folha
  ADD CONSTRAINT fk_remessa_desconto_folha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_remessa_arquivo_id FOREIGN KEY (remessa_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE remessa_desconto_folha_item
  ADD CONSTRAINT fk_remessa_desconto_folha_item_remessa_desconto_folha_id FOREIGN KEY (remessa_desconto_folha_id) REFERENCES remessa_desconto_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_item_verba_desconto_folha_id FOREIGN KEY (verba_desconto_folha_id) REFERENCES verba_desconto_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_item_mensalidade_beneficiario_id FOREIGN KEY (mensalidade_beneficiario_id) REFERENCES mensalidade_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_item_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_desconto_folha_item_baixa_manual_usuario_id FOREIGN KEY (baixa_manual_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE remuneracao_capitacao
  ADD CONSTRAINT fk_remuneracao_capitacao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remuneracao_capitacao_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remuneracao_capitacao_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remuneracao_capitacao_rede_assistencial_id FOREIGN KEY (rede_assistencial_id) REFERENCES rede_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE repasse_beneficiario_intercambio
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_origem_operadora_co_685e5a81 FOREIGN KEY (origem_operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_destino_operadora_c_5eb963f9 FOREIGN KEY (destino_operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_empresa_pessoa_juridica_id FOREIGN KEY (empresa_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE repasse_beneficiario_intercambio_item
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_item_repasse_benefi_74819a44 FOREIGN KEY (repasse_beneficiario_intercambio_id) REFERENCES repasse_beneficiario_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_item_produto_intercambio_id FOREIGN KEY (produto_intercambio_id) REFERENCES produto_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_item_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_beneficiario_intercambio_item_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE repasse_servico_adicional
  ADD CONSTRAINT fk_repasse_servico_adicional_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_servico_adicional_servico_adicional_plano_id FOREIGN KEY (servico_adicional_plano_id) REFERENCES servico_adicional_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_servico_adicional_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE repasse_servico_adicional_item
  ADD CONSTRAINT fk_repasse_servico_adicional_item_repasse_servico_adicional_id FOREIGN KEY (repasse_servico_adicional_id) REFERENCES repasse_servico_adicional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_servico_adicional_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_servico_adicional_item_mensalidade_beneficiario_id FOREIGN KEY (mensalidade_beneficiario_id) REFERENCES mensalidade_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_servico_adicional_item_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_repasse_servico_adicional_item_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_operadora
  ADD CONSTRAINT fk_responsavel_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_operadora_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_operadora_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_operadora_cargo_dirigente_operadora_id FOREIGN KEY (cargo_dirigente_operadora_id) REFERENCES cargo_dirigente_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_operadora_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
ALTER TABLE ressarcimento_sus_atendimento
  ADD CONSTRAINT fk_ressarcimento_sus_atendimento_cobranca_ressarcimento_sus_id FOREIGN KEY (cobranca_ressarcimento_sus_id) REFERENCES cobranca_ressarcimento_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ressarcimento_sus_atendimento_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ressarcimento_sus_atendimento_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ressarcimento_sus_atendimento_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ressarcimento_sus_atendimento_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ressarcimento_sus_atendimento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE restituicao_desconto_folha
  ADD CONSTRAINT fk_restituicao_desconto_folha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restituicao_desconto_folha_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restituicao_desconto_folha_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restituicao_desconto_folha_verba_desconto_folha_id FOREIGN KEY (verba_desconto_folha_id) REFERENCES verba_desconto_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restituicao_desconto_folha_titular_beneficiario_plano_id FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restituicao_desconto_folha_arquivo_envio_arquivo_id FOREIGN KEY (arquivo_envio_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restituicao_desconto_folha_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE restituicao_desconto_folha_item
  ADD CONSTRAINT fk_restituicao_desconto_folha_item_restituicao_desconto_folha_id FOREIGN KEY (restituicao_desconto_folha_id) REFERENCES restituicao_desconto_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restituicao_desconto_folha_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT;
