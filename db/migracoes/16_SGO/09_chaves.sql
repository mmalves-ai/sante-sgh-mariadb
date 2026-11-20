-- 16_SGO lote 09: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE restricao_cobertura_plano
  ADD CONSTRAINT fk_restricao_cobertura_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT;
ALTER TABLE restricao_cobertura_plano_item
  ADD CONSTRAINT fk_restricao_cobertura_plano_item_restricao_cobertura_plano_id FOREIGN KEY (restricao_cobertura_plano_id) REFERENCES restricao_cobertura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_item_procedimento_termo_te_f5a388c7 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_item_grupo_procedimento_op_aa0c280a FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_plano_item_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE restricao_prestador_rede
  ADD CONSTRAINT fk_restricao_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prestador_rede_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prestador_rede_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prestador_rede_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prestador_rede_rede_assistencial_id FOREIGN KEY (rede_assistencial_id) REFERENCES rede_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prestador_rede_segmentacao_assistencial_id FOREIGN KEY (segmentacao_assistencial_id) REFERENCES segmentacao_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prestador_rede_procedimento_termo_terminologia_id FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prestador_rede_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE reversao_reajuste_contrato
  ADD CONSTRAINT fk_reversao_reajuste_contrato_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reversao_reajuste_contrato_reajuste_contrato_plano_id FOREIGN KEY (reajuste_contrato_plano_id) REFERENCES reajuste_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reversao_reajuste_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reversao_reajuste_contrato_aplicada_por_usuario_id FOREIGN KEY (aplicada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE rol_procedimento_ans
  ADD CONSTRAINT fk_rol_procedimento_ans_procedimento_termo_terminologia_id FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rol_procedimento_ans_diretriz_utilizacao_ans_id FOREIGN KEY (diretriz_utilizacao_ans_id) REFERENCES diretriz_utilizacao_ans (id) ON DELETE RESTRICT;
ALTER TABLE saldo_utilizacao_beneficiario
  ADD CONSTRAINT fk_saldo_utilizacao_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_utilizacao_beneficiario_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_utilizacao_beneficiario_limite_utilizacao_periodo_id FOREIGN KEY (limite_utilizacao_periodo_id) REFERENCES limite_utilizacao_periodo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_utilizacao_beneficiario_teto_coparticipacao_id FOREIGN KEY (teto_coparticipacao_id) REFERENCES teto_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_utilizacao_beneficiario_procedimento_termo_ter_a52d44d3 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_utilizacao_beneficiario_ultimo_pedido_autoriza_139b7b78 FOREIGN KEY (ultimo_pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_utilizacao_beneficiario_ultima_guia_conta_recebida_id FOREIGN KEY (ultima_guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT;
ALTER TABLE servico_adicional_contrato
  ADD CONSTRAINT fk_servico_adicional_contrato_servico_adicional_plano_id FOREIGN KEY (servico_adicional_plano_id) REFERENCES servico_adicional_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_responsavel_cobranca_cont_d5829e4b FOREIGN KEY (responsavel_cobranca_contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_contrato_motivo_movimento_cadastral_id FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT;
ALTER TABLE servico_adicional_plano
  ADD CONSTRAINT fk_servico_adicional_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_plano_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_adicional_plano_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT;
ALTER TABLE servico_atendimento_operadora
  ADD CONSTRAINT fk_servico_atendimento_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_atendimento_operadora_departamento_operadora_id FOREIGN KEY (departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_atendimento_operadora_gravidade_protocolo_be_20912896 FOREIGN KEY (gravidade_protocolo_beneficiario_id) REFERENCES gravidade_protocolo_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE servico_prestado_rede
  ADD CONSTRAINT fk_servico_prestado_rede_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_prestado_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_prestado_rede_procedimento_termo_terminologia_id FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_prestado_rede_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_prestado_rede_terceiro_pessoa_juridica_id FOREIGN KEY (terceiro_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE simulacao_preco_item
  ADD CONSTRAINT fk_simulacao_preco_item_simulacao_preco_plano_id FOREIGN KEY (simulacao_preco_plano_id) REFERENCES simulacao_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_preco_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_preco_item_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_preco_item_tabela_preco_plano_faixa_id FOREIGN KEY (tabela_preco_plano_faixa_id) REFERENCES tabela_preco_plano_faixa (id) ON DELETE RESTRICT;
ALTER TABLE simulacao_preco_plano
  ADD CONSTRAINT fk_simulacao_preco_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_preco_plano_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_preco_plano_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_preco_plano_proposta_adesao_id FOREIGN KEY (proposta_adesao_id) REFERENCES proposta_adesao (id) ON DELETE RESTRICT;
ALTER TABLE situacao_dentaria_beneficiario
  ADD CONSTRAINT fk_situacao_dentaria_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_dentaria_beneficiario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_dentaria_beneficiario_regiao_anatomica_codificada_id FOREIGN KEY (regiao_anatomica_codificada_id) REFERENCES regiao_anatomica_codificada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_dentaria_beneficiario_procedimento_termo_te_707f8ea9 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_dentaria_beneficiario_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_dentaria_beneficiario_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_situacao_dentaria_beneficiario_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_cartao_beneficiario
  ADD CONSTRAINT fk_solicitacao_cartao_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cartao_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cartao_beneficiario_motivo_solicitacao_cartao_id FOREIGN KEY (motivo_solicitacao_cartao_id) REFERENCES motivo_solicitacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cartao_beneficiario_situacao_solicitacao_108cb8fd FOREIGN KEY (situacao_solicitacao_cartao_id) REFERENCES situacao_solicitacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cartao_beneficiario_lote_emissao_cartao_id FOREIGN KEY (lote_emissao_cartao_id) REFERENCES lote_emissao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cartao_beneficiario_cartao_beneficiario_id FOREIGN KEY (cartao_beneficiario_id) REFERENCES cartao_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_portal_beneficiario
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_conta_portal_beneficiario_id FOREIGN KEY (conta_portal_beneficiario_id) REFERENCES conta_portal_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_conta_portal_contratante_id FOREIGN KEY (conta_portal_contratante_id) REFERENCES conta_portal_contratante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_subdivisao_contrato_plano_id FOREIGN KEY (subdivisao_contrato_plano_id) REFERENCES subdivisao_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_titular_beneficiario_plano_id FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_grau_parentesco_dependente_id FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_motivo_movimento_cadastral_id FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_solicitacao_cartao_b_c3e0706c FOREIGN KEY (solicitacao_cartao_beneficiario_id) REFERENCES solicitacao_cartao_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_portal_beneficiario_analisado_por_usuario_id FOREIGN KEY (analisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE subdivisao_contrato_plano
  ADD CONSTRAINT fk_subdivisao_contrato_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_subdivisao_contrato_plano_superior_subdivisao_contra_22618003 FOREIGN KEY (superior_subdivisao_contrato_plano_id) REFERENCES subdivisao_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_subdivisao_contrato_plano_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_subdivisao_contrato_plano_motivo_cancelamento_contrato_id FOREIGN KEY (motivo_cancelamento_contrato_id) REFERENCES motivo_cancelamento_contrato (id) ON DELETE RESTRICT;
ALTER TABLE suspensao_atendimento_beneficiario
  ADD CONSTRAINT fk_suspensao_atendimento_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_atendimento_beneficiario_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_atendimento_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_atendimento_beneficiario_regra_suspensao_a_14e3047b FOREIGN KEY (regra_suspensao_atendimento_id) REFERENCES regra_suspensao_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_atendimento_beneficiario_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_atendimento_beneficiario_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_atendimento_beneficiario_reativado_por_usuario_id FOREIGN KEY (reativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE suspensao_operadora_congenere
  ADD CONSTRAINT fk_suspensao_operadora_congenere_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_operadora_congenere_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE suspensao_prestador_rede
  ADD CONSTRAINT fk_suspensao_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_prestador_rede_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspensao_prestador_rede_descredenciamento_prestador_id FOREIGN KEY (descredenciamento_prestador_id) REFERENCES descredenciamento_prestador (id) ON DELETE RESTRICT;
ALTER TABLE tabela_preco_contrato
  ADD CONSTRAINT fk_tabela_preco_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_aposentado_tabela_preco_plano_id FOREIGN KEY (aposentado_tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_faixa_vidas_modelo_id FOREIGN KEY (faixa_vidas_modelo_id) REFERENCES faixa_vidas_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT;
ALTER TABLE tabela_preco_plano
  ADD CONSTRAINT fk_tabela_preco_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_plano_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_plano_faixa_vidas_modelo_id FOREIGN KEY (faixa_vidas_modelo_id) REFERENCES faixa_vidas_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_plano_exclusiva_contrato_plano_id FOREIGN KEY (exclusiva_contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE tabela_preco_plano_faixa
  ADD CONSTRAINT fk_tabela_preco_plano_faixa_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_plano_faixa_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_plano_faixa_faixa_etaria_modelo_item_id FOREIGN KEY (faixa_etaria_modelo_item_id) REFERENCES faixa_etaria_modelo_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_plano_faixa_grau_parentesco_dependente_id FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_plano_faixa_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT;
ALTER TABLE tabela_reembolso_referencia
  ADD CONSTRAINT fk_tabela_reembolso_referencia_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_reembolso_referencia_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_reembolso_referencia_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_reembolso_referencia_modalidade_reembolso_id FOREIGN KEY (modalidade_reembolso_id) REFERENCES modalidade_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_reembolso_referencia_base_tabela_remuneracao_rede_id FOREIGN KEY (base_tabela_remuneracao_rede_id) REFERENCES tabela_remuneracao_rede (id) ON DELETE RESTRICT;
ALTER TABLE tabela_reembolso_referencia_item
  ADD CONSTRAINT fk_tabela_reembolso_referencia_item_tabela_reembolso_re_028dd1ef FOREIGN KEY (tabela_reembolso_referencia_id) REFERENCES tabela_reembolso_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_reembolso_referencia_item_procedimento_termo__6a52c2cc FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE tabela_remuneracao_rede
  ADD CONSTRAINT fk_tabela_remuneracao_rede_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE tabela_remuneracao_rede_item
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_tabela_remuneracao_rede_id FOREIGN KEY (tabela_remuneracao_rede_id) REFERENCES tabela_remuneracao_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_procedimento_termo_term_73b9a361 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_remuneracao_rede_item_porte_procedimento_id FOREIGN KEY (porte_procedimento_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE taxa_administrativa_contrato
  ADD CONSTRAINT fk_taxa_administrativa_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE taxa_administrativa_contrato_procedimento
  ADD CONSTRAINT fk_taxa_administrativa_contrato_procedimento_taxa_admin_9111d942 FOREIGN KEY (taxa_administrativa_contrato_id) REFERENCES taxa_administrativa_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_administrativa_contrato_procedimento_procedimen_f7b9f680 FOREIGN KEY (procedimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_administrativa_contrato_procedimento_grupo_proc_a46cb0e5 FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_administrativa_contrato_procedimento_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT;
ALTER TABLE taxa_prestador_rede
  ADD CONSTRAINT fk_taxa_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_prestador_rede_inativada_por_usuario_id FOREIGN KEY (inativada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE teto_coparticipacao
  ADD CONSTRAINT fk_teto_coparticipacao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_coparticipacao_regra_coparticipacao_id FOREIGN KEY (regra_coparticipacao_id) REFERENCES regra_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_coparticipacao_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_coparticipacao_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_coparticipacao_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_coparticipacao_agrupamento_procedimento_id FOREIGN KEY (agrupamento_procedimento_id) REFERENCES agrupamento_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_coparticipacao_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT;
ALTER TABLE tipo_acomodacao_plano
  ADD CONSTRAINT fk_tipo_acomodacao_plano_caracteristica_leito_id FOREIGN KEY (caracteristica_leito_id) REFERENCES caracteristica_leito (id) ON DELETE RESTRICT;
ALTER TABLE tipo_etiqueta_autorizacao
  ADD CONSTRAINT fk_tipo_etiqueta_autorizacao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_etiqueta_autorizacao_exigida_tipo_prestador_rede_id FOREIGN KEY (exigida_tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT;
