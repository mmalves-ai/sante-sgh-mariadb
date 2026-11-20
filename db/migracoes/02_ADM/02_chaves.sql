-- Chaves do módulo ADM, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE exportacao_documento
  ADD CONSTRAINT fk_exportacao_documento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_tipo_justificativa_exportacao_id FOREIGN KEY (tipo_justificativa_exportacao_id) REFERENCES tipo_justificativa_exportacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_motivo_reimpressao_id FOREIGN KEY (motivo_reimpressao_id) REFERENCES motivo_reimpressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exportacao_documento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE favorito_usuario
  ADD CONSTRAINT fk_favorito_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_favorito_usuario_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT;
ALTER TABLE finalidade_email
  ADD CONSTRAINT fk_finalidade_email_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE funcionalidade_estabelecimento
  ADD CONSTRAINT fk_funcionalidade_estabelecimento_funcionalidade_sistema_id FOREIGN KEY (funcionalidade_sistema_id) REFERENCES funcionalidade_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcionalidade_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcionalidade_estabelecimento_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcionalidade_estabelecimento_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE funcionalidade_estabelecimento_historico
  ADD CONSTRAINT fk_funcionalidade_estab_historico_funcionalidade_estab_id FOREIGN KEY (funcionalidade_estabelecimento_id) REFERENCES funcionalidade_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcionalidade_estabelecimento_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE funcionalidade_sistema
  ADD CONSTRAINT fk_funcionalidade_sistema_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE grau_priorizacao_gut
  ADD CONSTRAINT fk_grau_priorizacao_gut_dimensao_priorizacao_gut_id FOREIGN KEY (dimensao_priorizacao_gut_id) REFERENCES dimensao_priorizacao_gut (id) ON DELETE RESTRICT;
ALTER TABLE historico_senha
  ADD CONSTRAINT fk_historico_senha_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historico_senha_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE impressora
  ADD CONSTRAINT fk_impressora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impressora_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impressora_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE impressora_finalidade_estabelecimento
  ADD CONSTRAINT fk_impressora_finalidade_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impressora_finalidade_estabelecimento_finalidade_impressao_id FOREIGN KEY (finalidade_impressao_id) REFERENCES finalidade_impressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impressora_finalidade_estabelecimento_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impressora_finalidade_estabelecimento_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_impressora_finalidade_estabelecimento_modelo_etiqueta_id FOREIGN KEY (modelo_etiqueta_id) REFERENCES modelo_etiqueta (id) ON DELETE RESTRICT;
ALTER TABLE incidente_seguranca_dados
  ADD CONSTRAINT fk_incidente_seguranca_dados_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incidente_seguranca_dados_encarregado_dados_id FOREIGN KEY (encarregado_dados_id) REFERENCES encarregado_dados (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incidente_seguranca_dados_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE leitura_prontuario
  ADD CONSTRAINT fk_leitura_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_acesso_emergencial_id FOREIGN KEY (acesso_emergencial_id) REFERENCES acesso_emergencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_motivo_acesso_emergencial_id FOREIGN KEY (motivo_acesso_emergencial_id) REFERENCES motivo_acesso_emergencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_prontuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lista_distribuicao_email
  ADD CONSTRAINT fk_lista_distribuicao_email_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_distribuicao_email_finalidade_email_id FOREIGN KEY (finalidade_email_id) REFERENCES finalidade_email (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_distribuicao_email_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE lista_distribuicao_email_membro
  ADD CONSTRAINT fk_lista_distribuicao_email_membro_lista_distribuicao_email_id FOREIGN KEY (lista_distribuicao_email_id) REFERENCES lista_distribuicao_email (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lista_distribuicao_email_membro_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_assinatura
  ADD CONSTRAINT fk_lote_assinatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_signatario_usuario_id FOREIGN KEY (signatario_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_certificado_usuario_id FOREIGN KEY (certificado_usuario_id) REFERENCES certificado_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE lote_assinatura_item
  ADD CONSTRAINT fk_lote_assinatura_item_lote_assinatura_id FOREIGN KEY (lote_assinatura_id) REFERENCES lote_assinatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_item_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_item_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_item_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_assinatura_item_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_interna
  ADD CONSTRAINT fk_mensagem_interna_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_interna_remetente_usuario_id FOREIGN KEY (remetente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_interna_respondida_mensagem_interna_id FOREIGN KEY (respondida_mensagem_interna_id) REFERENCES mensagem_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_interna_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_interna_destinatario
  ADD CONSTRAINT fk_mensagem_interna_destinatario_mensagem_interna_id FOREIGN KEY (mensagem_interna_id) REFERENCES mensagem_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_interna_destinatario_destinatario_usuario_id FOREIGN KEY (destinatario_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_email
  ADD CONSTRAINT fk_modelo_email_finalidade_email_id FOREIGN KEY (finalidade_email_id) REFERENCES finalidade_email (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_email_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_email_copia_lista_distribuicao_email_id FOREIGN KEY (copia_lista_distribuicao_email_id) REFERENCES lista_distribuicao_email (id) ON DELETE RESTRICT;
ALTER TABLE modelo_email_campo
  ADD CONSTRAINT fk_modelo_email_campo_modelo_email_id FOREIGN KEY (modelo_email_id) REFERENCES modelo_email (id) ON DELETE RESTRICT;
ALTER TABLE modelo_etiqueta
  ADD CONSTRAINT fk_modelo_etiqueta_finalidade_impressao_id FOREIGN KEY (finalidade_impressao_id) REFERENCES finalidade_impressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE modelo_etiqueta_campo
  ADD CONSTRAINT fk_modelo_etiqueta_campo_modelo_etiqueta_id FOREIGN KEY (modelo_etiqueta_id) REFERENCES modelo_etiqueta (id) ON DELETE RESTRICT;
ALTER TABLE modelo_etiqueta_uso
  ADD CONSTRAINT fk_modelo_etiqueta_uso_modelo_etiqueta_id FOREIGN KEY (modelo_etiqueta_id) REFERENCES modelo_etiqueta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_uso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_uso_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_uso_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_uso_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_uso_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT;
ALTER TABLE modulo_sistema
  ADD CONSTRAINT fk_modulo_sistema_pai_modulo_sistema_id FOREIGN KEY (pai_modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_usuario
  ADD CONSTRAINT fk_notificacao_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_usuario_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_usuario_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_usuario_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_usuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_usuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_usuario_resolvida_por_usuario_id FOREIGN KEY (resolvida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE oid_icp
  ADD CONSTRAINT fk_oid_icp_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
ALTER TABLE operacao_tratamento_dados
  ADD CONSTRAINT fk_operacao_tratamento_dados_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_tratamento_dados_base_legal_tratamento_id FOREIGN KEY (base_legal_tratamento_id) REFERENCES base_legal_tratamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_tratamento_dados_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_tratamento_dados_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_operacao_tratamento_dados_encarregado_dados_id FOREIGN KEY (encarregado_dados_id) REFERENCES encarregado_dados (id) ON DELETE RESTRICT;
ALTER TABLE papel_seguranca_acao
  ADD CONSTRAINT fk_papel_seguranca_acao_papel_seguranca_id FOREIGN KEY (papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_papel_seguranca_acao_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT;
ALTER TABLE parametro_definicao
  ADD CONSTRAINT fk_parametro_definicao_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE parametro_opcao
  ADD CONSTRAINT fk_parametro_opcao_parametro_definicao_id FOREIGN KEY (parametro_definicao_id) REFERENCES parametro_definicao (id) ON DELETE RESTRICT;
ALTER TABLE parametro_valor
  ADD CONSTRAINT fk_parametro_valor_parametro_definicao_id FOREIGN KEY (parametro_definicao_id) REFERENCES parametro_definicao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_valor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_valor_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_valor_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_valor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE parametro_valor_historico
  ADD CONSTRAINT fk_parametro_valor_historico_parametro_valor_id FOREIGN KEY (parametro_valor_id) REFERENCES parametro_valor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_valor_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_acesso
  ADD CONSTRAINT fk_pedido_acesso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_executado_por_usuario_id FOREIGN KEY (executado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_acesso_item
  ADD CONSTRAINT fk_pedido_acesso_item_pedido_acesso_id FOREIGN KEY (pedido_acesso_id) REFERENCES pedido_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_papel_seguranca_id FOREIGN KEY (papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_tipo_escopo_acesso_id FOREIGN KEY (tipo_escopo_acesso_id) REFERENCES tipo_escopo_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_acesso_item_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_aprovacao
  ADD CONSTRAINT fk_pedido_aprovacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_aprovacao_tipo_documento_aprovacao_id FOREIGN KEY (tipo_documento_aprovacao_id) REFERENCES tipo_documento_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_aprovacao_alcada_aprovacao_id FOREIGN KEY (alcada_aprovacao_id) REFERENCES alcada_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_aprovacao_alcada_aprovacao_nivel_id FOREIGN KEY (alcada_aprovacao_nivel_id) REFERENCES alcada_aprovacao_nivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_aprovacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_aprovacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_aprovacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_aprovacao_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
