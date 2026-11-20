-- SGO, lote 02: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE campanha_venda_participante
  ADD CONSTRAINT fk_campanha_venda_participante_campanha_comercial_plano_id FOREIGN KEY (campanha_comercial_plano_id) REFERENCES campanha_comercial_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_participante_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_participante_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_participante_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_participante_regra_comissao_venda_id FOREIGN KEY (regra_comissao_venda_id) REFERENCES regra_comissao_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_participante_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE canal_atendimento_operadora
  ADD CONSTRAINT fk_canal_atendimento_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_canal_atendimento_operadora_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_contrato_plano
  ADD CONSTRAINT fk_cancelamento_contrato_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_contrato_plano_motivo_cancelamento_contrato_id FOREIGN KEY (motivo_cancelamento_contrato_id) REFERENCES motivo_cancelamento_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_contrato_plano_efetivado_por_usuario_id FOREIGN KEY (efetivado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_contrato_plano_revertido_por_usuario_id FOREIGN KEY (revertido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_guia_recebido
  ADD CONSTRAINT fk_cancelamento_guia_recebido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_guia_recebido_item
  ADD CONSTRAINT fk_cancelamento_guia_recebido_item_cancelamento_guia_recebido_id FOREIGN KEY (cancelamento_guia_recebido_id) REFERENCES cancelamento_guia_recebido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_item_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_item_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_recebido_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE carencia_aplicada
  ADD CONSTRAINT fk_carencia_aplicada_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carencia_aplicada_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carencia_aplicada_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carencia_aplicada_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carencia_aplicada_portabilidade_carencia_id FOREIGN KEY (portabilidade_carencia_id) REFERENCES portabilidade_carencia (id) ON DELETE RESTRICT;
ALTER TABLE carencia_impressa_cartao
  ADD CONSTRAINT fk_carencia_impressa_cartao_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carencia_impressa_cartao_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT;
ALTER TABLE carencia_produto_contrato
  ADD CONSTRAINT fk_carencia_produto_contrato_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carencia_produto_contrato_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carencia_produto_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE cartao_beneficiario
  ADD CONSTRAINT fk_cartao_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_beneficiario_lote_emissao_cartao_id FOREIGN KEY (lote_emissao_cartao_id) REFERENCES lote_emissao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_beneficiario_solicitacao_cartao_beneficiario_id FOREIGN KEY (solicitacao_cartao_beneficiario_id) REFERENCES solicitacao_cartao_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_beneficiario_motivo_solicitacao_cartao_id FOREIGN KEY (motivo_solicitacao_cartao_id) REFERENCES motivo_solicitacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_beneficiario_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cartao_beneficiario_motivo_cancelamento_cartao_id FOREIGN KEY (motivo_cancelamento_cartao_id) REFERENCES motivo_solicitacao_cartao (id) ON DELETE RESTRICT;
ALTER TABLE carteira_contrato_plano
  ADD CONSTRAINT fk_carteira_contrato_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_contrato_plano_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_contrato_plano_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE classe_despesa_assistencial
  ADD CONSTRAINT fk_classe_despesa_assistencial_classe_pai_id FOREIGN KEY (classe_pai_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classe_despesa_assistencial_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT;
ALTER TABLE classe_despesa_centro_custo
  ADD CONSTRAINT fk_classe_despesa_centro_custo_classe_despesa_assistencial_id FOREIGN KEY (classe_despesa_assistencial_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classe_despesa_centro_custo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classe_despesa_centro_custo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classe_despesa_centro_custo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE classe_despesa_procedimento
  ADD CONSTRAINT fk_classe_despesa_procedimento_classe_despesa_assistencial_id FOREIGN KEY (classe_despesa_assistencial_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classe_despesa_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE classe_vendedor_plano
  ADD CONSTRAINT fk_classe_vendedor_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT;
ALTER TABLE cobertura_parcial_temporaria
  ADD CONSTRAINT fk_cobertura_parcial_temporaria_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_parcial_temporaria_doenca_preexistente_declarada_id FOREIGN KEY (doenca_preexistente_declarada_id) REFERENCES doenca_preexistente_declarada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_parcial_temporaria_grupo_patologia_id FOREIGN KEY (grupo_patologia_id) REFERENCES grupo_patologia (id) ON DELETE RESTRICT;
ALTER TABLE cobertura_parcial_temporaria_procedimento
  ADD CONSTRAINT fk_cpt_procedimento_cpt_id FOREIGN KEY (cobertura_parcial_temporaria_id) REFERENCES cobertura_parcial_temporaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_parcial_temporaria_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cpt_procedimento_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE cobranca_ressarcimento_sus
  ADD CONSTRAINT fk_cobranca_ressarcimento_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobranca_ressarcimento_sus_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobranca_ressarcimento_sus_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE comissao_venda
  ADD CONSTRAINT fk_comissao_venda_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_nota_fiscal_arquivo_id FOREIGN KEY (nota_fiscal_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_reaberta_por_usuario_id FOREIGN KEY (reaberta_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE comissao_venda_item
  ADD CONSTRAINT fk_comissao_venda_item_comissao_venda_id FOREIGN KEY (comissao_venda_id) REFERENCES comissao_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_mensalidade_beneficiario_id FOREIGN KEY (mensalidade_beneficiario_id) REFERENCES mensalidade_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_venda_item_regra_comissao_venda_id FOREIGN KEY (regra_comissao_venda_id) REFERENCES regra_comissao_venda (id) ON DELETE RESTRICT;
ALTER TABLE comunicacao_internacao_recebida
  ADD CONSTRAINT fk_comunicacao_internacao_recebida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_recebida_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_recebida_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_recebida_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_recebida_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_recebida_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunic_int_receb_token_atendimento_beneficiario_id FOREIGN KEY (token_atendimento_beneficiario_id) REFERENCES token_atendimento_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_recebida_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_cadastral_ans
  ADD CONSTRAINT fk_conferencia_cadastral_ans_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_cadastral_ans_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_cadastral_ans_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_cadastral_ans_conferida_por_usuario_id FOREIGN KEY (conferida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_cadastral_ans_item
  ADD CONSTRAINT fk_conferencia_cadastral_ans_item_conferencia_cadastral_ans_id FOREIGN KEY (conferencia_cadastral_ans_id) REFERENCES conferencia_cadastral_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_cadastral_ans_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conf_cad_ans_item_movimento_cadastral_beneficiario_id FOREIGN KEY (movimento_cadastral_beneficiario_id) REFERENCES movimento_cadastral_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_cadastral_ans_item_corrigido_por_usuario_id FOREIGN KEY (corrigido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conjunto_criterio_aplicacao
  ADD CONSTRAINT fk_conjunto_criterio_aplicacao_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE consulta_elegibilidade_recebida
  ADD CONSTRAINT fk_consulta_elegibilidade_recebida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_recebida_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_recebida_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_recebida_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_recebida_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cons_eleg_receb_token_atendimento_beneficiario_id FOREIGN KEY (token_atendimento_beneficiario_id) REFERENCES token_atendimento_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_recebida_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_beneficiario
  ADD CONSTRAINT fk_conta_portal_beneficiario_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_beneficiario_consentimento_titular_id FOREIGN KEY (consentimento_titular_id) REFERENCES consentimento_titular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_beneficiario_responsavel_pessoa_fisica_id FOREIGN KEY (responsavel_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_beneficiario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_contratante
  ADD CONSTRAINT fk_conta_portal_contratante_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_contratante_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_contratante_gestor_pessoa_fisica_id FOREIGN KEY (gestor_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_contratante_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_corretor
  ADD CONSTRAINT fk_conta_portal_corretor_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_corretor_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_corretor_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_corretor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_prestador
  ADD CONSTRAINT fk_conta_portal_prestador_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_prestador_operador_pessoa_fisica_id FOREIGN KEY (operador_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_prestador_funcao_portal_prestador_id FOREIGN KEY (funcao_portal_prestador_id) REFERENCES funcao_portal_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_prestador_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contato_contratante_plano
  ADD CONSTRAINT fk_contato_contratante_plano_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT;
ALTER TABLE contestacao_cobranca_intercambio
  ADD CONSTRAINT fk_contestacao_cobranca_intercambio_fatura_intercambio_id FOREIGN KEY (fatura_intercambio_id) REFERENCES fatura_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contestacao_cobranca_intercambio_fatura_intercambio_item_id FOREIGN KEY (fatura_intercambio_item_id) REFERENCES fatura_intercambio_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contestacao_cobranca_intercambio_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contestacao_cobranca_intercambio_decidida_por_usuario_id FOREIGN KEY (decidida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contratante_plano
  ADD CONSTRAINT fk_contratante_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contratante_plano_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contratante_plano_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contratante_plano_grupo_economico_contratante_id FOREIGN KEY (grupo_economico_contratante_id) REFERENCES grupo_economico_contratante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contratante_plano_administradora_contratante_id FOREIGN KEY (administradora_contratante_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT;
ALTER TABLE contrato_forma_cobranca
  ADD CONSTRAINT fk_contrato_forma_cobranca_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_forma_cobranca_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_forma_cobranca_forma_cobranca_plano_id FOREIGN KEY (forma_cobranca_plano_id) REFERENCES forma_cobranca_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_forma_cobranca_carteira_cobranca_id FOREIGN KEY (carteira_cobranca_id) REFERENCES carteira_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_forma_cobranca_preferencia_envio_cobranca_id FOREIGN KEY (preferencia_envio_cobranca_id) REFERENCES preferencia_envio_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE contrato_plano
  ADD CONSTRAINT fk_contrato_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_classificacao_plano_id FOREIGN KEY (classificacao_plano_id) REFERENCES classificacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_modelo_contrato_plano_id FOREIGN KEY (modelo_contrato_plano_id) REFERENCES modelo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_contrato_pai_id FOREIGN KEY (contrato_pai_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_carteira_contrato_plano_id FOREIGN KEY (carteira_contrato_plano_id) REFERENCES carteira_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_canal_venda_plano_id FOREIGN KEY (canal_venda_plano_id) REFERENCES canal_venda_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE contrato_plano_historico
  ADD CONSTRAINT fk_contrato_plano_historico_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_historico_contratante_anterior_id FOREIGN KEY (contratante_anterior_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contrato_plano_observacao
  ADD CONSTRAINT fk_contrato_plano_observacao_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_observacao_tipo_observacao_operadora_id FOREIGN KEY (tipo_observacao_operadora_id) REFERENCES tipo_observacao_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_observacao_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contrato_plano_oferta
  ADD CONSTRAINT fk_contrato_plano_oferta_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_oferta_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_oferta_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_oferta_tabela_preco_aposentado_id FOREIGN KEY (tabela_preco_aposentado_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_oferta_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_oferta_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_oferta_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_plano_oferta_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT;
ALTER TABLE contrato_rede_prestador
  ADD CONSTRAINT fk_contrato_rede_prestador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_tipo_contrato_rede_id FOREIGN KEY (tipo_contrato_rede_id) REFERENCES tipo_contrato_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_regime_atendimento_rede_id FOREIGN KEY (regime_atendimento_rede_id) REFERENCES regime_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_texto_arquivo_id FOREIGN KEY (texto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_rede_prestador_clausula
  ADD CONSTRAINT fk_contrato_rede_prestador_clausula_contrato_rede_prestador_id FOREIGN KEY (contrato_rede_prestador_id) REFERENCES contrato_rede_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_clausula_unidade_prazo_id FOREIGN KEY (unidade_prazo_id) REFERENCES unidade_prazo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_rede_prestador_clausula_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT;
ALTER TABLE contribuicao_previdencia_pessoa
  ADD CONSTRAINT fk_contribuicao_previdencia_pessoa_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contribuicao_previdencia_pessoa_entidade_pessoa_juridica_id FOREIGN KEY (entidade_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contribuicao_previdencia_pessoa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE corretora_venda
  ADD CONSTRAINT fk_corretora_venda_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corretora_venda_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corretora_venda_corretora_pai_id FOREIGN KEY (corretora_pai_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corretora_venda_regra_comissao_venda_id FOREIGN KEY (regra_comissao_venda_id) REFERENCES regra_comissao_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corretora_venda_contrato_arquivo_id FOREIGN KEY (contrato_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
