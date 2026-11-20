-- Chaves do módulo ADM, lote 01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acao_sistema
  ADD CONSTRAINT fk_acao_sistema_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_sistema_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_sistema_funcionalidade_sistema_id FOREIGN KEY (funcionalidade_sistema_id) REFERENCES funcionalidade_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_sistema_nivel_criticidade_auditoria_id FOREIGN KEY (nivel_criticidade_auditoria_id) REFERENCES nivel_criticidade_auditoria (id) ON DELETE RESTRICT;
ALTER TABLE aceite_termo_uso
  ADD CONSTRAINT fk_aceite_termo_uso_termo_uso_versao_id FOREIGN KEY (termo_uso_versao_id) REFERENCES termo_uso_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aceite_termo_uso_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aceite_termo_uso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aceite_termo_uso_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE acesso_emergencial
  ADD CONSTRAINT fk_acesso_emergencial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_emergencial_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_emergencial_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_emergencial_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_emergencial_motivo_acesso_emergencial_id FOREIGN KEY (motivo_acesso_emergencial_id) REFERENCES motivo_acesso_emergencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acesso_emergencial_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE alcada_aprovacao
  ADD CONSTRAINT fk_alcada_aprovacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alcada_aprovacao_tipo_documento_aprovacao_id FOREIGN KEY (tipo_documento_aprovacao_id) REFERENCES tipo_documento_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE alcada_aprovacao_nivel
  ADD CONSTRAINT fk_alcada_aprovacao_nivel_alcada_aprovacao_id FOREIGN KEY (alcada_aprovacao_id) REFERENCES alcada_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alcada_aprovacao_nivel_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alcada_aprovacao_nivel_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE alerta_gatilho
  ADD CONSTRAINT fk_alerta_gatilho_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_gatilho_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_gatilho_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT;
ALTER TABLE anonimizacao_registro
  ADD CONSTRAINT fk_anonimizacao_registro_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anonimizacao_registro_base_legal_tratamento_id FOREIGN KEY (base_legal_tratamento_id) REFERENCES base_legal_tratamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anonimizacao_registro_pedido_titular_id FOREIGN KEY (pedido_titular_id) REFERENCES pedido_titular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anonimizacao_registro_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_anonimizacao_registro_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_alerta
  ADD CONSTRAINT fk_assinatura_alerta_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_alerta_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_alerta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_alerta_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT;
ALTER TABLE assinatura_documento
  ADD CONSTRAINT fk_assinatura_documento_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_documento_signatario_usuario_id FOREIGN KEY (signatario_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_documento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_documento_certificado_usuario_id FOREIGN KEY (certificado_usuario_id) REFERENCES certificado_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assinatura_documento_arquivo_assinatura_id FOREIGN KEY (arquivo_assinatura_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE atribuicao_suporte
  ADD CONSTRAINT fk_atribuicao_suporte_conta_plataforma_id FOREIGN KEY (conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atribuicao_suporte_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atribuicao_suporte_concedente_conta_plataforma_id FOREIGN KEY (concedente_conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_plataforma
  ADD CONSTRAINT fk_auditoria_plataforma_conta_plataforma_id FOREIGN KEY (conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_plataforma_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_plataforma_sessao_suporte_id FOREIGN KEY (sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT;
ALTER TABLE biometria_usuario
  ADD CONSTRAINT fk_biometria_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_biometria_usuario_modelo_leitor_biometrico_id FOREIGN KEY (modelo_leitor_biometrico_id) REFERENCES modelo_leitor_biometrico (id) ON DELETE RESTRICT;
ALTER TABLE bloqueio_login
  ADD CONSTRAINT fk_bloqueio_login_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_login_motivo_bloqueio_usuario_id FOREIGN KEY (motivo_bloqueio_usuario_id) REFERENCES motivo_bloqueio_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_login_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_login_desbloqueador_usuario_id FOREIGN KEY (desbloqueador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE calendario_trabalho_usuario
  ADD CONSTRAINT fk_calendario_trabalho_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calendario_trabalho_usuario_calendario_trabalho_id FOREIGN KEY (calendario_trabalho_id) REFERENCES calendario_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE cenario_alerta
  ADD CONSTRAINT fk_cenario_alerta_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE certificacao_estabelecimento
  ADD CONSTRAINT fk_certificacao_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_certificacao_estabelecimento_orgao_certificador_id FOREIGN KEY (orgao_certificador_id) REFERENCES orgao_certificador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_certificacao_estabelecimento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE certificado_usuario
  ADD CONSTRAINT fk_certificado_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_certificado_usuario_tipo_certificado_id FOREIGN KEY (tipo_certificado_id) REFERENCES tipo_certificado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_certificado_usuario_provedor_assinatura_nuvem_id FOREIGN KEY (provedor_assinatura_nuvem_id) REFERENCES provedor_assinatura_nuvem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_certificado_usuario_oid_icp_id FOREIGN KEY (oid_icp_id) REFERENCES oid_icp (id) ON DELETE RESTRICT;
ALTER TABLE codigo_recuperacao_segundo_fator
  ADD CONSTRAINT fk_codigo_recuperacao_segundo_fator_segundo_fator_usuario_id FOREIGN KEY (segundo_fator_usuario_id) REFERENCES segundo_fator_usuario (id) ON DELETE RESTRICT;
ALTER TABLE comunicado
  ADD CONSTRAINT fk_comunicado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_tipo_comunicado_id FOREIGN KEY (tipo_comunicado_id) REFERENCES tipo_comunicado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_publicador_usuario_id FOREIGN KEY (publicador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE comunicado_ciencia
  ADD CONSTRAINT fk_comunicado_ciencia_comunicado_id FOREIGN KEY (comunicado_id) REFERENCES comunicado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_ciencia_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_ciencia_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE comunicado_destinatario
  ADD CONSTRAINT fk_comunicado_destinatario_comunicado_id FOREIGN KEY (comunicado_id) REFERENCES comunicado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_destinatario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_destinatario_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_destinatario_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_destinatario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicado_destinatario_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE consentimento_titular
  ADD CONSTRAINT fk_consentimento_titular_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_tipo_termo_lgpd_id FOREIGN KEY (tipo_termo_lgpd_id) REFERENCES tipo_termo_lgpd (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_base_legal_tratamento_id FOREIGN KEY (base_legal_tratamento_id) REFERENCES base_legal_tratamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_operacao_tratamento_dados_id FOREIGN KEY (operacao_tratamento_dados_id) REFERENCES operacao_tratamento_dados (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_responsavel_paciente_id FOREIGN KEY (responsavel_paciente_id) REFERENCES responsavel_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE consentimento_titular_historico
  ADD CONSTRAINT fk_consentimento_titular_historico_consentimento_titular_id FOREIGN KEY (consentimento_titular_id) REFERENCES consentimento_titular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consentimento_titular_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE consulta_verificacao_documento
  ADD CONSTRAINT fk_consulta_verificacao_documento_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE conta_plataforma
  ADD CONSTRAINT fk_conta_plataforma_provedor_identidade_id FOREIGN KEY (provedor_identidade_id) REFERENCES provedor_identidade (id) ON DELETE RESTRICT;
ALTER TABLE credencial_usuario
  ADD CONSTRAINT fk_credencial_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credencial_usuario_politica_senha_id FOREIGN KEY (politica_senha_id) REFERENCES politica_senha (id) ON DELETE RESTRICT;
ALTER TABLE decisao_aprovacao
  ADD CONSTRAINT fk_decisao_aprovacao_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_aprovacao_alcada_aprovacao_nivel_id FOREIGN KEY (alcada_aprovacao_nivel_id) REFERENCES alcada_aprovacao_nivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_aprovacao_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_aprovacao_delegacao_aprovacao_id FOREIGN KEY (delegacao_aprovacao_id) REFERENCES delegacao_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE delegacao_aprovacao
  ADD CONSTRAINT fk_delegacao_aprovacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_delegacao_aprovacao_delegante_usuario_id FOREIGN KEY (delegante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_delegacao_aprovacao_delegado_usuario_id FOREIGN KEY (delegado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_delegacao_aprovacao_tipo_documento_aprovacao_id FOREIGN KEY (tipo_documento_aprovacao_id) REFERENCES tipo_documento_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE dicionario_usuario
  ADD CONSTRAINT fk_dicionario_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE dispositivo_usuario
  ADD CONSTRAINT fk_dispositivo_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_assinado
  ADD CONSTRAINT fk_documento_assinado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_assinado_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_assinado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_assinado_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_assinado_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_assinado_arquivo_assinado_id FOREIGN KEY (arquivo_assinado_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_assinado_politica_assinatura_id FOREIGN KEY (politica_assinatura_id) REFERENCES politica_assinatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_assinado_lote_assinatura_id FOREIGN KEY (lote_assinatura_id) REFERENCES lote_assinatura (id) ON DELETE RESTRICT;
ALTER TABLE encarregado_dados
  ADD CONSTRAINT fk_encarregado_dados_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encarregado_dados_funcao_responsavel_lgpd_id FOREIGN KEY (funcao_responsavel_lgpd_id) REFERENCES funcao_responsavel_lgpd (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encarregado_dados_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encarregado_dados_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE envio_email
  ADD CONSTRAINT fk_envio_email_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_email_finalidade_email_id FOREIGN KEY (finalidade_email_id) REFERENCES finalidade_email (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_email_modelo_email_id FOREIGN KEY (modelo_email_id) REFERENCES modelo_email (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_email_servidor_email_id FOREIGN KEY (servidor_email_id) REFERENCES servidor_email (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_email_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_email_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE envio_email_destinatario
  ADD CONSTRAINT fk_envio_email_destinatario_envio_email_id FOREIGN KEY (envio_email_id) REFERENCES envio_email (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_email_destinatario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE envio_notificacao
  ADD CONSTRAINT fk_envio_notificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_notificacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_notificacao_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_notificacao_notificacao_usuario_id FOREIGN KEY (notificacao_usuario_id) REFERENCES notificacao_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_notificacao_regra_consolidacao_notificacao_id FOREIGN KEY (regra_consolidacao_notificacao_id) REFERENCES regra_consolidacao_notificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_notificacao_dispositivo_usuario_id FOREIGN KEY (dispositivo_usuario_id) REFERENCES dispositivo_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_notificacao_envio_email_id FOREIGN KEY (envio_email_id) REFERENCES envio_email (id) ON DELETE RESTRICT;
ALTER TABLE estacao_impressora
  ADD CONSTRAINT fk_estacao_impressora_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estacao_impressora_finalidade_impressao_id FOREIGN KEY (finalidade_impressao_id) REFERENCES finalidade_impressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estacao_impressora_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estacao_impressora_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE estacao_trabalho
  ADD CONSTRAINT fk_estacao_trabalho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estacao_trabalho_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estacao_trabalho_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estacao_trabalho_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE evento_auditoria
  ADD CONSTRAINT fk_evento_auditoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_conta_plataforma_id FOREIGN KEY (conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_sessao_suporte_id FOREIGN KEY (sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_tipo_acao_auditavel_id FOREIGN KEY (tipo_acao_auditavel_id) REFERENCES tipo_acao_auditavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_nivel_criticidade_auditoria_id FOREIGN KEY (nivel_criticidade_auditoria_id) REFERENCES nivel_criticidade_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_trilha_auditoria_id FOREIGN KEY (trilha_auditoria_id) REFERENCES trilha_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE evento_auditoria_alerta
  ADD CONSTRAINT fk_evento_auditoria_alerta_evento_auditoria_id FOREIGN KEY (evento_auditoria_id) REFERENCES evento_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_alerta_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_alerta_nivel_criticidade_auditoria_id FOREIGN KEY (nivel_criticidade_auditoria_id) REFERENCES nivel_criticidade_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_auditoria_alerta_tratador_usuario_id FOREIGN KEY (tratador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE evento_auditoria_registro
  ADD CONSTRAINT fk_evento_auditoria_registro_evento_auditoria_id FOREIGN KEY (evento_auditoria_id) REFERENCES evento_auditoria (id) ON DELETE RESTRICT;
ALTER TABLE evento_sessao
  ADD CONSTRAINT fk_evento_sessao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_sessao_conta_plataforma_id FOREIGN KEY (conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_sessao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_sessao_estabelecimento_anterior_id FOREIGN KEY (estabelecimento_anterior_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_sessao_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_sessao_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_sessao_dispositivo_usuario_id FOREIGN KEY (dispositivo_usuario_id) REFERENCES dispositivo_usuario (id) ON DELETE RESTRICT;
