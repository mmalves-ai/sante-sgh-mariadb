-- RH, lote 05: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE competencia_avaliacao
  ADD CONSTRAINT fk_competencia_avaliacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_avaliacao_criterio_avaliacao_id FOREIGN KEY (criterio_avaliacao_id) REFERENCES criterio_avaliacao (id) ON DELETE RESTRICT;
ALTER TABLE cargo_competencia
  ADD CONSTRAINT fk_cargo_competencia_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cargo_competencia_competencia_avaliacao_id FOREIGN KEY (competencia_avaliacao_id) REFERENCES competencia_avaliacao (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_desempenho
  ADD CONSTRAINT fk_avaliacao_desempenho_avaliacao_anterior_id FOREIGN KEY (avaliacao_anterior_id) REFERENCES avaliacao_desempenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_desempenho_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_desempenho_finalizada_por_usuario_id FOREIGN KEY (finalizada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_desempenho_ciencia_por_usuario_id FOREIGN KEY (ciencia_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE plano_desenvolvimento
  ADD CONSTRAINT fk_plano_desenvolvimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_desenvolvimento_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_desenvolvimento_avaliacao_desempenho_id FOREIGN KEY (avaliacao_desempenho_id) REFERENCES avaliacao_desempenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_desenvolvimento_competencia_avaliacao_id FOREIGN KEY (competencia_avaliacao_id) REFERENCES competencia_avaliacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_desenvolvimento_curso_id FOREIGN KEY (curso_id) REFERENCES curso (id) ON DELETE RESTRICT;
ALTER TABLE atestado_colaborador
  ADD CONSTRAINT fk_atestado_colaborador_solicitacao_colaborador_id FOREIGN KEY (solicitacao_colaborador_id) REFERENCES solicitacao_colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atestado_colaborador_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atestado_colaborador_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE atestado_colaborador_acesso
  ADD CONSTRAINT fk_atestado_colaborador_acesso_atestado_colaborador_id FOREIGN KEY (atestado_colaborador_id) REFERENCES atestado_colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atestado_colaborador_acesso_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_colaborador
  ADD CONSTRAINT fk_solicitacao_colaborador_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE plantao
  ADD CONSTRAINT fk_plantao_lancamento_repasse_id FOREIGN KEY (lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_estorno_lancamento_repasse_id FOREIGN KEY (estorno_lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_lancado_por_usuario_id FOREIGN KEY (lancado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plantao_estornado_por_usuario_id FOREIGN KEY (estornado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE acionamento_sobreaviso
  ADD CONSTRAINT fk_acionamento_sobreaviso_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE evento_escala
  ADD CONSTRAINT fk_evento_escala_escala_id FOREIGN KEY (escala_id) REFERENCES escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_escala_plantao_id FOREIGN KEY (plantao_id) REFERENCES plantao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_escala_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cadastro_empregador
  ADD CONSTRAINT fk_cadastro_empregador_sindicato_pessoa_juridica_id FOREIGN KEY (sindicato_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_eventos_esocial
  ADD CONSTRAINT fk_conferencia_eventos_esocial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_eventos_esocial_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_eventos_esocial_item
  ADD CONSTRAINT fk_conferencia_eventos_esocial_item_conferencia FOREIGN KEY (conferencia_eventos_esocial_id) REFERENCES conferencia_eventos_esocial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_eventos_esocial_item_tipo_evento_esocial_id FOREIGN KEY (tipo_evento_esocial_id) REFERENCES tipo_evento_esocial (id) ON DELETE RESTRICT;
ALTER TABLE lote_folha_intercambio
  ADD CONSTRAINT fk_lote_folha_intercambio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_intercambio_competencia_folha_id FOREIGN KEY (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_intercambio_lote_exportado_id FOREIGN KEY (lote_exportado_id) REFERENCES lote_folha_intercambio (id) ON DELETE RESTRICT;
ALTER TABLE lote_folha_intercambio_resumo
  ADD CONSTRAINT fk_lote_folha_intercambio_resumo_lote_folha_intercambio_id FOREIGN KEY (lote_folha_intercambio_id) REFERENCES lote_folha_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_intercambio_resumo_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_folha_intercambio_resumo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE programacao_ferias
  ADD CONSTRAINT fk_programacao_ferias_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE parcela_decimo_terceiro
  ADD CONSTRAINT fk_parcela_decimo_terceiro_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE parametro_obrigacao
  ADD CONSTRAINT fk_parametro_obrigacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE sorologia_exposicao
  ADD CONSTRAINT fk_sorologia_exposicao_exposicao_biologica_id FOREIGN KEY (exposicao_biologica_id) REFERENCES exposicao_biologica (id) ON DELETE RESTRICT;
ALTER TABLE comunicacao_acidente
  ADD CONSTRAINT fk_comunicacao_acidente_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_acidente_emitente_conselho_classe_id FOREIGN KEY (emitente_conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
ALTER TABLE vacina_colaborador
  ADD CONSTRAINT fk_vacina_colaborador_retifica_vacina_colaborador_id FOREIGN KEY (retifica_vacina_colaborador_id) REFERENCES vacina_colaborador (id) ON DELETE RESTRICT;
ALTER TABLE aso
  ADD CONSTRAINT fk_aso_retifica_aso_id FOREIGN KEY (retifica_aso_id) REFERENCES aso (id) ON DELETE RESTRICT;
ALTER TABLE leitura_dosimetria
  ADD CONSTRAINT fk_leitura_dosimetria_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE exposicao_quimioterapico
  ADD CONSTRAINT fk_exposicao_quimioterapico_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE presenca_treinamento
  ADD CONSTRAINT fk_presenca_treinamento_vinculo_trabalho_id FOREIGN KEY (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE turma_treinamento
  ADD CONSTRAINT fk_turma_treinamento_documento_qualidade_versao_id FOREIGN KEY (documento_qualidade_versao_id) REFERENCES documento_qualidade_versao (id) ON DELETE RESTRICT;
