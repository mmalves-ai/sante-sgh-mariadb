-- Lote 13_SUS-01 (módulo SUS, 45 tabelas). ADR 0002, parte 2.
-- Chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE afericao_meta_sus
  ADD CONSTRAINT fk_afericao_meta_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_meta_sus_meta_contratual_sus_id FOREIGN KEY (meta_contratual_sus_id) REFERENCES meta_contratual_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_meta_sus_tipo_afericao_dominio_contratualiz_33810856 FOREIGN KEY (tipo_afericao_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_meta_sus_escore_dominio_contratualizacao_sus_id FOREIGN KEY (escore_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afericao_meta_sus_validada_por_usuario_id FOREIGN KEY (validada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apac
  ADD CONSTRAINT fk_apac_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_autorizacao_apac_id FOREIGN KEY (autorizacao_apac_id) REFERENCES autorizacao_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_anterior_apac_id FOREIGN KEY (anterior_apac_id) REFERENCES apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_principal_procedimento_sigtap_id FOREIGN KEY (principal_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_motivo_saida_dominio_sigtap_id FOREIGN KEY (motivo_saida_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_remessa_apac_id FOREIGN KEY (remessa_apac_id) REFERENCES remessa_apac (id) ON DELETE RESTRICT;
ALTER TABLE apac_procedimento
  ADD CONSTRAINT fk_apac_procedimento_apac_id FOREIGN KEY (apac_id) REFERENCES apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_procedimento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_procedimento_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_procedimento_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_procedimento_servico_classificacao_sigtap_id FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE apac_sessao
  ADD CONSTRAINT fk_apac_sessao_apac_id FOREIGN KEY (apac_id) REFERENCES apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_sessao_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_sessao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_sessao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apac_sessao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_apac
  ADD CONSTRAINT fk_autorizacao_apac_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_apac_laudo_apac_id FOREIGN KEY (laudo_apac_id) REFERENCES laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_apac_faixa_numeracao_aih_id FOREIGN KEY (faixa_numeracao_aih_id) REFERENCES faixa_numeracao_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_apac_autorizador_sus_id FOREIGN KEY (autorizador_sus_id) REFERENCES autorizador_sus (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_internacao_sus
  ADD CONSTRAINT fk_autorizacao_internacao_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_laudo_internacao_sus_id FOREIGN KEY (laudo_internacao_sus_id) REFERENCES laudo_internacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_faixa_numeracao_aih_id FOREIGN KEY (faixa_numeracao_aih_id) REFERENCES faixa_numeracao_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_autorizador_sus_id FOREIGN KEY (autorizador_sus_id) REFERENCES autorizador_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_solicitado_procedimento_sigtap_id FOREIGN KEY (solicitado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_autorizado_procedimento_sigtap_id FOREIGN KEY (autorizado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_carater_dominio_sus_id FOREIGN KEY (carater_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_internacao_sus_recebida_por_usuario_id FOREIGN KEY (recebida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_servico_sus_paciente
  ADD CONSTRAINT fk_autorizacao_servico_sus_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_servico_sus_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_servico_sus_paciente_servico_classificac_a35f5779 FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_servico_sus_paciente_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE autorizador_sus
  ADD CONSTRAINT fk_autorizador_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizador_sus_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizador_sus_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE compatibilidade_sigtap
  ADD CONSTRAINT fk_compatibilidade_sigtap_principal_procedimento_sigtap_id FOREIGN KEY (principal_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_sigtap_principal_instrumento_dominio_35e999cb FOREIGN KEY (principal_instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_sigtap_compativel_procedimento_sigtap_id FOREIGN KEY (compativel_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_sigtap_compativel_instrumento_domini_630ac84f FOREIGN KEY (compativel_instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE competencia_sigtap
  ADD CONSTRAINT fk_competencia_sigtap_carregada_por_usuario_id FOREIGN KEY (carregada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_sigtap_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE competencia_sus
  ADD CONSTRAINT fk_competencia_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_sus_competencia_sigtap_id FOREIGN KEY (competencia_sigtap_id) REFERENCES competencia_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_sus_aberta_por_usuario_id FOREIGN KEY (aberta_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_sus_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_sus_reaberta_por_usuario_id FOREIGN KEY (reaberta_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih
  ADD CONSTRAINT fk_conta_aih_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_autorizacao_internacao_sus_id FOREIGN KEY (autorizacao_internacao_sus_id) REFERENCES autorizacao_internacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_anterior_conta_aih_id FOREIGN KEY (anterior_conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_carater_dominio_sus_id FOREIGN KEY (carater_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_motivo_saida_dominio_sus_id FOREIGN KEY (motivo_saida_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_tipo_leito_dominio_sigtap_id FOREIGN KEY (tipo_leito_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_solicitado_procedimento_sigtap_id FOREIGN KEY (solicitado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_realizado_procedimento_sigtap_id FOREIGN KEY (realizado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_autorizador_sus_id FOREIGN KEY (autorizador_sus_id) REFERENCES autorizador_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_contraceptivo_anterior_dominio_sus_id FOREIGN KEY (contraceptivo_anterior_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_contraceptivo_atual_dominio_sus_id FOREIGN KEY (contraceptivo_atual_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_remessa_sisaih_id FOREIGN KEY (remessa_sisaih_id) REFERENCES remessa_sisaih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih_diagnostico
  ADD CONSTRAINT fk_conta_aih_diagnostico_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih_incremento
  ADD CONSTRAINT fk_conta_aih_incremento_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_incremento_habilitacao_sigtap_id FOREIGN KEY (habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_incremento_conta_aih_procedimento_id FOREIGN KEY (conta_aih_procedimento_id) REFERENCES conta_aih_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_incremento_conta_aih_profissional_id FOREIGN KEY (conta_aih_profissional_id) REFERENCES conta_aih_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_incremento_incentivo_contratual_sus_id FOREIGN KEY (incentivo_contratual_sus_id) REFERENCES incentivo_contratual_sus (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih_opm
  ADD CONSTRAINT fk_conta_aih_opm_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_opm_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_opm_conta_aih_procedimento_id FOREIGN KEY (conta_aih_procedimento_id) REFERENCES conta_aih_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_opm_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_opm_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_opm_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih_procedimento
  ADD CONSTRAINT fk_conta_aih_procedimento_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_procedimento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_procedimento_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_procedimento_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_procedimento_servico_classificacao_sigtap_id FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_procedimento_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih_profissional
  ADD CONSTRAINT fk_conta_aih_profissional_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_profissional_conta_aih_procedimento_id FOREIGN KEY (conta_aih_procedimento_id) REFERENCES conta_aih_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_profissional_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_profissional_atividade_dominio_sus_id FOREIGN KEY (atividade_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_profissional_credor_dominio_sus_id FOREIGN KEY (credor_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih_registro_civil
  ADD CONSTRAINT fk_conta_aih_registro_civil_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_registro_civil_declaracao_nascido_vivo_id FOREIGN KEY (declaracao_nascido_vivo_id) REFERENCES declaracao_nascido_vivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_aih_registro_civil_cartorio_registro_civil_id FOREIGN KEY (cartorio_registro_civil_id) REFERENCES cartorio_registro_civil (id) ON DELETE RESTRICT;
ALTER TABLE contrato_gestor_sus
  ADD CONSTRAINT fk_contrato_gestor_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_esfera_dominio_contratualizacao_sus_id FOREIGN KEY (esfera_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_rede_assistencial_dominio_contra_1954d2d8 FOREIGN KEY (rede_assistencial_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE contrato_gestor_sus_orcamento
  ADD CONSTRAINT fk_contrato_gestor_sus_orcamento_contrato_gestor_sus_id FOREIGN KEY (contrato_gestor_sus_id) REFERENCES contrato_gestor_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_orcamento_componente_dominio_con_52e0a623 FOREIGN KEY (componente_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_orcamento_complexidade_dominio_c_769e6ad3 FOREIGN KEY (complexidade_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contrato_gestor_sus_orcamento_incentivo_contratual_sus_id FOREIGN KEY (incentivo_contratual_sus_id) REFERENCES incentivo_contratual_sus (id) ON DELETE RESTRICT;
ALTER TABLE cota_procedimento_sus
  ADD CONSTRAINT fk_cota_procedimento_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_procedimento_sus_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_procedimento_sus_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_procedimento_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_procedimento_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE critica_ciha
  ADD CONSTRAINT fk_critica_ciha_registro_ciha_id FOREIGN KEY (registro_ciha_id) REFERENCES registro_ciha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_ciha_regra_critica_sus_id FOREIGN KEY (regra_critica_sus_id) REFERENCES regra_critica_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_ciha_tratada_por_usuario_id FOREIGN KEY (tratada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE critica_sus
  ADD CONSTRAINT fk_critica_sus_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_apac_id FOREIGN KEY (apac_id) REFERENCES apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_laudo_apac_id FOREIGN KEY (laudo_apac_id) REFERENCES laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_producao_ambulatorial_sus_item_id FOREIGN KEY (producao_ambulatorial_sus_item_id) REFERENCES producao_ambulatorial_sus_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_registro_raas_id FOREIGN KEY (registro_raas_id) REFERENCES registro_raas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_regra_critica_sus_id FOREIGN KEY (regra_critica_sus_id) REFERENCES regra_critica_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_sus_tratada_por_usuario_id FOREIGN KEY (tratada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE descarte_producao_sus
  ADD CONSTRAINT fk_descarte_producao_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descarte_producao_sus_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descarte_producao_sus_conta_aih_procedimento_id FOREIGN KEY (conta_aih_procedimento_id) REFERENCES conta_aih_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descarte_producao_sus_apac_id FOREIGN KEY (apac_id) REFERENCES apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descarte_producao_sus_apac_procedimento_id FOREIGN KEY (apac_procedimento_id) REFERENCES apac_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descarte_producao_sus_producao_ambulatorial_sus_item_id FOREIGN KEY (producao_ambulatorial_sus_item_id) REFERENCES producao_ambulatorial_sus_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descarte_producao_sus_motivo_descarte_sus_id FOREIGN KEY (motivo_descarte_sus_id) REFERENCES motivo_descarte_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descarte_producao_sus_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE diaria_uti_sus
  ADD CONSTRAINT fk_diaria_uti_sus_conta_aih_id FOREIGN KEY (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_uti_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_uti_sus_leito_uti_habilitado_id FOREIGN KEY (leito_uti_habilitado_id) REFERENCES leito_uti_habilitado (id) ON DELETE RESTRICT;
ALTER TABLE dominio_sigtap
  ADD CONSTRAINT fk_dominio_sigtap_pai_dominio_sigtap_id FOREIGN KEY (pai_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE dominio_sus
  ADD CONSTRAINT fk_dominio_sus_pai_dominio_sus_id FOREIGN KEY (pai_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_cid_ciha
  ADD CONSTRAINT fk_equivalencia_cid_ciha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_sigtap_item
  ADD CONSTRAINT fk_equivalencia_sigtap_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_sigtap_item_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE faixa_numeracao_aih
  ADD CONSTRAINT fk_faixa_numeracao_aih_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_numeracao_aih_recebida_por_usuario_id FOREIGN KEY (recebida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_numeracao_aih_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE grupo_procedimento_contrato_sus
  ADD CONSTRAINT fk_grupo_procedimento_contrato_sus_meta_contratual_sus_id FOREIGN KEY (meta_contratual_sus_id) REFERENCES meta_contratual_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_procedimento_contrato_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_procedimento_contrato_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE grupo_sigtap
  ADD CONSTRAINT fk_grupo_sigtap_pai_grupo_sigtap_id FOREIGN KEY (pai_grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE habilitacao_sigtap
  ADD CONSTRAINT fk_habilitacao_sigtap_grupo_habilitacao_sigtap_id FOREIGN KEY (grupo_habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE incentivo_contratual_sus
  ADD CONSTRAINT fk_incentivo_contratual_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incentivo_contratual_sus_contrato_gestor_sus_id FOREIGN KEY (contrato_gestor_sus_id) REFERENCES contrato_gestor_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incentivo_contratual_sus_tipo_dado_dominio_contratua_c8278658 FOREIGN KEY (tipo_dado_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incentivo_contratual_sus_habilitacao_sigtap_id FOREIGN KEY (habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incentivo_contratual_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incentivo_contratual_sus_carater_dominio_sus_id FOREIGN KEY (carater_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT;
ALTER TABLE indicador_contratual_sus
  ADD CONSTRAINT fk_indicador_contratual_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_contratual_sus_contrato_gestor_sus_id FOREIGN KEY (contrato_gestor_sus_id) REFERENCES contrato_gestor_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_contratual_sus_tipo_indicador_dominio_cont_a3236b17 FOREIGN KEY (tipo_indicador_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_contratual_sus_tipo_dado_dominio_contratua_a0d567d6 FOREIGN KEY (tipo_dado_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_contratual_sus_periodicidade_dominio_contr_b52480d6 FOREIGN KEY (periodicidade_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT;
ALTER TABLE indicador_contratual_sus_item
  ADD CONSTRAINT fk_indicador_contratual_sus_item_indicador_contratual_sus_id FOREIGN KEY (indicador_contratual_sus_id) REFERENCES indicador_contratual_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_contratual_sus_item_tipo_item_dominio_cont_ebca6f67 FOREIGN KEY (tipo_item_dominio_contratualizacao_sus_id) REFERENCES dominio_contratualizacao_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_contratual_sus_item_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_contratual_sus_item_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE inscricao_transplante
  ADD CONSTRAINT fk_inscricao_transplante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_transplante_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_transplante_orgao_transplante_id FOREIGN KEY (orgao_transplante_id) REFERENCES orgao_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_transplante_notificacao_doador_id FOREIGN KEY (notificacao_doador_id) REFERENCES notificacao_doador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_transplante_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE inscricao_transplante_historico
  ADD CONSTRAINT fk_inscricao_transplante_historico_inscricao_transplante_id FOREIGN KEY (inscricao_transplante_id) REFERENCES inscricao_transplante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_transplante_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE laudo_apac
  ADD CONSTRAINT fk_laudo_apac_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_tipo_laudo_apac_id FOREIGN KEY (tipo_laudo_apac_id) REFERENCES tipo_laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_lote_laudo_sus_id FOREIGN KEY (lote_laudo_sus_id) REFERENCES lote_laudo_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_solicitado_procedimento_sigtap_id FOREIGN KEY (solicitado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_carater_dominio_sus_id FOREIGN KEY (carater_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_solicitante_ocupacao_cbo_id FOREIGN KEY (solicitante_ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE laudo_apac_auditiva
  ADD CONSTRAINT fk_laudo_apac_auditiva_laudo_apac_id FOREIGN KEY (laudo_apac_id) REFERENCES laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_auditiva_justificativa_dominio_sus_id FOREIGN KEY (justificativa_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT;
ALTER TABLE laudo_apac_medicamento
  ADD CONSTRAINT fk_laudo_apac_medicamento_laudo_apac_id FOREIGN KEY (laudo_apac_id) REFERENCES laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_medicamento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE laudo_apac_nefrologia
  ADD CONSTRAINT fk_laudo_apac_nefrologia_laudo_apac_id FOREIGN KEY (laudo_apac_id) REFERENCES laudo_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_nefrologia_caracteristica_tratamento_domi_67c078d5 FOREIGN KEY (caracteristica_tratamento_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_nefrologia_acesso_vascular_dominio_sus_id FOREIGN KEY (acesso_vascular_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_nefrologia_situacao_transplante_dominio_sus_id FOREIGN KEY (situacao_transplante_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_apac_nefrologia_contraindicacao_transplante_do_00b7ad6f FOREIGN KEY (contraindicacao_transplante_dominio_sus_id) REFERENCES dominio_sus (id) ON DELETE RESTRICT;
ALTER TABLE laudo_apac_odontologia
  ADD CONSTRAINT fk_laudo_apac_odontologia_laudo_apac_id FOREIGN KEY (laudo_apac_id) REFERENCES laudo_apac (id) ON DELETE RESTRICT;
