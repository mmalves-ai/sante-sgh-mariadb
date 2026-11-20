-- Chaves do módulo QUA, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE documento_qualidade_distribuicao
  ADD CONSTRAINT fk_documento_qualidade_distribuicao_documento_qualidade_id FOREIGN KEY (documento_qualidade_id) REFERENCES documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_distribuicao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_distribuicao_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_distribuicao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_distribuicao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_qualidade_nota
  ADD CONSTRAINT fk_documento_qualidade_nota_documento_qualidade_id FOREIGN KEY (documento_qualidade_id) REFERENCES documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_nota_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_qualidade_referencia
  ADD CONSTRAINT fk_documento_qualidade_referencia_documento_qualidade_id FOREIGN KEY (documento_qualidade_id) REFERENCES documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_referencia_referenciado_document_48c1ad64 FOREIGN KEY (referenciado_documento_qualidade_id) REFERENCES documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_referencia_processo_institucional_id FOREIGN KEY (processo_institucional_id) REFERENCES processo_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_referencia_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_referencia_controle_risco_id FOREIGN KEY (controle_risco_id) REFERENCES controle_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_referencia_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_referencia_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT;
ALTER TABLE documento_qualidade_versao
  ADD CONSTRAINT fk_documento_qualidade_versao_documento_qualidade_id FOREIGN KEY (documento_qualidade_id) REFERENCES documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_versao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_versao_obsoleta_arquivo_id FOREIGN KEY (obsoleta_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_versao_elaborador_usuario_id FOREIGN KEY (elaborador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_versao_revisor_usuario_id FOREIGN KEY (revisor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_versao_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE dose_diaria_definida
  ADD CONSTRAINT fk_dose_diaria_definida_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT;
ALTER TABLE fator_contribuinte
  ADD CONSTRAINT fk_fator_contribuinte_superior_fator_contribuinte_id FOREIGN KEY (superior_fator_contribuinte_id) REFERENCES fator_contribuinte (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_vigilancia_iras
  ADD CONSTRAINT fk_fechamento_vigilancia_iras_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_vigilancia_iras_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_vigilancia_iras_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE fluxo_tratamento_incidente
  ADD CONSTRAINT fk_fluxo_tratamento_incidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE fluxo_tratamento_incidente_etapa
  ADD CONSTRAINT fk_fluxo_tratamento_incidente_etapa_fluxo_tratamento_in_bd92fda6 FOREIGN KEY (fluxo_tratamento_incidente_id) REFERENCES fluxo_tratamento_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_tratamento_incidente_etapa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_tratamento_incidente_etapa_responsavel_perfil_acesso_id FOREIGN KEY (responsavel_perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_tratamento_incidente_etapa_responsavel_setor_f_92f2b54b FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fluxo_tratamento_incidente_etapa_modelo_checklist_qu_195ae125 FOREIGN KEY (modelo_checklist_qualidade_id) REFERENCES modelo_checklist_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE gatilho_notificacao_incidente
  ADD CONSTRAINT fk_gatilho_notificacao_incidente_tipo_incidente_id FOREIGN KEY (tipo_incidente_id) REFERENCES tipo_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gatilho_notificacao_incidente_sugerido_grau_dano_id FOREIGN KEY (sugerido_grau_dano_id) REFERENCES grau_dano (id) ON DELETE RESTRICT;
ALTER TABLE investigacao_obito_vigilancia
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_revisao_obito_id FOREIGN KEY (revisao_obito_id) REFERENCES revisao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_causa_basica_termo_ter_4c999790 FOREIGN KEY (causa_basica_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_notificado_municipio_ibge_id FOREIGN KEY (notificado_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_investigacao_obito_vigilancia_ficha_arquivo_id FOREIGN KEY (ficha_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE manifestacao_incidente
  ADD CONSTRAINT fk_manifestacao_incidente_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_incidente_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_incidente_gestor_usuario_id FOREIGN KEY (gestor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_incidente_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_incidente_respondente_usuario_id FOREIGN KEY (respondente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE manifestacao_ouvidoria
  ADD CONSTRAINT fk_manifestacao_ouvidoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_tipo_manifestacao_ouvidoria_id FOREIGN KEY (tipo_manifestacao_ouvidoria_id) REFERENCES tipo_manifestacao_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_canal_ouvidoria_id FOREIGN KEY (canal_ouvidoria_id) REFERENCES canal_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_motivo_manifestacao_id FOREIGN KEY (motivo_manifestacao_id) REFERENCES motivo_manifestacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_perfil_manifestante_id FOREIGN KEY (perfil_manifestante_id) REFERENCES perfil_manifestante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_registrante_usuario_id FOREIGN KEY (registrante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_encerrante_usuario_id FOREIGN KEY (encerrante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_motivo_encerramento_manifestacao_id FOREIGN KEY (motivo_encerramento_manifestacao_id) REFERENCES motivo_encerramento_manifestacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_resposta_pesquisa_satisfacao_id FOREIGN KEY (resposta_pesquisa_satisfacao_id) REFERENCES resposta_pesquisa_satisfacao (id) ON DELETE RESTRICT;
ALTER TABLE manifestacao_ouvidoria_evento
  ADD CONSTRAINT fk_manifestacao_ouvidoria_evento_manifestacao_ouvidoria_id FOREIGN KEY (manifestacao_ouvidoria_id) REFERENCES manifestacao_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_evento_origem_setor_funcional_id FOREIGN KEY (origem_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_evento_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_evento_destino_usuario_id FOREIGN KEY (destino_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE manifestacao_ouvidoria_setor
  ADD CONSTRAINT fk_manifestacao_ouvidoria_setor_manifestacao_ouvidoria_id FOREIGN KEY (manifestacao_ouvidoria_id) REFERENCES manifestacao_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_setor_motivo_manifestacao_id FOREIGN KEY (motivo_manifestacao_id) REFERENCES motivo_manifestacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manifestacao_ouvidoria_setor_instrutor_usuario_id FOREIGN KEY (instrutor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_checklist_qualidade_item
  ADD CONSTRAINT fk_modelo_checklist_qualidade_item_modelo_checklist_qua_ac4b6ce8 FOREIGN KEY (modelo_checklist_qualidade_versao_id) REFERENCES modelo_checklist_qualidade_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_checklist_qualidade_item_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_checklist_qualidade_versao
  ADD CONSTRAINT fk_modelo_checklist_qualidade_versao_modelo_checklist_q_0a70029d FOREIGN KEY (modelo_checklist_qualidade_id) REFERENCES modelo_checklist_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_checklist_qualidade_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_checklist_qualidade_versao_publicador_usuario_id FOREIGN KEY (publicador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pesquisa_satisfacao_opcao
  ADD CONSTRAINT fk_modelo_pesquisa_satisfacao_opcao_modelo_pesquisa_sat_c00d58dd FOREIGN KEY (modelo_pesquisa_satisfacao_pergunta_id) REFERENCES modelo_pesquisa_satisfacao_pergunta (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pesquisa_satisfacao_pergunta
  ADD CONSTRAINT fk_modelo_pesquisa_satisfacao_pergunta_modelo_pesquisa__e10eddd5 FOREIGN KEY (modelo_pesquisa_satisfacao_id) REFERENCES modelo_pesquisa_satisfacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pesquisa_satisfacao_pergunta_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE motivo_manifestacao
  ADD CONSTRAINT fk_motivo_manifestacao_superior_motivo_manifestacao_id FOREIGN KEY (superior_motivo_manifestacao_id) REFERENCES motivo_manifestacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motivo_manifestacao_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE nao_conformidade_qualidade
  ADD CONSTRAINT fk_nao_conformidade_qualidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_auditoria_interna_id FOREIGN KEY (auditoria_interna_id) REFERENCES auditoria_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_achado_auditoria_id FOREIGN KEY (achado_auditoria_id) REFERENCES achado_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_visita_acreditacao_id FOREIGN KEY (visita_acreditacao_id) REFERENCES visita_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_manifestacao_ouvidoria_id FOREIGN KEY (manifestacao_ouvidoria_id) REFERENCES manifestacao_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_abertura_usuario_id FOREIGN KEY (abertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_verificador_usuario_id FOREIGN KEY (verificador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE nao_conformidade_qualidade_evento
  ADD CONSTRAINT fk_nao_conformidade_qualidade_evento_nao_conformidade_q_d11183c9 FOREIGN KEY (nao_conformidade_qualidade_id) REFERENCES nao_conformidade_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nao_conformidade_qualidade_evento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_incidente
  ADD CONSTRAINT fk_notificacao_incidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_notificador_usuario_id FOREIGN KEY (notificador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_notificador_setor_funcional_id FOREIGN KEY (notificador_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_tipo_incidente_id FOREIGN KEY (tipo_incidente_id) REFERENCES tipo_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_percebido_grau_dano_id FOREIGN KEY (percebido_grau_dano_id) REFERENCES grau_dano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_classificacao_incidente_id FOREIGN KEY (classificacao_incidente_id) REFERENCES classificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_grau_dano_id FOREIGN KEY (grau_dano_id) REFERENCES grau_dano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_metodo_deteccao_incidente_id FOREIGN KEY (metodo_deteccao_incidente_id) REFERENCES metodo_deteccao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_acao_imediata_incidente_id FOREIGN KEY (acao_imediata_incidente_id) REFERENCES acao_imediata_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_fluxo_tratamento_incidente_id FOREIGN KEY (fluxo_tratamento_incidente_id) REFERENCES fluxo_tratamento_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_sugestao_notificacao_incidente_id FOREIGN KEY (sugestao_notificacao_incidente_id) REFERENCES sugestao_notificacao_incidente (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_incidente_envio
  ADD CONSTRAINT fk_notificacao_incidente_envio_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_envio_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_envio_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_incidente_evento
  ADD CONSTRAINT fk_notificacao_incidente_evento_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_evento_fluxo_tratamento_incide_931ff37b FOREIGN KEY (fluxo_tratamento_incidente_etapa_id) REFERENCES fluxo_tratamento_incidente_etapa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_evento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_evento_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_incidente_nota
  ADD CONSTRAINT fk_notificacao_incidente_nota_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_nota_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_incidente_produto
  ADD CONSTRAINT fk_notificacao_incidente_produto_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_produto_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_produto_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_produto_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_produto_bolsa_hemocomponente_id FOREIGN KEY (bolsa_hemocomponente_id) REFERENCES bolsa_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_produto_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_produto_queixa_tecnica_produto_id FOREIGN KEY (queixa_tecnica_produto_id) REFERENCES queixa_tecnica_produto (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_incidente_relacionada
  ADD CONSTRAINT fk_notificacao_incidente_relacionada_principal_notifica_b5213b29 FOREIGN KEY (principal_notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_relacionada_relacionada_notifi_fd473d7e FOREIGN KEY (relacionada_notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_relacionada_relacionador_usuario_id FOREIGN KEY (relacionador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_incidente_resposta
  ADD CONSTRAINT fk_notificacao_incidente_resposta_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_incidente_resposta_campo_tipo_incidente_id FOREIGN KEY (campo_tipo_incidente_id) REFERENCES campo_tipo_incidente (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_iras_envio
  ADD CONSTRAINT fk_notificacao_iras_envio_fechamento_vigilancia_iras_id FOREIGN KEY (fechamento_vigilancia_iras_id) REFERENCES fechamento_vigilancia_iras (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_iras_envio_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_iras_envio_componente_vigilancia_id FOREIGN KEY (componente_vigilancia_id) REFERENCES componente_vigilancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_iras_envio_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE observacao_higiene_maos
  ADD CONSTRAINT fk_observacao_higiene_maos_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_observacao_higiene_maos_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_observacao_higiene_maos_observador_usuario_id FOREIGN KEY (observador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE observacao_higiene_maos_item
  ADD CONSTRAINT fk_observacao_higiene_maos_item_observacao_higiene_maos_id FOREIGN KEY (observacao_higiene_maos_id) REFERENCES observacao_higiene_maos (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_observacao_higiene_maos_item_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT;
ALTER TABLE parecer_manifestacao
  ADD CONSTRAINT fk_parecer_manifestacao_manifestacao_ouvidoria_id FOREIGN KEY (manifestacao_ouvidoria_id) REFERENCES manifestacao_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parecer_manifestacao_manifestacao_ouvidoria_setor_id FOREIGN KEY (manifestacao_ouvidoria_setor_id) REFERENCES manifestacao_ouvidoria_setor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parecer_manifestacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parecer_manifestacao_destinatario_usuario_id FOREIGN KEY (destinatario_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parecer_manifestacao_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parecer_manifestacao_respondente_usuario_id FOREIGN KEY (respondente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pasta_documento_qualidade
  ADD CONSTRAINT fk_pasta_documento_qualidade_superior_pasta_documento_q_48d67397 FOREIGN KEY (superior_pasta_documento_qualidade_id) REFERENCES pasta_documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pasta_documento_qualidade_tipo_documento_qualidade_id FOREIGN KEY (tipo_documento_qualidade_id) REFERENCES tipo_documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pasta_documento_qualidade_leitura_perfil_acesso_id FOREIGN KEY (leitura_perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pasta_documento_qualidade_publicacao_perfil_acesso_id FOREIGN KEY (publicacao_perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE perfil_multirresistencia
  ADD CONSTRAINT fk_perfil_multirresistencia_classe_antimicrobiano_id FOREIGN KEY (classe_antimicrobiano_id) REFERENCES classe_antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE plano_acao_qualidade
  ADD CONSTRAINT fk_plano_acao_qualidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_analise_incidente_id FOREIGN KEY (analise_incidente_id) REFERENCES analise_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_nao_conformidade_qualidade_id FOREIGN KEY (nao_conformidade_qualidade_id) REFERENCES nao_conformidade_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_auditoria_interna_id FOREIGN KEY (auditoria_interna_id) REFERENCES auditoria_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_achado_auditoria_id FOREIGN KEY (achado_auditoria_id) REFERENCES achado_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_manifestacao_ouvidoria_id FOREIGN KEY (manifestacao_ouvidoria_id) REFERENCES manifestacao_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_processo_institucional_id FOREIGN KEY (processo_institucional_id) REFERENCES processo_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_acao_qualidade_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE prazo_manifestacao_ouvidoria
  ADD CONSTRAINT fk_prazo_manifestacao_ouvidoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_manifestacao_ouvidoria_tipo_manifestacao_ouvidoria_id FOREIGN KEY (tipo_manifestacao_ouvidoria_id) REFERENCES tipo_manifestacao_ouvidoria (id) ON DELETE RESTRICT;
ALTER TABLE prazo_tratamento_incidente
  ADD CONSTRAINT fk_prazo_tratamento_incidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_tratamento_incidente_classificacao_incidente_id FOREIGN KEY (classificacao_incidente_id) REFERENCES classificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_tratamento_incidente_grau_dano_id FOREIGN KEY (grau_dano_id) REFERENCES grau_dano (id) ON DELETE RESTRICT;
