-- Chaves do módulo SGO, lote 07 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE pedido_web_prestador
  ADD CONSTRAINT fk_pedido_web_prestador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_conta_portal_prestador_id FOREIGN KEY (conta_portal_prestador_id) REFERENCES conta_portal_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_conselho_unidade_federativa_id FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_web_prestador_analisado_por_usuario_id FOREIGN KEY (analisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_reajuste_contrato
  ADD CONSTRAINT fk_pendencia_reajuste_contrato_reajuste_contrato_plano_id FOREIGN KEY (reajuste_contrato_plano_id) REFERENCES reajuste_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_reajuste_contrato_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_reajuste_contrato_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pensao_prestador_rede
  ADD CONSTRAINT fk_pensao_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pensao_prestador_rede_favorecido_empresa_fornecedora_id FOREIGN KEY (favorecido_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pensao_prestador_rede_favorecido_pessoa_fisica_id FOREIGN KEY (favorecido_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pensao_prestador_rede_favorecido_conta_bancaria_credor_id FOREIGN KEY (favorecido_conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT;
ALTER TABLE percentual_funcao_equipe_rede
  ADD CONSTRAINT fk_percentual_funcao_equipe_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_percentual_funcao_equipe_rede_encerrado_por_usuario_id FOREIGN KEY (encerrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE permissao_portal_prestador
  ADD CONSTRAINT fk_permissao_portal_prestador_conta_portal_prestador_id FOREIGN KEY (conta_portal_prestador_id) REFERENCES conta_portal_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_portal_prestador_funcao_portal_prestador_id FOREIGN KEY (funcao_portal_prestador_id) REFERENCES funcao_portal_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_portal_prestador_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT;
ALTER TABLE plano_comercializado
  ADD CONSTRAINT fk_plano_comercializado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_classificacao_plano_id FOREIGN KEY (classificacao_plano_id) REFERENCES classificacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_rede_assistencial_id FOREIGN KEY (rede_assistencial_id) REFERENCES rede_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_regra_coparticipacao_id FOREIGN KEY (regra_coparticipacao_id) REFERENCES regra_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_comercializado_produto_intercambio_id FOREIGN KEY (produto_intercambio_id) REFERENCES produto_intercambio (id) ON DELETE RESTRICT;
ALTER TABLE plano_contas_padrao_ans
  ADD CONSTRAINT fk_plano_contas_padrao_ans_superior_plano_contas_padrao_ans_id FOREIGN KEY (superior_plano_contas_padrao_ans_id) REFERENCES plano_contas_padrao_ans (id) ON DELETE RESTRICT;
ALTER TABLE plano_grau_dependencia
  ADD CONSTRAINT fk_plano_grau_dependencia_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_grau_dependencia_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_grau_dependencia_grau_parentesco_dependente_id FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT;
ALTER TABLE portabilidade_carencia
  ADD CONSTRAINT fk_portabilidade_carencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portabilidade_carencia_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portabilidade_carencia_proposta_adesao_beneficiario_id FOREIGN KEY (proposta_adesao_beneficiario_id) REFERENCES proposta_adesao_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portabilidade_carencia_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_portabilidade_carencia_analisado_por_usuario_id FOREIGN KEY (analisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE prazo_atendimento_regulatorio
  ADD CONSTRAINT fk_prazo_atendimento_regulatorio_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_regulatorio_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_regulatorio_gravidade_protocolo_beneficiari FOREIGN KEY (gravidade_protocolo_beneficiario_id) REFERENCES gravidade_protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_regulatorio_norma_regulatoria_id FOREIGN KEY (norma_regulatoria_id) REFERENCES norma_regulatoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_atendimento_regulatorio_unidade_prazo_id FOREIGN KEY (unidade_prazo_id) REFERENCES unidade_prazo (id) ON DELETE RESTRICT;
ALTER TABLE prestador_rede
  ADD CONSTRAINT fk_prestador_rede_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_conselho_unidade_federativa_id FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_natureza_prestador_rede_id FOREIGN KEY (natureza_prestador_rede_id) REFERENCES natureza_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_agrupamento_prestador_rede_id FOREIGN KEY (agrupamento_prestador_rede_id) REFERENCES agrupamento_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_regime_atendimento_rede_id FOREIGN KEY (regime_atendimento_rede_id) REFERENCES regime_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_proprio_estabelecimento_id FOREIGN KEY (proprio_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT;
ALTER TABLE prestador_rede_historico
  ADD CONSTRAINT fk_prestador_rede_historico_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_historico_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prestador_rede_historico_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_unidade_conversao
  ADD CONSTRAINT fk_procedimento_unidade_conversao_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_unidade_conversao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE produto_intercambio
  ADD CONSTRAINT fk_produto_intercambio_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_intercambio_classificacao_plano_id FOREIGN KEY (classificacao_plano_id) REFERENCES classificacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_intercambio_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_intercambio_regra_coparticipacao_id FOREIGN KEY (regra_coparticipacao_id) REFERENCES regra_coparticipacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_intercambio_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_intercambio_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT;
ALTER TABLE produto_plano
  ADD CONSTRAINT fk_produto_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_plano_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT;
ALTER TABLE produto_plano_historico
  ADD CONSTRAINT fk_produto_plano_historico_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_plano_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE produto_plano_segmentacao
  ADD CONSTRAINT fk_produto_plano_segmentacao_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_produto_plano_segmentacao_segmentacao_assistencial_id FOREIGN KEY (segmentacao_assistencial_id) REFERENCES segmentacao_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE programa_saude
  ADD CONSTRAINT fk_programa_saude_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_grupo_risco_saude_id FOREIGN KEY (grupo_risco_saude_id) REFERENCES grupo_risco_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_coordenador_prestador_rede_id FOREIGN KEY (coordenador_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE programa_saude_equipe
  ADD CONSTRAINT fk_programa_saude_equipe_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_equipe_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_equipe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_equipe_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE programa_saude_plano
  ADD CONSTRAINT fk_programa_saude_plano_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_plano_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE programa_saude_procedimento
  ADD CONSTRAINT fk_programa_saude_procedimento_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_procedimento_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_procedimento_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_saude_procedimento_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE proposta_adesao
  ADD CONSTRAINT fk_proposta_adesao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_responsavel_pessoa_fisica_id FOREIGN KEY (responsavel_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_gerado_contrato_plano_id FOREIGN KEY (gerado_contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_canal_venda_plano_id FOREIGN KEY (canal_venda_plano_id) REFERENCES canal_venda_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_situacao_por_usuario_id FOREIGN KEY (situacao_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE proposta_adesao_beneficiario
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_proposta_adesao_id FOREIGN KEY (proposta_adesao_id) REFERENCES proposta_adesao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_titular_proposta_adesao_benefici FOREIGN KEY (titular_proposta_adesao_beneficiario_id) REFERENCES proposta_adesao_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_grau_parentesco_dependente_id FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_estado_civil_id FOREIGN KEY (estado_civil_id) REFERENCES estado_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_orgao_emissor_documento_id FOREIGN KEY (orgao_emissor_documento_id) REFERENCES orgao_emissor_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_adesao_beneficiario_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT;
ALTER TABLE prorrogacao_internacao_plano
  ADD CONSTRAINT fk_prorrogacao_internacao_plano_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prorrogacao_internacao_plano_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prorrogacao_internacao_plano_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prorrogacao_internacao_plano_motivo_decisao_autorizacao_id FOREIGN KEY (motivo_decisao_autorizacao_id) REFERENCES motivo_decisao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prorrogacao_internacao_plano_motivo_cancelamento_guia_plano_i FOREIGN KEY (motivo_cancelamento_guia_plano_id) REFERENCES motivo_cancelamento_guia_plano (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_beneficiario
  ADD CONSTRAINT fk_protocolo_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_origem_protocolo_id FOREIGN KEY (origem_protocolo_id) REFERENCES origem_protocolo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_vinculo_solicitante_protocolo_id FOREIGN KEY (vinculo_solicitante_protocolo_id) REFERENCES vinculo_solicitante_protocolo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_motivo_contato_beneficiario_id FOREIGN KEY (motivo_contato_beneficiario_id) REFERENCES motivo_contato_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_servico_atendimento_operadora_id FOREIGN KEY (servico_atendimento_operadora_id) REFERENCES servico_atendimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_departamento_operadora_id FOREIGN KEY (departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_gravidade_protocolo_beneficiario_id FOREIGN KEY (gravidade_protocolo_beneficiario_id) REFERENCES gravidade_protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_etapa_protocolo_beneficiario_id FOREIGN KEY (etapa_protocolo_beneficiario_id) REFERENCES etapa_protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_modelo_protocolo_atendimento_id FOREIGN KEY (modelo_protocolo_atendimento_id) REFERENCES modelo_protocolo_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_prazo_atendimento_regulatorio_id FOREIGN KEY (prazo_atendimento_regulatorio_id) REFERENCES prazo_atendimento_regulatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_solicitacao_portal_beneficiario_id FOREIGN KEY (solicitacao_portal_beneficiario_id) REFERENCES solicitacao_portal_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_atendente_usuario_id FOREIGN KEY (atendente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_beneficiario_andamento
  ADD CONSTRAINT fk_protocolo_beneficiario_andamento_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_andamento_etapa_protocolo_beneficiario FOREIGN KEY (etapa_protocolo_beneficiario_id) REFERENCES etapa_protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_andamento_departamento_operadora_id FOREIGN KEY (departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_andamento_servico_atendimento_operador FOREIGN KEY (servico_atendimento_operadora_id) REFERENCES servico_atendimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_andamento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_beneficiario_resposta
  ADD CONSTRAINT fk_protocolo_beneficiario_resposta_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_resposta_respondido_por_usuario_id FOREIGN KEY (respondido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_resposta_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_beneficiario_servico
  ADD CONSTRAINT fk_protocolo_beneficiario_servico_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_protocolo_beneficiario_servico_servico_atendimento_operadora_ FOREIGN KEY (servico_atendimento_operadora_id) REFERENCES servico_atendimento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE provisao_tecnica_base_evento
  ADD CONSTRAINT fk_provisao_tecnica_base_evento_provisao_tecnica_competencia_id FOREIGN KEY (provisao_tecnica_competencia_id) REFERENCES provisao_tecnica_competencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_tecnica_base_evento_classe_despesa_assistencial_id FOREIGN KEY (classe_despesa_assistencial_id) REFERENCES classe_despesa_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_tecnica_base_evento_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT;
ALTER TABLE provisao_tecnica_competencia
  ADD CONSTRAINT fk_provisao_tecnica_competencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_tecnica_competencia_calculado_por_usuario_id FOREIGN KEY (calculado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_tecnica_competencia_lote_exportacao_contabil_id FOREIGN KEY (lote_exportacao_contabil_id) REFERENCES lote_exportacao_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_tecnica_competencia_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE provisao_tecnica_item
  ADD CONSTRAINT fk_provisao_tecnica_item_provisao_tecnica_competencia_id FOREIGN KEY (provisao_tecnica_competencia_id) REFERENCES provisao_tecnica_competencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_tecnica_item_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_tecnica_item_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE quadro_economico_ans
  ADD CONSTRAINT fk_quadro_economico_ans_pagina_quadro_economico_ans_id FOREIGN KEY (pagina_quadro_economico_ans_id) REFERENCES quadro_economico_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_economico_ans_linha_quadro_economico_ans_id FOREIGN KEY (linha_quadro_economico_ans_id) REFERENCES quadro_economico_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_economico_ans_coluna_quadro_economico_ans_id FOREIGN KEY (coluna_quadro_economico_ans_id) REFERENCES quadro_economico_ans (id) ON DELETE RESTRICT;
ALTER TABLE quadro_economico_ans_conta
  ADD CONSTRAINT fk_quadro_economico_ans_conta_quadro_economico_ans_id FOREIGN KEY (quadro_economico_ans_id) REFERENCES quadro_economico_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_economico_ans_conta_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE qualificacao_prestador_rede
  ADD CONSTRAINT fk_qualificacao_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qualificacao_prestador_rede_atributo_qualificacao_rede_id FOREIGN KEY (atributo_qualificacao_rede_id) REFERENCES atributo_qualificacao_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qualificacao_prestador_rede_orgao_certificador_id FOREIGN KEY (orgao_certificador_id) REFERENCES orgao_certificador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qualificacao_prestador_rede_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE reajuste_contrato_plano
  ADD CONSTRAINT fk_reajuste_contrato_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_agrupamento_reajuste_coletivo_id FOREIGN KEY (agrupamento_reajuste_coletivo_id) REFERENCES agrupamento_reajuste_coletivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_aplicado_por_usuario_id FOREIGN KEY (aplicado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_estornado_por_usuario_id FOREIGN KEY (estornado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reajuste_contrato_plano_item
  ADD CONSTRAINT fk_reajuste_contrato_plano_item_reajuste_contrato_plano_id FOREIGN KEY (reajuste_contrato_plano_id) REFERENCES reajuste_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_item_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_item_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_plano_item_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE reajuste_contrato_rede
  ADD CONSTRAINT fk_reajuste_contrato_rede_contrato_rede_prestador_id FOREIGN KEY (contrato_rede_prestador_id) REFERENCES contrato_rede_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_rede_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_rede_tabela_remuneracao_rede_id FOREIGN KEY (tabela_remuneracao_rede_id) REFERENCES tabela_remuneracao_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_rede_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reajuste_contrato_rede_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT;
ALTER TABLE reciprocidade_beneficiario
  ADD CONSTRAINT fk_reciprocidade_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_beneficiario_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_beneficiario_produto_intercambio_id FOREIGN KEY (produto_intercambio_id) REFERENCES produto_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_beneficiario_titular_reciprocidade_beneficiario FOREIGN KEY (titular_reciprocidade_beneficiario_id) REFERENCES reciprocidade_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_beneficiario_grau_parentesco_dependente_id FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_beneficiario_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_beneficiario_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE reciprocidade_movimento
  ADD CONSTRAINT fk_reciprocidade_movimento_reciprocidade_beneficiario_id FOREIGN KEY (reciprocidade_beneficiario_id) REFERENCES reciprocidade_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_movimento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_movimento_motivo_movimento_cadastral_id FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reciprocidade_movimento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE recurso_glosa_recebido
  ADD CONSTRAINT fk_recurso_glosa_recebido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_analista_usuario_id FOREIGN KEY (analista_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE recurso_glosa_recebido_item
  ADD CONSTRAINT fk_recurso_glosa_recebido_item_recurso_glosa_recebido_id FOREIGN KEY (recurso_glosa_recebido_id) REFERENCES recurso_glosa_recebido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_item_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_item_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_item_glosa_conta_recebida_id FOREIGN KEY (glosa_conta_recebida_id) REFERENCES glosa_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_recebido_item_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE rede_assistencial
  ADD CONSTRAINT fk_rede_assistencial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE rede_assistencial_local
  ADD CONSTRAINT fk_rede_assistencial_local_rede_assistencial_id FOREIGN KEY (rede_assistencial_id) REFERENCES rede_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rede_assistencial_local_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rede_assistencial_local_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rede_assistencial_local_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT;
