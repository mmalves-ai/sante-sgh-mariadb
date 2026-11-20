-- INTG, lote 02 (F1.3): chaves estrangeiras, aplicadas depois de todos os tabelas.sql.

ALTER TABLE operacao_ponto_integracao
  ADD CONSTRAINT fk_operacao_ponto_integracao_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_ponto_integracao_tipo_evento_publicado_id FOREIGN KEY (tipo_evento_publicado_id) REFERENCES tipo_evento_publicado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_ponto_integracao_esquema_mensagem_id FOREIGN KEY (esquema_mensagem_id) REFERENCES esquema_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_ponto_integracao_retorno_operacao_ponto_integ_883169 FOREIGN KEY (retorno_operacao_ponto_integracao_id) REFERENCES operacao_ponto_integracao (id) ON DELETE RESTRICT;

ALTER TABLE pacote_parceiro
  ADD CONSTRAINT fk_pacote_parceiro_parceiro_dados_id FOREIGN KEY (parceiro_dados_id) REFERENCES parceiro_dados (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_parceiro_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_parceiro_revisado_por_usuario_id FOREIGN KEY (revisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE pacote_parceiro_campo
  ADD CONSTRAINT fk_pacote_parceiro_campo_pacote_parceiro_id FOREIGN KEY (pacote_parceiro_id) REFERENCES pacote_parceiro (id) ON DELETE RESTRICT;

ALTER TABLE parceiro_dados
  ADD CONSTRAINT fk_parceiro_dados_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parceiro_dados_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parceiro_dados_cliente_api_id FOREIGN KEY (cliente_api_id) REFERENCES cliente_api (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parceiro_dados_contrato_arquivo_id FOREIGN KEY (contrato_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parceiro_dados_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE pedido_mensagem_paciente
  ADD CONSTRAINT fk_pedido_mensagem_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_mensagem_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_mensagem_paciente_modelo_mensagem_paciente_id FOREIGN KEY (modelo_mensagem_paciente_id) REFERENCES modelo_mensagem_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_mensagem_paciente_regra_envio_mensagem_paciente_id FOREIGN KEY (regra_envio_mensagem_paciente_id) REFERENCES regra_envio_mensagem_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_mensagem_paciente_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_mensagem_paciente_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE pedido_mensagem_paciente_retorno
  ADD CONSTRAINT fk_pedido_mensagem_paciente_retorno_pedido_mensagem_paciente_id FOREIGN KEY (pedido_mensagem_paciente_id) REFERENCES pedido_mensagem_paciente (id) ON DELETE RESTRICT;

ALTER TABLE pedido_vinculo_profissional_externo
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_conselho_unidade_f_c7b49d FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_vinculo_profissional_externo_conta_portal_profi_0e361b FOREIGN KEY (conta_portal_profissional_externo_id) REFERENCES conta_portal_profissional_externo (id) ON DELETE RESTRICT;

ALTER TABLE perfil_fhir
  ADD CONSTRAINT fk_perfil_fhir_padrao_troca_id FOREIGN KEY (padrao_troca_id) REFERENCES padrao_troca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_fhir_conjunto_valores_id FOREIGN KEY (conjunto_valores_id) REFERENCES conjunto_valores (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_fhir_definicao_arquivo_id FOREIGN KEY (definicao_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;

ALTER TABLE perfil_mensagem_hl7
  ADD CONSTRAINT fk_perfil_mensagem_hl7_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_mensagem_hl7_evento_hl7_id FOREIGN KEY (evento_hl7_id) REFERENCES evento_hl7 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_mensagem_hl7_canal_hl7_id FOREIGN KEY (canal_hl7_id) REFERENCES canal_hl7 (id) ON DELETE RESTRICT;

ALTER TABLE perfil_mensagem_hl7_campo
  ADD CONSTRAINT fk_perfil_mensagem_hl7_campo_perfil_mensagem_hl7_id FOREIGN KEY (perfil_mensagem_hl7_id) REFERENCES perfil_mensagem_hl7 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_mensagem_hl7_campo_campo_superior_id FOREIGN KEY (campo_superior_id) REFERENCES perfil_mensagem_hl7_campo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_mensagem_hl7_campo_tipo_mapeamento_codigo_id FOREIGN KEY (tipo_mapeamento_codigo_id) REFERENCES tipo_mapeamento_codigo (id) ON DELETE RESTRICT;

ALTER TABLE perfil_prioridade_externa
  ADD CONSTRAINT fk_perfil_prioridade_externa_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT;

ALTER TABLE ponto_integracao
  ADD CONSTRAINT fk_ponto_integracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_integracao_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_integracao_padrao_troca_id FOREIGN KEY (padrao_troca_id) REFERENCES padrao_troca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_integracao_credencial_integracao_id FOREIGN KEY (credencial_integracao_id) REFERENCES credencial_integracao (id) ON DELETE RESTRICT;

ALTER TABLE proposta_escrita_api
  ADD CONSTRAINT fk_proposta_escrita_api_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_escrita_api_cliente_api_id FOREIGN KEY (cliente_api_id) REFERENCES cliente_api (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_escrita_api_decidida_por_usuario_id FOREIGN KEY (decidida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_escrita_api_trilha_auditoria_id FOREIGN KEY (trilha_auditoria_id) REFERENCES trilha_auditoria (id) ON DELETE RESTRICT;

ALTER TABLE provedor_assinatura_formato
  ADD CONSTRAINT fk_provedor_assinatura_formato_provedor_assinatura_nuvem_id FOREIGN KEY (provedor_assinatura_nuvem_id) REFERENCES provedor_assinatura_nuvem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provedor_assinatura_formato_formato_assinatura_icp_id FOREIGN KEY (formato_assinatura_icp_id) REFERENCES formato_assinatura_icp (id) ON DELETE RESTRICT;

ALTER TABLE regiao_anatomica_codificada
  ADD CONSTRAINT fk_regiao_anatomica_codificada_regiao_superior_id FOREIGN KEY (regiao_superior_id) REFERENCES regiao_anatomica_codificada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regiao_anatomica_codificada_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;

ALTER TABLE regra_acesso_dispositivo
  ADD CONSTRAINT fk_regra_acesso_dispositivo_dispositivo_acesso_id FOREIGN KEY (dispositivo_acesso_id) REFERENCES dispositivo_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_acesso_dispositivo_tipo_visitante_id FOREIGN KEY (tipo_visitante_id) REFERENCES tipo_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_acesso_dispositivo_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_acesso_dispositivo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;

ALTER TABLE regra_envio_mensagem_paciente
  ADD CONSTRAINT fk_regra_envio_mensagem_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_envio_mensagem_paciente_modelo_mensagem_paciente_id FOREIGN KEY (modelo_mensagem_paciente_id) REFERENCES modelo_mensagem_paciente (id) ON DELETE RESTRICT;

ALTER TABLE resultado_laboratorio_apoio
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_exame_laboratorio_apoio_id FOREIGN KEY (exame_laboratorio_apoio_id) REFERENCES exame_laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_laudo_arquivo_id FOREIGN KEY (laudo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_conferido_por_profissional_id FOREIGN KEY (conferido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_substituido_resultado_labo_ae4925 FOREIGN KEY (substituido_resultado_laboratorio_apoio_id) REFERENCES resultado_laboratorio_apoio (id) ON DELETE RESTRICT;

ALTER TABLE resultado_laboratorio_apoio_valor
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_valor_resultado_laboratori_7aee5b FOREIGN KEY (resultado_laboratorio_apoio_id) REFERENCES resultado_laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_valor_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_laboratorio_apoio_valor_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;

ALTER TABLE setor_publicado_portal
  ADD CONSTRAINT fk_setor_publicado_portal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_publicado_portal_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_publicado_portal_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_publicado_portal_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;

ALTER TABLE sistema_externo
  ADD CONSTRAINT fk_sistema_externo_fornecedor_pessoa_juridica_id FOREIGN KEY (fornecedor_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sistema_externo_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE tabela_codigo_regulacao
  ADD CONSTRAINT fk_tabela_codigo_regulacao_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_codigo_regulacao_tipo_mapeamento_codigo_id FOREIGN KEY (tipo_mapeamento_codigo_id) REFERENCES tipo_mapeamento_codigo (id) ON DELETE RESTRICT;

ALTER TABLE tabela_referencia_procedimento
  ADD CONSTRAINT fk_tabela_referencia_procedimento_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_referencia_procedimento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;

ALTER TABLE tabela_referencia_procedimento_item
  ADD CONSTRAINT fk_tabela_referencia_procedimento_item_tabela_referencia__f159bd FOREIGN KEY (tabela_referencia_procedimento_id) REFERENCES tabela_referencia_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_referencia_procedimento_item_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_referencia_procedimento_item_porte_procedimento_id FOREIGN KEY (porte_procedimento_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT;

ALTER TABLE tentativa_entrega_mensagem
  ADD CONSTRAINT fk_tentativa_entrega_mensagem_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tentativa_entrega_mensagem_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tentativa_entrega_mensagem_operacao_ponto_integracao_id FOREIGN KEY (operacao_ponto_integracao_id) REFERENCES operacao_ponto_integracao (id) ON DELETE RESTRICT;

ALTER TABLE terminologia
  ADD CONSTRAINT fk_terminologia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_edicao_vigente_terminologia_edicao_id FOREIGN KEY (edicao_vigente_terminologia_edicao_id) REFERENCES terminologia_edicao (id) ON DELETE RESTRICT;

ALTER TABLE terminologia_edicao
  ADD CONSTRAINT fk_terminologia_edicao_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_edicao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_edicao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;

ALTER TABLE termo_atributo
  ADD CONSTRAINT fk_termo_atributo_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_atributo_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_atributo_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_atributo_porte_procedimento_id FOREIGN KEY (porte_procedimento_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT;

ALTER TABLE termo_equivalencia
  ADD CONSTRAINT fk_termo_equivalencia_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_equivalencia_equivalente_termo_terminologia_id FOREIGN KEY (equivalente_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;

ALTER TABLE termo_relacao
  ADD CONSTRAINT fk_termo_relacao_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_relacao_relacionado_termo_terminologia_id FOREIGN KEY (relacionado_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;

ALTER TABLE termo_terminologia
  ADD CONSTRAINT fk_termo_terminologia_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_termo_superior_id FOREIGN KEY (termo_superior_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_terminologia_edicao_id FOREIGN KEY (terminologia_edicao_id) REFERENCES terminologia_edicao (id) ON DELETE RESTRICT;

ALTER TABLE termo_terminologia_vigencia
  ADD CONSTRAINT fk_termo_terminologia_vigencia_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_vigencia_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_vigencia_terminologia_edicao_id FOREIGN KEY (terminologia_edicao_id) REFERENCES terminologia_edicao (id) ON DELETE RESTRICT;

ALTER TABLE tipo_evento_publicado
  ADD CONSTRAINT fk_tipo_evento_publicado_esquema_mensagem_id FOREIGN KEY (esquema_mensagem_id) REFERENCES esquema_mensagem (id) ON DELETE RESTRICT;

ALTER TABLE transacao_tiss_webservice
  ADD CONSTRAINT fk_transacao_tiss_webservice_esquema_mensagem_id FOREIGN KEY (esquema_mensagem_id) REFERENCES esquema_mensagem (id) ON DELETE RESTRICT;

ALTER TABLE troca_tiss_prestador
  ADD CONSTRAINT fk_troca_tiss_prestador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_transacao_tiss_webservice_id FOREIGN KEY (transacao_tiss_webservice_id) REFERENCES transacao_tiss_webservice (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_endpoint_tiss_fonte_pagadora_id FOREIGN KEY (endpoint_tiss_fonte_pagadora_id) REFERENCES endpoint_tiss_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_envio_arquivo_id FOREIGN KEY (envio_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_prestador_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;

ALTER TABLE valor_codigo_regulacao
  ADD CONSTRAINT fk_valor_codigo_regulacao_tabela_codigo_regulacao_id FOREIGN KEY (tabela_codigo_regulacao_id) REFERENCES tabela_codigo_regulacao (id) ON DELETE RESTRICT;

ALTER TABLE vinculo_pedido_compra_portal
  ADD CONSTRAINT fk_vinculo_pedido_compra_portal_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_pedido_compra_portal_portal_cotacao_id FOREIGN KEY (portal_cotacao_id) REFERENCES portal_cotacao (id) ON DELETE RESTRICT;
