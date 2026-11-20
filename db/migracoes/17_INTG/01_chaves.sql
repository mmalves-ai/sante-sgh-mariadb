-- Chaves do módulo INTG, lote 01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acesso_resultado_portal
  ADD CONSTRAINT fk_acesso_resultado_portal_liberacao_resultado_portal_id FOREIGN KEY (liberacao_resultado_portal_id) REFERENCES liberacao_resultado_portal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_resultado_portal_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_resultado_portal_conta_portal_paciente_id FOREIGN KEY (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_resultado_portal_conta_portal_profissional_externo_id FOREIGN KEY (conta_portal_profissional_externo_id) REFERENCES conta_portal_profissional_externo (id) ON DELETE RESTRICT;
ALTER TABLE agrupamento_cid10
  ADD CONSTRAINT fk_agrupamento_cid10_capitulo_cid10_id FOREIGN KEY (capitulo_cid10_id) REFERENCES capitulo_cid10 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupamento_cid10_pai_agrupamento_cid10_id FOREIGN KEY (pai_agrupamento_cid10_id) REFERENCES agrupamento_cid10 (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_evento_parceiro
  ADD CONSTRAINT fk_assinatura_evento_parceiro_parceiro_dados_id FOREIGN KEY (parceiro_dados_id) REFERENCES parceiro_dados (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_evento_parceiro_tipo_evento_publicado_id FOREIGN KEY (tipo_evento_publicado_id) REFERENCES tipo_evento_publicado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_evento_parceiro_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_evento_parceiro_finalidade_compartilhamento_id FOREIGN KEY (finalidade_compartilhamento_id) REFERENCES finalidade_compartilhamento (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_assinatura_nuvem
  ADD CONSTRAINT fk_autorizacao_assinatura_nuvem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_assinatura_nuvem_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_assinatura_nuvem_provedor_assinatura_nuvem_id FOREIGN KEY (provedor_assinatura_nuvem_id) REFERENCES provedor_assinatura_nuvem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_assinatura_nuvem_formato_assinatura_icp_id FOREIGN KEY (formato_assinatura_icp_id) REFERENCES formato_assinatura_icp (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_assinatura_nuvem_revogada_por_usuario_id FOREIGN KEY (revogada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE canal_hl7
  ADD CONSTRAINT fk_canal_hl7_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_canal_hl7_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_canal_hl7_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_canal_hl7_credencial_integracao_id FOREIGN KEY (credencial_integracao_id) REFERENCES credencial_integracao (id) ON DELETE RESTRICT;
ALTER TABLE chave_api
  ADD CONSTRAINT fk_chave_api_cliente_api_id FOREIGN KEY (cliente_api_id) REFERENCES cliente_api (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chave_api_revogada_por_usuario_id FOREIGN KEY (revogada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_externa_recebida
  ADD CONSTRAINT fk_classificacao_externa_recebida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_externa_recebida_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_externa_recebida_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_externa_recebida_mensagem_integracao_entrada_id FOREIGN KEY (mensagem_integracao_entrada_id) REFERENCES mensagem_integracao_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_externa_recebida_perfil_prioridade_externa_id FOREIGN KEY (perfil_prioridade_externa_id) REFERENCES perfil_prioridade_externa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_externa_recebida_classificacao_risco_id FOREIGN KEY (classificacao_risco_id) REFERENCES classificacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_classificacao_externa_recebida_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE cliente_api
  ADD CONSTRAINT fk_cliente_api_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cliente_api_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cliente_api_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cliente_api_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conjunto_valores
  ADD CONSTRAINT fk_conjunto_valores_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conjunto_valores_perfil_fhir_id FOREIGN KEY (perfil_fhir_id) REFERENCES perfil_fhir (id) ON DELETE RESTRICT;
ALTER TABLE conjunto_valores_termo
  ADD CONSTRAINT fk_conjunto_valores_termo_conjunto_valores_id FOREIGN KEY (conjunto_valores_id) REFERENCES conjunto_valores (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conjunto_valores_termo_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_paciente
  ADD CONSTRAINT fk_conta_portal_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_paciente_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_paciente_termo_uso_versao_id FOREIGN KEY (termo_uso_versao_id) REFERENCES termo_uso_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_paciente_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_paciente_dependente
  ADD CONSTRAINT fk_conta_portal_paciente_dependente_conta_portal_paciente_id FOREIGN KEY (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_paciente_dependente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_paciente_dependente_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_paciente_dependente_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_paciente_dependente_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_portal_profissional_externo
  ADD CONSTRAINT fk_conta_portal_profissional_externo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_profissional_externo_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_profissional_externo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_profissional_externo_pedido_vinculo_profissional FOREIGN KEY (pedido_vinculo_profissional_externo_id) REFERENCES pedido_vinculo_profissional_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_profissional_externo_termo_uso_versao_id FOREIGN KEY (termo_uso_versao_id) REFERENCES termo_uso_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_portal_profissional_externo_autorizada_por_usuario_id FOREIGN KEY (autorizada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE credencial_fonte_pagadora
  ADD CONSTRAINT fk_credencial_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credencial_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credencial_fonte_pagadora_credencial_integracao_id FOREIGN KEY (credencial_integracao_id) REFERENCES credencial_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credencial_fonte_pagadora_codigo_prestador_fonte_pagadora_id FOREIGN KEY (codigo_prestador_fonte_pagadora_id) REFERENCES codigo_prestador_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE credencial_integracao
  ADD CONSTRAINT fk_credencial_integracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credencial_integracao_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credencial_integracao_substituta_credencial_integracao_id FOREIGN KEY (substituta_credencial_integracao_id) REFERENCES credencial_integracao (id) ON DELETE RESTRICT;
ALTER TABLE destinatario_falha_integracao
  ADD CONSTRAINT fk_destinatario_falha_integracao_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_destinatario_falha_integracao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_destinatario_falha_integracao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_destinatario_falha_integracao_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT;
ALTER TABLE dispositivo_acesso
  ADD CONSTRAINT fk_dispositivo_acesso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_acesso_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_acesso_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_acesso_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispositivo_acesso_credencial_integracao_id FOREIGN KEY (credencial_integracao_id) REFERENCES credencial_integracao (id) ON DELETE RESTRICT;
ALTER TABLE elemento_exame_laboratorio_apoio
  ADD CONSTRAINT fk_elemento_exame_laboratorio_apoio_exame_laboratorio_apoio_id FOREIGN KEY (exame_laboratorio_apoio_id) REFERENCES exame_laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_elemento_exame_laboratorio_apoio_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_elemento_exame_laboratorio_apoio_material_laboratorio_apoio_i FOREIGN KEY (material_laboratorio_apoio_id) REFERENCES material_laboratorio_apoio (id) ON DELETE RESTRICT;
ALTER TABLE entrega_pacote_parceiro
  ADD CONSTRAINT fk_entrega_pacote_parceiro_pacote_parceiro_id FOREIGN KEY (pacote_parceiro_id) REFERENCES pacote_parceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_pacote_parceiro_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_pacote_parceiro_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_pacote_parceiro_mensagem_integracao_saida_id FOREIGN KEY (mensagem_integracao_saida_id) REFERENCES mensagem_integracao_saida (id) ON DELETE RESTRICT;
ALTER TABLE envio_prescricao_plataforma
  ADD CONSTRAINT fk_envio_prescricao_plataforma_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_receita_medica_id FOREIGN KEY (receita_medica_id) REFERENCES receita_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_assinatura_documento_id FOREIGN KEY (assinatura_documento_id) REFERENCES assinatura_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_prescricao_plataforma_mensagem_integracao_saida_id FOREIGN KEY (mensagem_integracao_saida_id) REFERENCES mensagem_integracao_saida (id) ON DELETE RESTRICT;
ALTER TABLE envio_rnds
  ADD CONSTRAINT fk_envio_rnds_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_perfil_fhir_id FOREIGN KEY (perfil_fhir_id) REFERENCES perfil_fhir (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_vacina_aplicada_id FOREIGN KEY (vacina_aplicada_id) REFERENCES vacina_aplicada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_sumario_alta_id FOREIGN KEY (sumario_alta_id) REFERENCES sumario_alta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_mensagem_integracao_saida_id FOREIGN KEY (mensagem_integracao_saida_id) REFERENCES mensagem_integracao_saida (id) ON DELETE RESTRICT;
ALTER TABLE envio_rnds_versao
  ADD CONSTRAINT fk_envio_rnds_versao_envio_rnds_id FOREIGN KEY (envio_rnds_id) REFERENCES envio_rnds (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_rnds_versao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE envio_webservice_sus
  ADD CONSTRAINT fk_envio_webservice_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_credencial_integracao_id FOREIGN KEY (credencial_integracao_id) REFERENCES credencial_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_webservice_sus_mensagem_integracao_saida_id FOREIGN KEY (mensagem_integracao_saida_id) REFERENCES mensagem_integracao_saida (id) ON DELETE RESTRICT;
ALTER TABLE envio_webservice_sus_retorno
  ADD CONSTRAINT fk_envio_webservice_sus_retorno_envio_webservice_sus_id FOREIGN KEY (envio_webservice_sus_id) REFERENCES envio_webservice_sus (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_exame_equipamento
  ADD CONSTRAINT fk_equivalencia_exame_equipamento_interface_equipamento_id FOREIGN KEY (interface_equipamento_id) REFERENCES interface_equipamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_exame_equipamento_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_exame_equipamento_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE escopo_cliente_api
  ADD CONSTRAINT fk_escopo_cliente_api_cliente_api_id FOREIGN KEY (cliente_api_id) REFERENCES cliente_api (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escopo_cliente_api_escopo_api_id FOREIGN KEY (escopo_api_id) REFERENCES escopo_api (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escopo_cliente_api_finalidade_compartilhamento_id FOREIGN KEY (finalidade_compartilhamento_id) REFERENCES finalidade_compartilhamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escopo_cliente_api_concedido_por_usuario_id FOREIGN KEY (concedido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE esquema_mensagem
  ADD CONSTRAINT fk_esquema_mensagem_padrao_troca_id FOREIGN KEY (padrao_troca_id) REFERENCES padrao_troca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_esquema_mensagem_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE etiqueta_amostra_apoio
  ADD CONSTRAINT fk_etiqueta_amostra_apoio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_amostra_apoio_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_amostra_apoio_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_amostra_apoio_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_amostra_apoio_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_amostra_apoio_substituta_etiqueta_amostra_apoio_id FOREIGN KEY (substituta_etiqueta_amostra_apoio_id) REFERENCES etiqueta_amostra_apoio (id) ON DELETE RESTRICT;
ALTER TABLE evento_acesso_portaria
  ADD CONSTRAINT fk_evento_acesso_portaria_dispositivo_acesso_id FOREIGN KEY (dispositivo_acesso_id) REFERENCES dispositivo_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_acesso_portaria_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_acesso_portaria_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_acesso_portaria_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_acesso_portaria_visita_id FOREIGN KEY (visita_id) REFERENCES visita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_acesso_portaria_cracha_visitante_id FOREIGN KEY (cracha_visitante_id) REFERENCES cracha_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_acesso_portaria_regra_acesso_dispositivo_id FOREIGN KEY (regra_acesso_dispositivo_id) REFERENCES regra_acesso_dispositivo (id) ON DELETE RESTRICT;
ALTER TABLE exportacao_erp
  ADD CONSTRAINT fk_exportacao_erp_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_erp_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_erp_lote_contabil_id FOREIGN KEY (lote_contabil_id) REFERENCES lote_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_erp_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_erp_conciliado_por_usuario_id FOREIGN KEY (conciliado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE exportacao_erp_item
  ADD CONSTRAINT fk_exportacao_erp_item_exportacao_erp_id FOREIGN KEY (exportacao_erp_id) REFERENCES exportacao_erp (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_erp_item_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_erp_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE falha_integracao
  ADD CONSTRAINT fk_falha_integracao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_falha_integracao_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_falha_integracao_mensagem_integracao_entrada_id FOREIGN KEY (mensagem_integracao_entrada_id) REFERENCES mensagem_integracao_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_falha_integracao_mensagem_integracao_saida_id FOREIGN KEY (mensagem_integracao_saida_id) REFERENCES mensagem_integracao_saida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_falha_integracao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_falha_integracao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_falha_integracao_pendencia_id FOREIGN KEY (pendencia_id) REFERENCES pendencia (id) ON DELETE RESTRICT;
ALTER TABLE identificador_externo_pessoa
  ADD CONSTRAINT fk_identificador_externo_pessoa_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_identificador_externo_pessoa_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_resultado_portal
  ADD CONSTRAINT fk_liberacao_resultado_portal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_resultado_portal_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_resultado_portal_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_resultado_portal_setor_publicado_portal_id FOREIGN KEY (setor_publicado_portal_id) REFERENCES setor_publicado_portal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_resultado_portal_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_resultado_portal_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_resultado_portal_retirado_por_usuario_id FOREIGN KEY (retirado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE mapeamento_codigo_externo
  ADD CONSTRAINT fk_mapeamento_codigo_externo_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapeamento_codigo_externo_tipo_mapeamento_codigo_id FOREIGN KEY (tipo_mapeamento_codigo_id) REFERENCES tipo_mapeamento_codigo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapeamento_codigo_externo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE material_laboratorio_apoio
  ADD CONSTRAINT fk_material_laboratorio_apoio_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_laboratorio_apoio_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_laboratorio_apoio_recipiente_coleta_id FOREIGN KEY (recipiente_coleta_id) REFERENCES recipiente_coleta (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_integracao_entrada
  ADD CONSTRAINT fk_mensagem_integracao_entrada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_cliente_api_id FOREIGN KEY (cliente_api_id) REFERENCES cliente_api (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_canal_hl7_id FOREIGN KEY (canal_hl7_id) REFERENCES canal_hl7 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_esquema_mensagem_id FOREIGN KEY (esquema_mensagem_id) REFERENCES esquema_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_evento_hl7_id FOREIGN KEY (evento_hl7_id) REFERENCES evento_hl7 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_entrada_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_integracao_saida
  ADD CONSTRAINT fk_mensagem_integracao_saida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_ponto_integracao_id FOREIGN KEY (ponto_integracao_id) REFERENCES ponto_integracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_sistema_externo_id FOREIGN KEY (sistema_externo_id) REFERENCES sistema_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_tipo_evento_publicado_id FOREIGN KEY (tipo_evento_publicado_id) REFERENCES tipo_evento_publicado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_assinatura_evento_parceiro_id FOREIGN KEY (assinatura_evento_parceiro_id) REFERENCES assinatura_evento_parceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_canal_hl7_id FOREIGN KEY (canal_hl7_id) REFERENCES canal_hl7 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_esquema_mensagem_id FOREIGN KEY (esquema_mensagem_id) REFERENCES esquema_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_evento_hl7_id FOREIGN KEY (evento_hl7_id) REFERENCES evento_hl7 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_mensagem_integracao_entrada_id FOREIGN KEY (mensagem_integracao_entrada_id) REFERENCES mensagem_integracao_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_integracao_saida_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE modelo_mensagem_paciente
  ADD CONSTRAINT fk_modelo_mensagem_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_mensagem_paciente_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
