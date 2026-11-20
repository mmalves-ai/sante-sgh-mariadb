-- Módulo RH, lote 04: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE tipo_rescisao
  ADD CONSTRAINT fk_tipo_rescisao_motivo_desligamento_codigo_esocial_id FOREIGN KEY (motivo_desligamento_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT;
ALTER TABLE titulo_folha
  ADD CONSTRAINT fk_titulo_folha_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_folha_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_folha_credor_pessoa_juridica_id FOREIGN KEY (credor_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titulo_folha_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE totalizador_esocial
  ADD CONSTRAINT fk_totalizador_esocial_evento_esocial_id FOREIGN KEY (evento_esocial_id) REFERENCES evento_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_totalizador_esocial_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_totalizador_esocial_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_totalizador_esocial_trabalhador_sem_vinculo_id FOREIGN KEY (trabalhador_sem_vinculo_id) REFERENCES trabalhador_sem_vinculo (id) ON DELETE RESTRICT;
ALTER TABLE trabalhador_sem_vinculo
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_categoria_trabalhador_id FOREIGN KEY (categoria_trabalhador_id) REFERENCES categoria_trabalhador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_cooperativa_pessoa_juridica_id FOREIGN KEY (cooperativa_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_trabalhador_sem_vinculo_motivo_termino_codigo_esocial_id FOREIGN KEY (motivo_termino_codigo_esocial_id) REFERENCES codigo_esocial (id) ON DELETE RESTRICT;
ALTER TABLE treinamento_obrigatorio_funcao
  ADD CONSTRAINT fk_treinamento_obrigatorio_funcao_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_treinamento_obrigatorio_funcao_curso_id FOREIGN KEY (curso_id) REFERENCES curso (id) ON DELETE RESTRICT;
ALTER TABLE troca_plantao
  ADD CONSTRAINT fk_troca_plantao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_plantao_plantao_id FOREIGN KEY (plantao_id) REFERENCES plantao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_plantao_solicitante_colaborador_id FOREIGN KEY (solicitante_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_plantao_colega_colaborador_id FOREIGN KEY (colega_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_plantao_colega_plantao_id FOREIGN KEY (colega_plantao_id) REFERENCES plantao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_plantao_decisor_usuario_id FOREIGN KEY (decisor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE turma_treinamento
  ADD CONSTRAINT fk_turma_treinamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_treinamento_curso_id FOREIGN KEY (curso_id) REFERENCES curso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_treinamento_instrutor_colaborador_id FOREIGN KEY (instrutor_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_treinamento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_turma_treinamento_documento_qualidade_id FOREIGN KEY (documento_qualidade_id) REFERENCES documento_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE vacina_colaborador
  ADD CONSTRAINT fk_vacina_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_colaborador_vacina_ocupacional_id FOREIGN KEY (vacina_ocupacional_id) REFERENCES vacina_ocupacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_colaborador_aplicador_profissional_id FOREIGN KEY (aplicador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vacina_colaborador_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE vacina_ocupacional
  ADD CONSTRAINT fk_vacina_ocupacional_imunobiologico_id FOREIGN KEY (imunobiologico_id) REFERENCES imunobiologico (id) ON DELETE RESTRICT;
ALTER TABLE vaga
  ADD CONSTRAINT fk_vaga_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_tipo_vinculo_trabalho_id FOREIGN KEY (tipo_vinculo_trabalho_id) REFERENCES tipo_vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_regime_jornada_id FOREIGN KEY (regime_jornada_id) REFERENCES regime_jornada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_substituido_colaborador_id FOREIGN KEY (substituido_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vaga_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE validade_conselho
  ADD CONSTRAINT fk_validade_conselho_inscricao_conselho_id FOREIGN KEY (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_validade_conselho_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_validade_conselho_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_validade_conselho_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE vigencia_regime_colaborador
  ADD CONSTRAINT fk_vigencia_regime_colaborador_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vigencia_regime_colaborador_regime_jornada_id FOREIGN KEY (regime_jornada_id) REFERENCES regime_jornada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vigencia_regime_colaborador_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_trabalho
  ADD CONSTRAINT fk_vinculo_trabalho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_tipo_vinculo_trabalho_id FOREIGN KEY (tipo_vinculo_trabalho_id) REFERENCES tipo_vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_categoria_trabalhador_id FOREIGN KEY (categoria_trabalhador_id) REFERENCES categoria_trabalhador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_tipo_colaborador_id FOREIGN KEY (tipo_colaborador_id) REFERENCES tipo_colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_tipo_contrato_temporario_id FOREIGN KEY (tipo_contrato_temporario_id) REFERENCES tipo_contrato_temporario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_funcao_id FOREIGN KEY (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_regime_jornada_id FOREIGN KEY (regime_jornada_id) REFERENCES regime_jornada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_sindicato_id FOREIGN KEY (sindicato_id) REFERENCES sindicato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_trabalho_tipo_rescisao_id FOREIGN KEY (tipo_rescisao_id) REFERENCES tipo_rescisao (id) ON DELETE RESTRICT;
