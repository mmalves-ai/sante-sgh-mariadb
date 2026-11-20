-- Módulo REC, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE categoria_atendimento
  ADD CONSTRAINT fk_categoria_atendimento_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE origem_entrada_atendimento
  ADD CONSTRAINT fk_origem_entrada_atendimento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE procedencia
  ADD CONSTRAINT fk_procedencia_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedencia_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE ponto_recepcao
  ADD CONSTRAINT fk_ponto_recepcao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_recepcao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_recepcao_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT;
ALTER TABLE balanceamento_chamada
  ADD CONSTRAINT fk_balanceamento_chamada_ponto_recepcao_id FOREIGN KEY (ponto_recepcao_id) REFERENCES ponto_recepcao (id) ON DELETE RESTRICT;
ALTER TABLE local_atendimento
  ADD CONSTRAINT fk_local_atendimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_ponto_recepcao_id FOREIGN KEY (ponto_recepcao_id) REFERENCES ponto_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT;
ALTER TABLE local_atendimento_encaminhamento
  ADD CONSTRAINT fk_local_atendimento_encaminhamento_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_encaminhamento_destino_local_atendimento_id FOREIGN KEY (destino_local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE local_atendimento_horario
  ADD CONSTRAINT fk_local_atendimento_horario_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE local_atendimento_visibilidade
  ADD CONSTRAINT fk_local_atendimento_visibilidade_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_visibilidade_consultado_local_aten_7bbac86b FOREIGN KEY (consultado_local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE guiche_recepcao
  ADD CONSTRAINT fk_guiche_recepcao_ponto_recepcao_id FOREIGN KEY (ponto_recepcao_id) REFERENCES ponto_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guiche_recepcao_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guiche_recepcao_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE ocupacao_guiche
  ADD CONSTRAINT fk_ocupacao_guiche_guiche_recepcao_id FOREIGN KEY (guiche_recepcao_id) REFERENCES guiche_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_guiche_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_guiche_ocupante_usuario_id FOREIGN KEY (ocupante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_guiche_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE painel_chamada
  ADD CONSTRAINT fk_painel_chamada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_chamada_tipo_painel_id FOREIGN KEY (tipo_painel_id) REFERENCES tipo_painel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_chamada_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_chamada_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE gerador_senha
  ADD CONSTRAINT fk_gerador_senha_ponto_recepcao_id FOREIGN KEY (ponto_recepcao_id) REFERENCES ponto_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gerador_senha_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gerador_senha_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gerador_senha_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gerador_senha_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gerador_senha_grupo_prioridade_legal_id FOREIGN KEY (grupo_prioridade_legal_id) REFERENCES grupo_prioridade_legal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gerador_senha_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gerador_senha_icone_arquivo_id FOREIGN KEY (icone_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE senha_emitida
  ADD CONSTRAINT fk_senha_emitida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_gerador_senha_id FOREIGN KEY (gerador_senha_id) REFERENCES gerador_senha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_grupo_prioridade_legal_id FOREIGN KEY (grupo_prioridade_legal_id) REFERENCES grupo_prioridade_legal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_emitida_usuario_id FOREIGN KEY (emitida_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_guiche_recepcao_id FOREIGN KEY (guiche_recepcao_id) REFERENCES guiche_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_senha_emitida_motivo_cancelamento_operacao_id FOREIGN KEY (motivo_cancelamento_operacao_id) REFERENCES motivo_cancelamento_operacao (id) ON DELETE RESTRICT;
ALTER TABLE evento_senha
  ADD CONSTRAINT fk_evento_senha_senha_emitida_id FOREIGN KEY (senha_emitida_id) REFERENCES senha_emitida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_senha_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_senha_acao_fluxo_senha_id FOREIGN KEY (acao_fluxo_senha_id) REFERENCES acao_fluxo_senha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_senha_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_senha_guiche_recepcao_id FOREIGN KEY (guiche_recepcao_id) REFERENCES guiche_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_senha_destino_local_atendimento_id FOREIGN KEY (destino_local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE atendimento
  ADD CONSTRAINT fk_atendimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_forma_atendimento_id FOREIGN KEY (forma_atendimento_id) REFERENCES forma_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_origem_entrada_atendimento_id FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_procedencia_id FOREIGN KEY (procedencia_id) REFERENCES procedencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_grupo_atendimento_id FOREIGN KEY (grupo_atendimento_id) REFERENCES grupo_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_motivo_procura_atendimento_id FOREIGN KEY (motivo_procura_atendimento_id) REFERENCES motivo_procura_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_clinica_assistencial_id FOREIGN KEY (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_teleconsulta_id FOREIGN KEY (teleconsulta_id) REFERENCES teleconsulta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_pai_atendimento_id FOREIGN KEY (pai_atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_cid_principal_termo_terminologia_id FOREIGN KEY (cid_principal_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_cid_secundario_termo_terminologia_id FOREIGN KEY (cid_secundario_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_indicador_acidente_termo_terminologia_id FOREIGN KEY (indicador_acidente_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_cobertura_especial_termo_terminologia_id FOREIGN KEY (cobertura_especial_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_saude_ocupacional_termo_terminologia_id FOREIGN KEY (saude_ocupacional_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_motivo_encerramento_atendimento_id FOREIGN KEY (motivo_encerramento_atendimento_id) REFERENCES motivo_encerramento_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_alta_profissional_id FOREIGN KEY (alta_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_responsavel_grau_parentesco_dependente_id FOREIGN KEY (responsavel_grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_conta
  ADD CONSTRAINT fk_atendimento_conta_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_conta_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_senha
  ADD CONSTRAINT fk_atendimento_senha_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_senha_senha_emitida_id FOREIGN KEY (senha_emitida_id) REFERENCES senha_emitida (id) ON DELETE RESTRICT;
ALTER TABLE cobertura_atendimento
  ADD CONSTRAINT fk_cobertura_atendimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_atendimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_atendimento_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_atendimento_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_atendimento_titular_cobertura_id FOREIGN KEY (titular_cobertura_id) REFERENCES titular_cobertura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_atendimento_identificacao_beneficiario_ter_ac45c00b FOREIGN KEY (identificacao_beneficiario_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_atendimento_ausencia_validacao_termo_termi_269833b5 FOREIGN KEY (ausencia_validacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_procedimento
  ADD CONSTRAINT fk_atendimento_procedimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_procedimento_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_procedimento_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_pendencia
  ADD CONSTRAINT fk_atendimento_pendencia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_pendencia_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_pendencia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_pendencia_pai_atendimento_pendencia_id FOREIGN KEY (pai_atendimento_pendencia_id) REFERENCES atendimento_pendencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_pendencia_pendencia_id FOREIGN KEY (pendencia_id) REFERENCES pendencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_pendencia_baixada_usuario_id FOREIGN KEY (baixada_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_responsavel_historico
  ADD CONSTRAINT fk_atendimento_responsavel_historico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_responsavel_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_responsavel_historico_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_responsavel_historico_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_responsavel_historico_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_responsavel_historico_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_situacao_historico
  ADD CONSTRAINT fk_atendimento_situacao_historico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_situacao_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_situacao_historico_motivo_encerramento_a_1cb82d02 FOREIGN KEY (motivo_encerramento_atendimento_id) REFERENCES motivo_encerramento_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_situacao_historico_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_situacao_historico_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_atendimento
  ADD CONSTRAINT fk_cancelamento_atendimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_atendimento_motivo_cancelamento_operacao_id FOREIGN KEY (motivo_cancelamento_operacao_id) REFERENCES motivo_cancelamento_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_atendimento_modulo_recepcao_id FOREIGN KEY (modulo_recepcao_id) REFERENCES modulo_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_atendimento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_atendimento_revertido_usuario_id FOREIGN KEY (revertido_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE chamada_painel
  ADD CONSTRAINT fk_chamada_painel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamada_painel_painel_chamada_id FOREIGN KEY (painel_chamada_id) REFERENCES painel_chamada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamada_painel_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamada_painel_guiche_recepcao_id FOREIGN KEY (guiche_recepcao_id) REFERENCES guiche_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamada_painel_senha_emitida_id FOREIGN KEY (senha_emitida_id) REFERENCES senha_emitida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamada_painel_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamada_painel_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE contato_ativo
  ADD CONSTRAINT fk_contato_ativo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_ativo_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_ativo_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_ativo_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_ativo_anterior_contato_ativo_id FOREIGN KEY (anterior_contato_ativo_id) REFERENCES contato_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_ativo_resultado_contato_id FOREIGN KEY (resultado_contato_id) REFERENCES resultado_contato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_ativo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_ativo_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_comparecimento
  ADD CONSTRAINT fk_declaracao_comparecimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_comparecimento_acompanhante_tipo_document_c1646cf5 FOREIGN KEY (acompanhante_tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_comparecimento_emitida_usuario_id FOREIGN KEY (emitida_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_comparecimento_documento_emitido_id FOREIGN KEY (documento_emitido_id) REFERENCES documento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_comparecimento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE motivo_cancelamento_operacao_escopo
  ADD CONSTRAINT fk_motivo_cancelamento_operacao_escopo_motivo_cancelame_13010006 FOREIGN KEY (motivo_cancelamento_operacao_id) REFERENCES motivo_cancelamento_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motivo_cancelamento_operacao_escopo_modulo_recepcao_id FOREIGN KEY (modulo_recepcao_id) REFERENCES modulo_recepcao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_ficha_impressa
  ADD CONSTRAINT fk_modelo_ficha_impressa_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT;
ALTER TABLE regra_impressao_ficha
  ADD CONSTRAINT fk_regra_impressao_ficha_modelo_ficha_impressa_id FOREIGN KEY (modelo_ficha_impressa_id) REFERENCES modelo_ficha_impressa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_impressao_ficha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_impressao_ficha_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_impressao_ficha_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_impressao_ficha_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_impressao_ficha_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_impressao_ficha_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_impressao_ficha_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT;
ALTER TABLE regra_atendimento_fonte_pagadora
  ADD CONSTRAINT fk_regra_atendimento_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_atendimento_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_atendimento_fonte_pagadora_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_atendimento_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_exigencia_autorizacao
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_tipo_senha_autorizacao_id FOREIGN KEY (tipo_senha_autorizacao_id) REFERENCES tipo_senha_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_servico_atendimento_id FOREIGN KEY (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_exigencia_autorizacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_heranca_campo
  ADD CONSTRAINT fk_regra_heranca_campo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_heranca_campo_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_heranca_campo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_origem_atendimento
  ADD CONSTRAINT fk_regra_origem_atendimento_origem_entrada_atendimento_id FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_origem_atendimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_origem_atendimento_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_origem_atendimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_origem_atendimento_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
