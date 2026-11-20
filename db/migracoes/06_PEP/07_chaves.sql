-- Módulo PEP, lote 07: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE modelo_receita_item
  ADD CONSTRAINT fk_modelo_receita_item_modelo_receita_id FOREIGN KEY (modelo_receita_id) REFERENCES modelo_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_item_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_item_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_receita_item_unidade_duracao_tratamento_id FOREIGN KEY (unidade_duracao_tratamento_id) REFERENCES unidade_duracao_tratamento (id) ON DELETE RESTRICT;
ALTER TABLE modelo_regra
  ADD CONSTRAINT fk_modelo_regra_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_regra_alvo_modelo_campo_id FOREIGN KEY (alvo_modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_regra_alvo_modelo_secao_id FOREIGN KEY (alvo_modelo_secao_id) REFERENCES modelo_secao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_secao
  ADD CONSTRAINT fk_modelo_secao_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_secao_secao_pai_modelo_secao_id FOREIGN KEY (secao_pai_modelo_secao_id) REFERENCES modelo_secao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_setor
  ADD CONSTRAINT fk_modelo_setor_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE monitorizacao_paciente
  ADD CONSTRAINT fk_monitorizacao_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_monitorizacao_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_monitorizacao_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_monitorizacao_paciente_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_monitorizacao_paciente_equipamento_saude_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT;
ALTER TABLE motivo_nao_adesao_protocolo
  ADD CONSTRAINT fk_motivo_nao_adesao_protocolo_protocolo_gerenciado_id FOREIGN KEY (protocolo_gerenciado_id) REFERENCES protocolo_gerenciado (id) ON DELETE RESTRICT;
ALTER TABLE motivo_nao_administracao
  ADD CONSTRAINT fk_motivo_nao_administracao_motivo_devolucao_estoque_id FOREIGN KEY (motivo_devolucao_estoque_id) REFERENCES motivo_devolucao_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motivo_nao_administracao_motivo_baixa_estoque_id FOREIGN KEY (motivo_baixa_estoque_id) REFERENCES motivo_baixa_estoque (id) ON DELETE RESTRICT;
ALTER TABLE motivo_registro_fluxo_oncologico_categoria
  ADD CONSTRAINT fk_motivo_registro_fluxo_oncologico_categoria_motivo_re_def5e8c1 FOREIGN KEY (motivo_registro_fluxo_oncologico_id) REFERENCES motivo_registro_fluxo_oncologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motivo_registro_fluxo_oncologico_categoria_categoria_45b2963f FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT;
ALTER TABLE nivel_prioridade_protocolo
  ADD CONSTRAINT fk_nivel_prioridade_protocolo_protocolo_classificacao_r_e3d81db8 FOREIGN KEY (protocolo_classificacao_risco_versao_id) REFERENCES protocolo_classificacao_risco_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nivel_prioridade_protocolo_nivel_prioridade_id FOREIGN KEY (nivel_prioridade_id) REFERENCES nivel_prioridade (id) ON DELETE RESTRICT;
ALTER TABLE nota_paciente
  ADD CONSTRAINT fk_nota_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_paciente_tipo_nota_paciente_id FOREIGN KEY (tipo_nota_paciente_id) REFERENCES tipo_nota_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_paciente_nota_predefinida_id FOREIGN KEY (nota_predefinida_id) REFERENCES nota_predefinida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_paciente_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_paciente_autor_profissional_id FOREIGN KEY (autor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_paciente_cancelada_profissional_id FOREIGN KEY (cancelada_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE nota_predefinida
  ADD CONSTRAINT fk_nota_predefinida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_predefinida_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE nota_soap
  ADD CONSTRAINT fk_nota_soap_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_soap_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_soap_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_soap_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_soap_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE nota_soap_codigo
  ADD CONSTRAINT fk_nota_soap_codigo_nota_soap_id FOREIGN KEY (nota_soap_id) REFERENCES nota_soap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_soap_codigo_ciap_termo_terminologia_id FOREIGN KEY (ciap_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_soap_codigo_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_soap_codigo_problema_paciente_id FOREIGN KEY (problema_paciente_id) REFERENCES problema_paciente (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_agravo
  ADD CONSTRAINT fk_notificacao_agravo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_agravo_notificavel_id FOREIGN KEY (agravo_notificavel_id) REFERENCES agravo_notificavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_tipo_notificacao_agravo_id FOREIGN KEY (tipo_notificacao_agravo_id) REFERENCES tipo_notificacao_agravo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_notificante_profissional_id FOREIGN KEY (notificante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_agravo_resposta
  ADD CONSTRAINT fk_notificacao_agravo_resposta_notificacao_agravo_id FOREIGN KEY (notificacao_agravo_id) REFERENCES notificacao_agravo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_notificacao_agravo_resposta_agravo_pergunta_id FOREIGN KEY (agravo_pergunta_id) REFERENCES agravo_pergunta (id) ON DELETE RESTRICT;
ALTER TABLE orientacao_saude
  ADD CONSTRAINT fk_orientacao_saude_programa_cuidado_id FOREIGN KEY (programa_cuidado_id) REFERENCES programa_cuidado (id) ON DELETE RESTRICT;
ALTER TABLE paciente_acompanhado
  ADD CONSTRAINT fk_paciente_acompanhado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_acompanhado_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_acompanhado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_acompanhado_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE painel_filtro_usuario
  ADD CONSTRAINT fk_painel_filtro_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_filtro_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_filtro_usuario_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_filtro_usuario_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_filtro_usuario_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_filtro_usuario_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_filtro_usuario_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_filtro_usuario_classificacao_filtro_painel_id FOREIGN KEY (classificacao_filtro_painel_id) REFERENCES classificacao_filtro_painel (id) ON DELETE RESTRICT;
ALTER TABLE painel_coluna_usuario
  ADD CONSTRAINT fk_painel_coluna_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_coluna_usuario_painel_filtro_usuario_id FOREIGN KEY (painel_filtro_usuario_id) REFERENCES painel_filtro_usuario (id) ON DELETE RESTRICT;
ALTER TABLE painel_resultado_grupo_exame
  ADD CONSTRAINT fk_painel_resultado_grupo_exame_painel_resultado_grupo_id FOREIGN KEY (painel_resultado_grupo_id) REFERENCES painel_resultado_grupo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resultado_grupo_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resultado_grupo_exame_exame_analito_id FOREIGN KEY (exame_analito_id) REFERENCES exame_analito (id) ON DELETE RESTRICT;
ALTER TABLE painel_resumo_clinico
  ADD CONSTRAINT fk_painel_resumo_clinico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_categoria_profissional_id FOREIGN KEY (categoria_profissional_id) REFERENCES categoria_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE painel_resumo_clinico_grupo
  ADD CONSTRAINT fk_painel_resumo_clinico_grupo_painel_resumo_clinico_id FOREIGN KEY (painel_resumo_clinico_id) REFERENCES painel_resumo_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_grupo_tipo_grupo_painel_resumo_0965828b FOREIGN KEY (tipo_grupo_painel_resumo_clinico_id) REFERENCES tipo_grupo_painel_resumo_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_grupo_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE painel_resumo_clinico_item
  ADD CONSTRAINT fk_painel_resumo_clinico_item_painel_resumo_clinico_grupo_id FOREIGN KEY (painel_resumo_clinico_grupo_id) REFERENCES painel_resumo_clinico_grupo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_item_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_item_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_item_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_item_formula_calculo_dose_id FOREIGN KEY (formula_calculo_dose_id) REFERENCES formula_calculo_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_item_grupo_balanco_hidrico_id FOREIGN KEY (grupo_balanco_hidrico_id) REFERENCES grupo_balanco_hidrico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_resumo_clinico_item_tipo_ganho_perda_id FOREIGN KEY (tipo_ganho_perda_id) REFERENCES tipo_ganho_perda (id) ON DELETE RESTRICT;
ALTER TABLE parametro_clinico_item
  ADD CONSTRAINT fk_parametro_clinico_item_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_clinico_item_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_clinico_item_tipo_validacao_dose_id FOREIGN KEY (tipo_validacao_dose_id) REFERENCES tipo_validacao_dose (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_clinico_item_diluente_item_prescritivel_id FOREIGN KEY (diluente_item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;
ALTER TABLE parametro_vital
  ADD CONSTRAINT fk_parametro_vital_grupo_parametro_vital_id FOREIGN KEY (grupo_parametro_vital_id) REFERENCES grupo_parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_vital_escala_clinica_id FOREIGN KEY (escala_clinica_id) REFERENCES escala_clinica (id) ON DELETE RESTRICT;
ALTER TABLE parametro_vital_local_afericao
  ADD CONSTRAINT fk_parametro_vital_local_afericao_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_vital_local_afericao_local_afericao_id FOREIGN KEY (local_afericao_id) REFERENCES local_afericao (id) ON DELETE RESTRICT;
