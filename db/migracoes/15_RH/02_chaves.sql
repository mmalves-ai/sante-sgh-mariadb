-- RH, lote 02: chaves estrangeiras (aplicadas depois de todos os tabelas.sql). Sempre ON DELETE RESTRICT.
ALTER TABLE depara_folha_financeiro
  ADD CONSTRAINT fk_depara_folha_financeiro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_folha_financeiro_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_folha_financeiro_tipo_folha_id FOREIGN KEY (tipo_folha_id) REFERENCES tipo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_folha_financeiro_natureza_financeira_id FOREIGN KEY (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_folha_financeiro_debito_conta_contabil_id FOREIGN KEY (debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_folha_financeiro_credito_conta_contabil_id FOREIGN KEY (credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_folha_financeiro_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_depara_folha_financeiro_credor_pessoa_juridica_id FOREIGN KEY (credor_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE dependente
  ADD CONSTRAINT fk_dependente_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dependente_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dependente_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dependente_tipo_dependente_codigo_esocial_id FOREIGN KEY (tipo_dependente_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dependente_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE desligamento
  ADD CONSTRAINT fk_desligamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desligamento_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desligamento_motivo_codigo_esocial_id FOREIGN KEY (motivo_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desligamento_tipo_rescisao_id FOREIGN KEY (tipo_rescisao_id) REFERENCES tipo_rescisao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desligamento_processo_trabalhista_id FOREIGN KEY (processo_trabalhista_id) REFERENCES processo_trabalhista (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_desligamento_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE dimensionamento_enfermagem
  ADD CONSTRAINT fk_dimensionamento_enfermagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dimensionamento_enfermagem_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dimensionamento_enfermagem_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dimensionamento_enfermagem_parametro_dimensionamento_id FOREIGN KEY (parametro_dimensionamento_id) REFERENCES parametro_dimensionamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dimensionamento_enfermagem_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_colaborador
  ADD CONSTRAINT fk_documento_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_colaborador_tipo_documento_identificacao_id FOREIGN KEY (tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_colaborador_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_colaborador_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_colaborador_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE emprestimo_consignado
  ADD CONSTRAINT fk_emprestimo_consignado_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_consignado_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_consignado_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT;
ALTER TABLE encargo_folha
  ADD CONSTRAINT fk_encargo_folha_calculo_folha_id FOREIGN KEY (calculo_folha_id) REFERENCES calculo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encargo_folha_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encargo_folha_tributo_folha_id FOREIGN KEY (tributo_folha_id) REFERENCES tributo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encargo_folha_aliquota_terceiros_id FOREIGN KEY (aliquota_terceiros_id) REFERENCES aliquota_terceiros (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encargo_folha_lotacao_tributaria_id FOREIGN KEY (lotacao_tributaria_id) REFERENCES lotacao_tributaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_encargo_folha_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE entrega_epi
  ADD CONSTRAINT fk_entrega_epi_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_epi_equipamento_protecao_id FOREIGN KEY (equipamento_protecao_id) REFERENCES equipamento_protecao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_epi_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_epi_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_epi_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE epi_funcao
  ADD CONSTRAINT fk_epi_funcao_equipamento_protecao_id FOREIGN KEY (equipamento_protecao_id) REFERENCES equipamento_protecao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_epi_funcao_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_epi_funcao_fator_risco_ocupacional_id FOREIGN KEY (fator_risco_ocupacional_id) REFERENCES fator_risco_ocupacional (id) ON DELETE RESTRICT;
ALTER TABLE equipamento_protecao
  ADD CONSTRAINT fk_equipamento_protecao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_protecao_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE escala
  ADD CONSTRAINT fk_escala_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_regime_jornada_id FOREIGN KEY (regime_jornada_id) REFERENCES regime_jornada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_publicada_por_usuario_id FOREIGN KEY (publicada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE estabilidade_colaborador
  ADD CONSTRAINT fk_estabilidade_colaborador_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabilidade_colaborador_afastamento_id FOREIGN KEY (afastamento_id) REFERENCES afastamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabilidade_colaborador_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE estagio_colaborador
  ADD CONSTRAINT fk_estagio_colaborador_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estagio_colaborador_instituicao_ensino_id FOREIGN KEY (instituicao_ensino_id) REFERENCES instituicao_ensino (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estagio_colaborador_agente_integracao_pessoa_juridica_id FOREIGN KEY (agente_integracao_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estagio_colaborador_supervisor_colaborador_id FOREIGN KEY (supervisor_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estagio_colaborador_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE estrangeiro_colaborador
  ADD CONSTRAINT fk_estrangeiro_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estrangeiro_colaborador_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE evento_esocial
  ADD CONSTRAINT fk_evento_esocial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_esocial_tipo_evento_esocial_id FOREIGN KEY (tipo_evento_esocial_id) REFERENCES tipo_evento_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_esocial_leiaute_esocial_id FOREIGN KEY (leiaute_esocial_id) REFERENCES leiaute_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_esocial_cadastro_empregador_id FOREIGN KEY (cadastro_empregador_id) REFERENCES cadastro_empregador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_esocial_lote_esocial_id FOREIGN KEY (lote_esocial_id) REFERENCES lote_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_esocial_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_esocial_trabalhador_sem_vinculo_id FOREIGN KEY (trabalhador_sem_vinculo_id) REFERENCES trabalhador_sem_vinculo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_esocial_evento_retificado_id FOREIGN KEY (evento_retificado_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE exame_ocupacional
  ADD CONSTRAINT fk_exame_ocupacional_aso_id FOREIGN KEY (aso_id) REFERENCES aso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_ocupacional_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_ocupacional_procedimento_codigo_esocial_id FOREIGN KEY (procedimento_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_ocupacional_indicador_biologico_id FOREIGN KEY (indicador_biologico_id) REFERENCES indicador_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_ocupacional_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_ocupacional_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE exame_pcmso_funcao
  ADD CONSTRAINT fk_exame_pcmso_funcao_programa_pcmso_id FOREIGN KEY (programa_pcmso_id) REFERENCES programa_pcmso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_pcmso_funcao_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_pcmso_funcao_fator_risco_ocupacional_id FOREIGN KEY (fator_risco_ocupacional_id) REFERENCES fator_risco_ocupacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_pcmso_funcao_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_pcmso_funcao_procedimento_codigo_esocial_id FOREIGN KEY (procedimento_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT;
ALTER TABLE exposicao_biologica
  ADD CONSTRAINT fk_exposicao_biologica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exposicao_biologica_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exposicao_biologica_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exposicao_biologica_fonte_paciente_id FOREIGN KEY (fonte_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exposicao_biologica_fonte_atendimento_id FOREIGN KEY (fonte_atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exposicao_biologica_comunicacao_acidente_id FOREIGN KEY (comunicacao_acidente_id) REFERENCES comunicacao_acidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exposicao_biologica_notificacao_agravo_id FOREIGN KEY (notificacao_agravo_id) REFERENCES notificacao_agravo (id) ON DELETE RESTRICT;
ALTER TABLE faixa_salarial
  ADD CONSTRAINT fk_faixa_salarial_tabela_salarial_id FOREIGN KEY (tabela_salarial_id) REFERENCES tabela_salarial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_salarial_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT;
ALTER TABLE faixa_tabela_legal
  ADD CONSTRAINT fk_faixa_tabela_legal_tabela_legal_vigencia_id FOREIGN KEY (tabela_legal_vigencia_id) REFERENCES tabela_legal_vigencia (id) ON DELETE RESTRICT;
ALTER TABLE fator_risco_ocupacional
  ADD CONSTRAINT fk_fator_risco_ocupacional_fator_pai_id FOREIGN KEY (fator_pai_id) REFERENCES fator_risco_ocupacional (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_ponto
  ADD CONSTRAINT fk_fechamento_ponto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_ponto_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_ponto_apuracao_ponto_id FOREIGN KEY (apuracao_ponto_id) REFERENCES apuracao_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_ponto_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_ponto_espelho_arquivo_id FOREIGN KEY (espelho_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_ponto_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT;
ALTER TABLE formula_rubrica
  ADD CONSTRAINT fk_formula_rubrica_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_rubrica_tipo_referencia_rubrica_id FOREIGN KEY (tipo_referencia_rubrica_id) REFERENCES tipo_referencia_rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_rubrica_aprovada_por_usuario_id FOREIGN KEY (aprovada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_rubrica_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE funcao
  ADD CONSTRAINT fk_funcao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_funcao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE guia_fgts
  ADD CONSTRAINT fk_guia_fgts_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fgts_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fgts_cadastro_empregador_id FOREIGN KEY (cadastro_empregador_id) REFERENCES cadastro_empregador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fgts_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fgts_guia_recolhimento_id FOREIGN KEY (guia_recolhimento_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guia_fgts_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE historico_cargo
  ADD CONSTRAINT fk_historico_cargo_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historico_cargo_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historico_cargo_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historico_cargo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE historico_salarial
  ADD CONSTRAINT fk_historico_salarial_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historico_salarial_convencao_coletiva_id FOREIGN KEY (convencao_coletiva_id) REFERENCES convencao_coletiva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historico_salarial_faixa_salarial_id FOREIGN KEY (faixa_salarial_id) REFERENCES faixa_salarial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_historico_salarial_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE horario_jornada
  ADD CONSTRAINT fk_horario_jornada_regime_jornada_id FOREIGN KEY (regime_jornada_id) REFERENCES regime_jornada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_jornada_tipo_intervalo_id FOREIGN KEY (tipo_intervalo_id) REFERENCES tipo_intervalo (id) ON DELETE RESTRICT;
ALTER TABLE incidencia_rubrica
  ADD CONSTRAINT fk_incidencia_rubrica_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incidencia_rubrica_tributo_folha_id FOREIGN KEY (tributo_folha_id) REFERENCES tributo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_incidencia_rubrica_codigo_incidencia_rubrica_id FOREIGN KEY (codigo_incidencia_rubrica_id) REFERENCES codigo_incidencia_rubrica (id) ON DELETE RESTRICT;
ALTER TABLE indicador_biologico
  ADD CONSTRAINT fk_indicador_biologico_fator_risco_ocupacional_id FOREIGN KEY (fator_risco_ocupacional_id) REFERENCES fator_risco_ocupacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_biologico_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE integracao_ponto_folha
  ADD CONSTRAINT fk_integracao_ponto_folha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_integracao_ponto_folha_tipo_hora_id FOREIGN KEY (tipo_hora_id) REFERENCES tipo_hora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_integracao_ponto_folha_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT;
ALTER TABLE justificativa_ponto
  ADD CONSTRAINT fk_justificativa_ponto_abrangencia_justificativa_id FOREIGN KEY (abrangencia_justificativa_id) REFERENCES abrangencia_justificativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_ponto_tipo_hora_id FOREIGN KEY (tipo_hora_id) REFERENCES tipo_hora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_justificativa_ponto_motivo_afastamento_id FOREIGN KEY (motivo_afastamento_id) REFERENCES motivo_afastamento (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_automatico_rubrica
  ADD CONSTRAINT fk_lancamento_automatico_rubrica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_automatico_rubrica_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_automatico_rubrica_tipo_folha_id FOREIGN KEY (tipo_folha_id) REFERENCES tipo_folha (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_variavel_folha
  ADD CONSTRAINT fk_lancamento_variavel_folha_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_variavel_folha_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_variavel_folha_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_variavel_folha_tipo_folha_id FOREIGN KEY (tipo_folha_id) REFERENCES tipo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_variavel_folha_fechamento_ponto_id FOREIGN KEY (fechamento_ponto_id) REFERENCES fechamento_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_variavel_folha_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE laudo_ambiental
  ADD CONSTRAINT fk_laudo_ambiental_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_ambiental_ambiente_trabalho_id FOREIGN KEY (ambiente_trabalho_id) REFERENCES ambiente_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_ambiental_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_ambiental_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_ambiental_assessoria_externa_id FOREIGN KEY (assessoria_externa_id) REFERENCES assessoria_externa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_ambiental_laudo_substituido_id FOREIGN KEY (laudo_substituido_id) REFERENCES laudo_ambiental (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_ambiental_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE leiaute_esocial
  ADD CONSTRAINT fk_leiaute_esocial_tipo_evento_esocial_id FOREIGN KEY (tipo_evento_esocial_id) REFERENCES tipo_evento_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leiaute_esocial_esquema_arquivo_id FOREIGN KEY (esquema_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE lotacao
  ADD CONSTRAINT fk_lotacao_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_lotacao_tributaria_id FOREIGN KEY (lotacao_tributaria_id) REFERENCES lotacao_tributaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lotacao_tributaria
  ADD CONSTRAINT fk_lotacao_tributaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_tributaria_tipo_codigo_esocial_id FOREIGN KEY (tipo_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_tributaria_fpas_id FOREIGN KEY (fpas_id) REFERENCES fpas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_tributaria_aliquota_terceiros_id FOREIGN KEY (aliquota_terceiros_id) REFERENCES aliquota_terceiros (id) ON DELETE RESTRICT;
ALTER TABLE lote_esocial
  ADD CONSTRAINT fk_lote_esocial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_esocial_cadastro_empregador_id FOREIGN KEY (cadastro_empregador_id) REFERENCES cadastro_empregador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_esocial_envio_arquivo_id FOREIGN KEY (envio_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_esocial_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE lote_folha_externa
  ADD CONSTRAINT fk_lote_folha_externa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_externa_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_externa_tipo_folha_id FOREIGN KEY (tipo_folha_id) REFERENCES tipo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_externa_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_externa_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_folha_externa_item
  ADD CONSTRAINT fk_lote_folha_externa_item_lote_folha_externa_id FOREIGN KEY (lote_folha_externa_id) REFERENCES lote_folha_externa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_externa_item_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_externa_item_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_externa_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE marcacao_ponto
  ADD CONSTRAINT fk_marcacao_ponto_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_ponto_relogio_ponto_id FOREIGN KEY (relogio_ponto_id) REFERENCES relogio_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_ponto_arquivo_ponto_id FOREIGN KEY (arquivo_ponto_id) REFERENCES arquivo_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_ponto_ajuste_ponto_id FOREIGN KEY (ajuste_ponto_id) REFERENCES ajuste_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcacao_ponto_classificacao_marcacao_id FOREIGN KEY (classificacao_marcacao_id) REFERENCES classificacao_marcacao (id) ON DELETE RESTRICT;
ALTER TABLE medida_controle_risco
  ADD CONSTRAINT fk_medida_controle_risco_risco_funcao_id FOREIGN KEY (risco_funcao_id) REFERENCES risco_funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medida_controle_risco_equipamento_protecao_id FOREIGN KEY (equipamento_protecao_id) REFERENCES equipamento_protecao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_medida_controle_risco_laudo_ambiental_id FOREIGN KEY (laudo_ambiental_id) REFERENCES laudo_ambiental (id) ON DELETE RESTRICT;
