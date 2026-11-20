-- Chaves do módulo RH, lote 03 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE movimento_banco_horas
  ADD CONSTRAINT fk_movimento_banco_horas_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_banco_horas_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_banco_horas_regra_banco_horas_id FOREIGN KEY (regra_banco_horas_id) REFERENCES regra_banco_horas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_banco_horas_apuracao_ponto_id FOREIGN KEY (apuracao_ponto_id) REFERENCES apuracao_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_banco_horas_tipo_movimento_ponto_id FOREIGN KEY (tipo_movimento_ponto_id) REFERENCES tipo_movimento_ponto (id) ON DELETE RESTRICT;
ALTER TABLE obrigacao_trabalhista
  ADD CONSTRAINT fk_obrigacao_trabalhista_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_obrigacao_trabalhista_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_obrigacao_trabalhista_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_obrigacao_trabalhista_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE parametro_dimensionamento
  ADD CONSTRAINT fk_parametro_dimensionamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE parcela_decimo_terceiro
  ADD CONSTRAINT fk_parcela_decimo_terceiro_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_decimo_terceiro_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_decimo_terceiro_calculo_folha_id FOREIGN KEY (calculo_folha_id) REFERENCES calculo_folha (id) ON DELETE RESTRICT;
ALTER TABLE parcela_dimensionamento
  ADD CONSTRAINT fk_parcela_dimensionamento_dimensionamento_enfermagem_id FOREIGN KEY (dimensionamento_enfermagem_id) REFERENCES dimensionamento_enfermagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parcela_dimensionamento_parametro_dimensionamento_id FOREIGN KEY (parametro_dimensionamento_id) REFERENCES parametro_dimensionamento (id) ON DELETE RESTRICT;
ALTER TABLE pensao_alimenticia
  ADD CONSTRAINT fk_pensao_alimenticia_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pensao_alimenticia_dependente_id FOREIGN KEY (dependente_id) REFERENCES dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pensao_alimenticia_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT;
ALTER TABLE periodo_aquisitivo
  ADD CONSTRAINT fk_periodo_aquisitivo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_aquisitivo_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE plantao
  ADD CONSTRAINT fk_plantao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_escala_id FOREIGN KEY (escala_id) REFERENCES escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_revisado_por_usuario_id FOREIGN KEY (revisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE presenca_treinamento
  ADD CONSTRAINT fk_presenca_treinamento_turma_treinamento_id FOREIGN KEY (turma_treinamento_id) REFERENCES turma_treinamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_presenca_treinamento_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_presenca_treinamento_certificado_arquivo_id FOREIGN KEY (certificado_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE processo_trabalhista
  ADD CONSTRAINT fk_processo_trabalhista_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_trabalhista_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_trabalhista_trabalhador_sem_vinculo_id FOREIGN KEY (trabalhador_sem_vinculo_id) REFERENCES trabalhador_sem_vinculo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_trabalhista_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_trabalhista_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_trabalhista_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE programa_pcmso
  ADD CONSTRAINT fk_programa_pcmso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_pcmso_coordenador_profissional_id FOREIGN KEY (coordenador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_pcmso_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE programacao_ferias
  ADD CONSTRAINT fk_programacao_ferias_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_ferias_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_ferias_periodo_aquisitivo_id FOREIGN KEY (periodo_aquisitivo_id) REFERENCES periodo_aquisitivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_ferias_tipo_ferias_id FOREIGN KEY (tipo_ferias_id) REFERENCES tipo_ferias (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_ferias_solicitacao_colaborador_id FOREIGN KEY (solicitacao_colaborador_id) REFERENCES solicitacao_colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_ferias_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE prontuario_ocupacional
  ADD CONSTRAINT fk_prontuario_ocupacional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prontuario_ocupacional_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prontuario_ocupacional_programa_pcmso_id FOREIGN KEY (programa_pcmso_id) REFERENCES programa_pcmso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prontuario_ocupacional_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE provisao_ferias_decimo
  ADD CONSTRAINT fk_provisao_ferias_decimo_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_ferias_decimo_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_ferias_decimo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_provisao_ferias_decimo_lancamento_contabil_id FOREIGN KEY (lancamento_contabil_id) REFERENCES lancamento_contabil (id) ON DELETE RESTRICT;
ALTER TABLE publicacao_escala
  ADD CONSTRAINT fk_publicacao_escala_escala_id FOREIGN KEY (escala_id) REFERENCES escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_publicacao_escala_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE recibo_ferias
  ADD CONSTRAINT fk_recibo_ferias_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_ferias_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_ferias_programacao_ferias_id FOREIGN KEY (programacao_ferias_id) REFERENCES programacao_ferias (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_ferias_periodo_aquisitivo_id FOREIGN KEY (periodo_aquisitivo_id) REFERENCES periodo_aquisitivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_ferias_calculo_folha_id FOREIGN KEY (calculo_folha_id) REFERENCES calculo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recibo_ferias_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE regra_banco_horas
  ADD CONSTRAINT fk_regra_banco_horas_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_banco_horas_convencao_coletiva_id FOREIGN KEY (convencao_coletiva_id) REFERENCES convencao_coletiva (id) ON DELETE RESTRICT;
ALTER TABLE regra_validacao_esocial
  ADD CONSTRAINT fk_regra_validacao_esocial_tipo_evento_esocial_id FOREIGN KEY (tipo_evento_esocial_id) REFERENCES tipo_evento_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_validacao_esocial_dependente_tipo_evento_esocial_id FOREIGN KEY (dependente_tipo_evento_esocial_id) REFERENCES tipo_evento_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_validacao_esocial_leiaute_esocial_id FOREIGN KEY (leiaute_esocial_id) REFERENCES leiaute_esocial (id) ON DELETE RESTRICT;
ALTER TABLE reintegracao_colaborador
  ADD CONSTRAINT fk_reintegracao_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reintegracao_colaborador_desligamento_id FOREIGN KEY (desligamento_id) REFERENCES desligamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reintegracao_colaborador_processo_trabalhista_id FOREIGN KEY (processo_trabalhista_id) REFERENCES processo_trabalhista (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reintegracao_colaborador_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE relogio_ponto
  ADD CONSTRAINT fk_relogio_ponto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relogio_ponto_tipo_relogio_ponto_id FOREIGN KEY (tipo_relogio_ponto_id) REFERENCES tipo_relogio_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relogio_ponto_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE rescisao
  ADD CONSTRAINT fk_rescisao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rescisao_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rescisao_desligamento_id FOREIGN KEY (desligamento_id) REFERENCES desligamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rescisao_tipo_rescisao_id FOREIGN KEY (tipo_rescisao_id) REFERENCES tipo_rescisao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rescisao_calculo_folha_id FOREIGN KEY (calculo_folha_id) REFERENCES calculo_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rescisao_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_legal_empregador
  ADD CONSTRAINT fk_responsavel_legal_empregador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_legal_empregador_cadastro_empregador_id FOREIGN KEY (cadastro_empregador_id) REFERENCES cadastro_empregador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_legal_empregador_conselho_unidade_federativa_id FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE retorno_esocial
  ADD CONSTRAINT fk_retorno_esocial_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_esocial_codigo_retorno_esocial_id FOREIGN KEY (codigo_retorno_esocial_id) REFERENCES codigo_retorno_esocial (id) ON DELETE RESTRICT;
ALTER TABLE risco_funcao
  ADD CONSTRAINT fk_risco_funcao_ambiente_trabalho_id FOREIGN KEY (ambiente_trabalho_id) REFERENCES ambiente_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_funcao_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_funcao_fator_risco_ocupacional_id FOREIGN KEY (fator_risco_ocupacional_id) REFERENCES fator_risco_ocupacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_funcao_laudo_ambiental_id FOREIGN KEY (laudo_ambiental_id) REFERENCES laudo_ambiental (id) ON DELETE RESTRICT;
ALTER TABLE rubrica
  ADD CONSTRAINT fk_rubrica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rubrica_tipo_rubrica_id FOREIGN KEY (tipo_rubrica_id) REFERENCES tipo_rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rubrica_natureza_rubrica_id FOREIGN KEY (natureza_rubrica_id) REFERENCES natureza_rubrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rubrica_tipo_referencia_rubrica_id FOREIGN KEY (tipo_referencia_rubrica_id) REFERENCES tipo_referencia_rubrica (id) ON DELETE RESTRICT;
ALTER TABLE sindicato
  ADD CONSTRAINT fk_sindicato_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_colaborador
  ADD CONSTRAINT fk_solicitacao_colaborador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_colaborador_tipo_solicitacao_colaborador_id FOREIGN KEY (tipo_solicitacao_colaborador_id) REFERENCES tipo_solicitacao_colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_colaborador_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_colaborador_gestor_usuario_id FOREIGN KEY (gestor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_colaborador_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE tabela_salarial
  ADD CONSTRAINT fk_tabela_salarial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_salarial_convencao_coletiva_id FOREIGN KEY (convencao_coletiva_id) REFERENCES convencao_coletiva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_salarial_sindicato_id FOREIGN KEY (sindicato_id) REFERENCES sindicato (id) ON DELETE RESTRICT;
ALTER TABLE telefone_colaborador
  ADD CONSTRAINT fk_telefone_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE tipo_colaborador
  ADD CONSTRAINT fk_tipo_colaborador_categoria_trabalhador_id FOREIGN KEY (categoria_trabalhador_id) REFERENCES categoria_trabalhador (id) ON DELETE RESTRICT;
ALTER TABLE tipo_hora
  ADD CONSTRAINT fk_tipo_hora_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT;
ALTER TABLE tipo_movimento_ponto
  ADD CONSTRAINT fk_tipo_movimento_ponto_rubrica_id FOREIGN KEY (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT;
