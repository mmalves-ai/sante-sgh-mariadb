-- RH, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)

ALTER TABLE acionamento_sobreaviso
  ADD CONSTRAINT fk_acionamento_sobreaviso_plantao_id FOREIGN KEY (plantao_id) REFERENCES plantao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_sobreaviso_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_sobreaviso_acionado_por_usuario_id FOREIGN KEY (acionado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionamento_sobreaviso_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE afastamento
  ADD CONSTRAINT fk_afastamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_motivo_afastamento_id FOREIGN KEY (motivo_afastamento_id) REFERENCES motivo_afastamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_motivo_codigo_esocial_id FOREIGN KEY (motivo_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_emitente_profissional_id FOREIGN KEY (emitente_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_atestado_arquivo_id FOREIGN KEY (atestado_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_comunicacao_acidente_id FOREIGN KEY (comunicacao_acidente_id) REFERENCES comunicacao_acidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_afastamento_anterior_id FOREIGN KEY (afastamento_anterior_id) REFERENCES afastamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_afastamento_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_ponto
  ADD CONSTRAINT fk_ajuste_ponto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_ponto_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_ponto_marcacao_ponto_id FOREIGN KEY (marcacao_ponto_id) REFERENCES marcacao_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_ponto_classificacao_marcacao_id FOREIGN KEY (classificacao_marcacao_id) REFERENCES classificacao_marcacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_ponto_justificativa_ponto_id FOREIGN KEY (justificativa_ponto_id) REFERENCES justificativa_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_ponto_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_ponto_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aliquota_rat_cnae
  ADD CONSTRAINT fk_aliquota_rat_cnae_atividade_economica_id FOREIGN KEY (atividade_economica_id) REFERENCES atividade_economica (id) ON DELETE RESTRICT;
ALTER TABLE aliquota_rat_estabelecimento
  ADD CONSTRAINT fk_aliquota_rat_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_rat_estabelecimento_rat_processo_tributario_id FOREIGN KEY (rat_processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aliquota_rat_estabelecimento_fap_processo_tributario_id FOREIGN KEY (fap_processo_tributario_id) REFERENCES processo_tributario (id) ON DELETE RESTRICT;
ALTER TABLE aliquota_terceiros
  ADD CONSTRAINT fk_aliquota_terceiros_fpas_id FOREIGN KEY (fpas_id) REFERENCES fpas (id) ON DELETE RESTRICT;
ALTER TABLE alocacao_escala
  ADD CONSTRAINT fk_alocacao_escala_escala_id FOREIGN KEY (escala_id) REFERENCES escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alocacao_escala_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alocacao_escala_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alocacao_escala_horario_jornada_id FOREIGN KEY (horario_jornada_id) REFERENCES horario_jornada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alocacao_escala_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alocacao_escala_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT;
ALTER TABLE ambiente_trabalho
  ADD CONSTRAINT fk_ambiente_trabalho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ambiente_trabalho_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ambiente_trabalho_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ambiente_trabalho_responsavel_colaborador_id FOREIGN KEY (responsavel_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_ponto
  ADD CONSTRAINT fk_apuracao_ponto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_ponto_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_ponto_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_ponto_alocacao_escala_id FOREIGN KEY (alocacao_escala_id) REFERENCES alocacao_escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_ponto_fechamento_ponto_id FOREIGN KEY (fechamento_ponto_id) REFERENCES fechamento_ponto (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_ponto_item
  ADD CONSTRAINT fk_apuracao_ponto_item_apuracao_ponto_id FOREIGN KEY (apuracao_ponto_id) REFERENCES apuracao_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_ponto_item_tipo_hora_id FOREIGN KEY (tipo_hora_id) REFERENCES tipo_hora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_ponto_item_justificativa_ponto_id FOREIGN KEY (justificativa_ponto_id) REFERENCES justificativa_ponto (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_aej
  ADD CONSTRAINT fk_arquivo_aej_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_aej_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_aej_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_obrigacao
  ADD CONSTRAINT fk_arquivo_obrigacao_obrigacao_trabalhista_id FOREIGN KEY (obrigacao_trabalhista_id) REFERENCES obrigacao_trabalhista (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_obrigacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_obrigacao_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_obrigacao_responsavel_legal_empregador_id FOREIGN KEY (responsavel_legal_empregador_id) REFERENCES responsavel_legal_empregador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_obrigacao_recibo_arquivo_id FOREIGN KEY (recibo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_ponto
  ADD CONSTRAINT fk_arquivo_ponto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_ponto_relogio_ponto_id FOREIGN KEY (relogio_ponto_id) REFERENCES relogio_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_ponto_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_ponto_importador_usuario_id FOREIGN KEY (importador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE aso
  ADD CONSTRAINT fk_aso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_prontuario_ocupacional_id FOREIGN KEY (prontuario_ocupacional_id) REFERENCES prontuario_ocupacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_programa_pcmso_id FOREIGN KEY (programa_pcmso_id) REFERENCES programa_pcmso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_medico_profissional_id FOREIGN KEY (medico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_coordenador_profissional_id FOREIGN KEY (coordenador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aso_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE assessoria_externa
  ADD CONSTRAINT fk_assessoria_externa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assessoria_externa_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_desempenho
  ADD CONSTRAINT fk_avaliacao_desempenho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_desempenho_ciclo_avaliacao_id FOREIGN KEY (ciclo_avaliacao_id) REFERENCES ciclo_avaliacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_desempenho_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_desempenho_avaliador_colaborador_id FOREIGN KEY (avaliador_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_desempenho_item
  ADD CONSTRAINT fk_avaliacao_desempenho_item_avaliacao_desempenho_id FOREIGN KEY (avaliacao_desempenho_id) REFERENCES avaliacao_desempenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_desempenho_item_criterio_avaliacao_id FOREIGN KEY (criterio_avaliacao_id) REFERENCES criterio_avaliacao (id) ON DELETE RESTRICT;
ALTER TABLE aviso_previo
  ADD CONSTRAINT fk_aviso_previo_desligamento_id FOREIGN KEY (desligamento_id) REFERENCES desligamento (id) ON DELETE RESTRICT;
ALTER TABLE beneficio
  ADD CONSTRAINT fk_beneficio_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficio_provento_rubrica_id FOREIGN KEY (provento_rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficio_desconto_rubrica_id FOREIGN KEY (desconto_rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT;
ALTER TABLE beneficio_colaborador
  ADD CONSTRAINT fk_beneficio_colaborador_beneficio_id FOREIGN KEY (beneficio_id) REFERENCES beneficio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficio_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficio_colaborador_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE cadastro_empregador
  ADD CONSTRAINT fk_cadastro_empregador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_empregador_tributaria_codigo_esocial_id FOREIGN KEY (tributaria_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_empregador_natureza_juridica_id FOREIGN KEY (natureza_juridica_id) REFERENCES natureza_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_empregador_fpas_id FOREIGN KEY (fpas_id) REFERENCES fpas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_empregador_responsavel_legal_empregador_id FOREIGN KEY (responsavel_legal_empregador_id) REFERENCES responsavel_legal_empregador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_empregador_assessoria_externa_id FOREIGN KEY (assessoria_externa_id) REFERENCES assessoria_externa (id) ON DELETE RESTRICT;
ALTER TABLE calculo_folha
  ADD CONSTRAINT fk_calculo_folha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_calculista_usuario_id FOREIGN KEY (calculista_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE calculo_folha_item
  ADD CONSTRAINT fk_calculo_folha_item_calculo_folha_id FOREIGN KEY (calculo_folha_id) REFERENCES calculo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_item_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_item_lancamento_variavel_folha_id FOREIGN KEY (lancamento_variavel_folha_id) REFERENCES lancamento_variavel_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calculo_folha_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE candidato_vaga
  ADD CONSTRAINT fk_candidato_vaga_vaga_id FOREIGN KEY (vaga_id) REFERENCES vaga (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_candidato_vaga_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_candidato_vaga_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_candidato_vaga_curriculo_arquivo_id FOREIGN KEY (curriculo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE cargo
  ADD CONSTRAINT fk_cargo_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cargo_tabela_salarial_id FOREIGN KEY (tabela_salarial_id) REFERENCES tabela_salarial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cargo_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
ALTER TABLE cessao_colaborador
  ADD CONSTRAINT fk_cessao_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cessao_colaborador_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cessao_colaborador_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ciclo_avaliacao
  ADD CONSTRAINT fk_ciclo_avaliacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_avaliacao_modelo_avaliacao_id FOREIGN KEY (modelo_avaliacao_id) REFERENCES modelo_avaliacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_avaliacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciclo_avaliacao_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT;
ALTER TABLE ciencia_procedimento
  ADD CONSTRAINT fk_ciencia_procedimento_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_procedimento_documento_qualidade_id FOREIGN KEY (documento_qualidade_id) REFERENCES documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_procedimento_documento_qualidade_versao_id FOREIGN KEY (documento_qualidade_versao_id) REFERENCES documento_qualidade_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_procedimento_turma_treinamento_id FOREIGN KEY (turma_treinamento_id) REFERENCES turma_treinamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ciencia_procedimento_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE clausula_convencao
  ADD CONSTRAINT fk_clausula_convencao_convencao_coletiva_id FOREIGN KEY (convencao_coletiva_id) REFERENCES convencao_coletiva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_clausula_convencao_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_clausula_convencao_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_clausula_convencao_beneficio_id FOREIGN KEY (beneficio_id) REFERENCES beneficio (id) ON DELETE RESTRICT;
ALTER TABLE codigo_esocial
  ADD CONSTRAINT fk_codigo_esocial_tabela_esocial_id FOREIGN KEY (tabela_esocial_id) REFERENCES tabela_esocial (id) ON DELETE RESTRICT;
ALTER TABLE colaborador
  ADD CONSTRAINT fk_colaborador_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_estado_civil_id FOREIGN KEY (estado_civil_id) REFERENCES estado_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_nascimento_pais_referencia_id FOREIGN KEY (nascimento_pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_nacionalidade_pais_referencia_id FOREIGN KEY (nacionalidade_pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_nascimento_municipio_ibge_id FOREIGN KEY (nascimento_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_colaborador_situacao_colaborador_id FOREIGN KEY (situacao_colaborador_id) REFERENCES situacao_colaborador (id) ON DELETE RESTRICT;
ALTER TABLE competencia_folha
  ADD CONSTRAINT fk_competencia_folha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_folha_tipo_folha_id FOREIGN KEY (tipo_folha_id) REFERENCES tipo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_folha_abertura_usuario_id FOREIGN KEY (abertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_folha_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_folha_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE comunicacao_acidente
  ADD CONSTRAINT fk_comunicacao_acidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_anterior_comunicacao_acidente_id FOREIGN KEY (anterior_comunicacao_acidente_id) REFERENCES comunicacao_acidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_ambiente_trabalho_id FOREIGN KEY (ambiente_trabalho_id) REFERENCES ambiente_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_local_municipio_ibge_id FOREIGN KEY (local_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_local_pais_referencia_id FOREIGN KEY (local_pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_agente_causador_codigo_esocial_id FOREIGN KEY (agente_causador_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_situacao_geradora_codigo_esocial_id FOREIGN KEY (situacao_geradora_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_parte_atingida_codigo_esocial_id FOREIGN KEY (parte_atingida_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_natureza_lesao_codigo_esocial_id FOREIGN KEY (natureza_lesao_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_medico_profissional_id FOREIGN KEY (medico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_atestado_arquivo_id FOREIGN KEY (atestado_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_emissor_usuario_id FOREIGN KEY (emissor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_esocial
  ADD CONSTRAINT fk_conciliacao_esocial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_esocial_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_esocial_totalizador_esocial_id FOREIGN KEY (totalizador_esocial_id) REFERENCES totalizador_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_esocial_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE convencao_coletiva
  ADD CONSTRAINT fk_convencao_coletiva_sindicato_id FOREIGN KEY (sindicato_id) REFERENCES sindicato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_convencao_coletiva_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE criterio_avaliacao
  ADD CONSTRAINT fk_criterio_avaliacao_modelo_avaliacao_id FOREIGN KEY (modelo_avaliacao_id) REFERENCES modelo_avaliacao (id) ON DELETE RESTRICT;
ALTER TABLE curso
  ADD CONSTRAINT fk_curso_treinamento_codigo_esocial_id FOREIGN KEY (treinamento_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT;
ALTER TABLE custo_pessoal_centro
  ADD CONSTRAINT fk_custo_pessoal_centro_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_pessoal_centro_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_pessoal_centro_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_pessoal_centro_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE deficiencia_colaborador
  ADD CONSTRAINT fk_deficiencia_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_deficiencia_colaborador_laudo_arquivo_id FOREIGN KEY (laudo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
