-- Chaves do lote 02_ADM-03 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE pedido_titular
  ADD CONSTRAINT fk_pedido_titular_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_titular_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_titular_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_titular_resposta_arquivo_id FOREIGN KEY (resposta_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE pedido_titular_historico
  ADD CONSTRAINT fk_pedido_titular_historico_pedido_titular_id FOREIGN KEY (pedido_titular_id) REFERENCES pedido_titular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_titular_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE perfil_acesso
  ADD CONSTRAINT fk_perfil_acesso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE perfil_acao
  ADD CONSTRAINT fk_perfil_acao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_acao_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT;
ALTER TABLE politica_assinatura
  ADD CONSTRAINT fk_politica_assinatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_politica_assinatura_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_politica_assinatura_tipo_certificado_id FOREIGN KEY (tipo_certificado_id) REFERENCES tipo_certificado (id) ON DELETE RESTRICT;
ALTER TABLE politica_retencao_auditoria
  ADD CONSTRAINT fk_politica_retencao_auditoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_politica_retencao_auditoria_tipo_acao_auditavel_id FOREIGN KEY (tipo_acao_auditavel_id) REFERENCES tipo_acao_auditavel (id) ON DELETE RESTRICT;
ALTER TABLE politica_senha
  ADD CONSTRAINT fk_politica_senha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE preferencia_canal_usuario
  ADD CONSTRAINT fk_preferencia_canal_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preferencia_canal_usuario_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT;
ALTER TABLE preferencia_tela_usuario
  ADD CONSTRAINT fk_preferencia_tela_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preferencia_tela_usuario_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT;
ALTER TABLE preferencia_usuario
  ADD CONSTRAINT fk_preferencia_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preferencia_usuario_tela_inicial_id FOREIGN KEY (tela_inicial_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preferencia_usuario_estabelecimento_padrao_id FOREIGN KEY (estabelecimento_padrao_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preferencia_usuario_estacao_trabalho_padrao_id FOREIGN KEY (estacao_trabalho_padrao_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_preferencia_usuario_local_atendimento_padrao_id FOREIGN KEY (local_atendimento_padrao_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE provedor_assinatura_nuvem
  ADD CONSTRAINT fk_provedor_assinatura_nuvem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provedor_assinatura_nuvem_tipo_certificado_id FOREIGN KEY (tipo_certificado_id) REFERENCES tipo_certificado (id) ON DELETE RESTRICT;
ALTER TABLE provedor_identidade
  ADD CONSTRAINT fk_provedor_identidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE provedor_identidade_perfil
  ADD CONSTRAINT fk_provedor_identidade_perfil_provedor_identidade_id FOREIGN KEY (provedor_identidade_id) REFERENCES provedor_identidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provedor_identidade_perfil_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provedor_identidade_perfil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE recertificacao_acesso
  ADD CONSTRAINT fk_recertificacao_acesso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recertificacao_acesso_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recertificacao_acesso_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recertificacao_acesso_gestor_usuario_id FOREIGN KEY (gestor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recertificacao_acesso_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE recertificacao_acesso_item
  ADD CONSTRAINT fk_recertificacao_acesso_item_recertificacao_acesso_id FOREIGN KEY (recertificacao_acesso_id) REFERENCES recertificacao_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recertificacao_acesso_item_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recertificacao_acesso_item_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recertificacao_acesso_item_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE redefinicao_senha
  ADD CONSTRAINT fk_redefinicao_senha_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_redefinicao_senha_solicitado_por_usuario_id FOREIGN KEY (solicitado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE registro_excluido
  ADD CONSTRAINT fk_registro_excluido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_excluido_motivo_exclusao_registro_id FOREIGN KEY (motivo_exclusao_registro_id) REFERENCES motivo_exclusao_registro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_excluido_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_excluido_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_excluido_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_excluido_revertido_por_usuario_id FOREIGN KEY (revertido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE registro_reimpressao
  ADD CONSTRAINT fk_registro_reimpressao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_reimpressao_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_reimpressao_motivo_reimpressao_id FOREIGN KEY (motivo_reimpressao_id) REFERENCES motivo_reimpressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_reimpressao_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_reimpressao_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_reimpressao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_acao_automatica
  ADD CONSTRAINT fk_regra_acao_automatica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_acao_automatica_condicao
  ADD CONSTRAINT fk_regra_acao_automatica_condicao_regra_acao_automatica_id FOREIGN KEY (regra_acao_automatica_id) REFERENCES regra_acao_automatica (id) ON DELETE RESTRICT;
ALTER TABLE regra_acao_automatica_resultado
  ADD CONSTRAINT fk_regra_acao_automatica_resultado_regra_acao_automatica_id FOREIGN KEY (regra_acao_automatica_id) REFERENCES regra_acao_automatica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_acao_automatica_resultado_regra_acao_automatic_38323bb2 FOREIGN KEY (regra_acao_automatica_condicao_id) REFERENCES regra_acao_automatica_condicao (id) ON DELETE RESTRICT;
ALTER TABLE regra_alerta
  ADD CONSTRAINT fk_regra_alerta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_cenario_alerta_id FOREIGN KEY (cenario_alerta_id) REFERENCES cenario_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_regra_consolidacao_notificacao_id FOREIGN KEY (regra_consolidacao_notificacao_id) REFERENCES regra_consolidacao_notificacao (id) ON DELETE RESTRICT;
ALTER TABLE regra_alerta_destinatario
  ADD CONSTRAINT fk_regra_alerta_destinatario_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_destinatario_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_destinatario_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_destinatario_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_destinatario_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_destinatario_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_destinatario_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_destinatario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_alerta_paciente
  ADD CONSTRAINT fk_regra_alerta_paciente_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_alerta_versao
  ADD CONSTRAINT fk_regra_alerta_versao_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_alerta_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_consolidacao_notificacao
  ADD CONSTRAINT fk_regra_consolidacao_notificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_obrigatoriedade_campo
  ADD CONSTRAINT fk_regra_obrigatoriedade_campo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_obrigatoriedade_campo_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT;
ALTER TABLE regra_segregacao_funcao
  ADD CONSTRAINT fk_regra_segregacao_funcao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_segregacao_funcao_acao
  ADD CONSTRAINT fk_regra_segregacao_funcao_acao_regra_segregacao_funcao_id FOREIGN KEY (regra_segregacao_funcao_id) REFERENCES regra_segregacao_funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_segregacao_funcao_acao_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_segregacao_funcao_acao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE resposta_notificacao
  ADD CONSTRAINT fk_resposta_notificacao_notificacao_usuario_id FOREIGN KEY (notificacao_usuario_id) REFERENCES notificacao_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_notificacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_notificacao_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT;
ALTER TABLE restricao_acesso_usuario
  ADD CONSTRAINT fk_restricao_acesso_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_acesso_usuario_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_acesso_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE restricao_prontuario
  ADD CONSTRAINT fk_restricao_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE restricao_prontuario_autorizado
  ADD CONSTRAINT fk_restricao_prontuario_autorizado_restricao_prontuario_id FOREIGN KEY (restricao_prontuario_id) REFERENCES restricao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_autorizado_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_autorizado_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_autorizado_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_autorizado_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_prontuario_autorizado_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE revisao_acesso_emergencial
  ADD CONSTRAINT fk_revisao_acesso_emergencial_acesso_emergencial_id FOREIGN KEY (acesso_emergencial_id) REFERENCES acesso_emergencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_acesso_emergencial_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_acesso_emergencial_revisor_usuario_id FOREIGN KEY (revisor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_acesso_emergencial_incidente_seguranca_dados_id FOREIGN KEY (incidente_seguranca_dados_id) REFERENCES incidente_seguranca_dados (id) ON DELETE RESTRICT;
ALTER TABLE segundo_fator_usuario
  ADD CONSTRAINT fk_segundo_fator_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE servidor_email
  ADD CONSTRAINT fk_servidor_email_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servidor_email_finalidade_email_id FOREIGN KEY (finalidade_email_id) REFERENCES finalidade_email (id) ON DELETE RESTRICT;
ALTER TABLE sessao_suporte
  ADD CONSTRAINT fk_sessao_suporte_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_suporte_alvo_usuario_id FOREIGN KEY (alvo_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_suporte_suporte_usuario_id FOREIGN KEY (suporte_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_suporte_conta_plataforma_id FOREIGN KEY (conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_suporte_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sessao_suporte_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE tarefa_usuario
  ADD CONSTRAINT fk_tarefa_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarefa_usuario_categoria_tarefa_id FOREIGN KEY (categoria_tarefa_id) REFERENCES categoria_tarefa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarefa_usuario_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tarefa_usuario_registrante_usuario_id FOREIGN KEY (registrante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE tela_sistema
  ADD CONSTRAINT fk_tela_sistema_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tela_sistema_tela_pai_id FOREIGN KEY (tela_pai_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tela_sistema_funcionalidade_sistema_id FOREIGN KEY (funcionalidade_sistema_id) REFERENCES funcionalidade_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tela_sistema_nivel_criticidade_auditoria_id FOREIGN KEY (nivel_criticidade_auditoria_id) REFERENCES nivel_criticidade_auditoria (id) ON DELETE RESTRICT;
ALTER TABLE termo_uso_versao
  ADD CONSTRAINT fk_termo_uso_versao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_uso_versao_publicado_por_usuario_id FOREIGN KEY (publicado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE teste_restauracao
  ADD CONSTRAINT fk_teste_restauracao_verificacao_backup_id FOREIGN KEY (verificacao_backup_id) REFERENCES verificacao_backup (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_restauracao_evidencia_arquivo_id FOREIGN KEY (evidencia_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_restauracao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_restauracao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE tipo_acao_auditavel
  ADD CONSTRAINT fk_tipo_acao_auditavel_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_acao_auditavel_nivel_criticidade_auditoria_id FOREIGN KEY (nivel_criticidade_auditoria_id) REFERENCES nivel_criticidade_auditoria (id) ON DELETE RESTRICT;
ALTER TABLE tipo_documento_aprovacao
  ADD CONSTRAINT fk_tipo_documento_aprovacao_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
