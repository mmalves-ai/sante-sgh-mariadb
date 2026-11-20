-- Chaves do lote 18_QUA-03 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE processo_institucional
  ADD CONSTRAINT fk_processo_institucional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_institucional_processo_pai_id FOREIGN KEY (processo_pai_id) REFERENCES processo_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_institucional_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_institucional_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE programa_auditoria
  ADD CONSTRAINT fk_programa_auditoria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_auditoria_programa_acreditacao_id FOREIGN KEY (programa_acreditacao_id) REFERENCES programa_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_auditoria_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programa_auditoria_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE queixa_tecnica_produto
  ADD CONSTRAINT fk_queixa_tecnica_produto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_notificante_usuario_id FOREIGN KEY (notificante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE queixa_tecnica_produto_evento
  ADD CONSTRAINT fk_queixa_tecnica_produto_evento_queixa_tecnica_produto_id FOREIGN KEY (queixa_tecnica_produto_id) REFERENCES queixa_tecnica_produto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_queixa_tecnica_produto_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_classificacao_incidente
  ADD CONSTRAINT fk_regra_classificacao_incidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_incidente_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_incidente_classificacao_incidente_id FOREIGN KEY (classificacao_incidente_id) REFERENCES classificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_incidente_tipo_incidente_id FOREIGN KEY (tipo_incidente_id) REFERENCES tipo_incidente (id) ON DELETE RESTRICT;
ALTER TABLE regra_classificacao_incidente_criterio
  ADD CONSTRAINT fk_regra_classificacao_incidente_criterio_regra_classif_63e8fc2c FOREIGN KEY (regra_classificacao_incidente_id) REFERENCES regra_classificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_classificacao_incidente_criterio_campo_tipo_in_5b6423d0 FOREIGN KEY (campo_tipo_incidente_id) REFERENCES campo_tipo_incidente (id) ON DELETE RESTRICT;
ALTER TABLE requisito_acreditacao
  ADD CONSTRAINT fk_requisito_acreditacao_programa_acreditacao_id FOREIGN KEY (programa_acreditacao_id) REFERENCES programa_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_requisito_pai_id FOREIGN KEY (requisito_pai_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE requisito_acreditacao_indicador
  ADD CONSTRAINT fk_requisito_acreditacao_indicador_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_indicador_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT;
ALTER TABLE requisito_acreditacao_nota
  ADD CONSTRAINT fk_requisito_acreditacao_nota_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_nota_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE requisito_acreditacao_setor
  ADD CONSTRAINT fk_requisito_acreditacao_setor_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_setor_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_setor_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisito_acreditacao_setor_verificado_por_usuario_id FOREIGN KEY (verificado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_ouvidoria_setor
  ADD CONSTRAINT fk_responsavel_ouvidoria_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_ouvidoria_setor_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_ouvidoria_setor_substituto_usuario_id FOREIGN KEY (substituto_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE resposta_pesquisa_satisfacao
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_modelo_pesquisa_satisfacao_id FOREIGN KEY (modelo_pesquisa_satisfacao_id) REFERENCES modelo_pesquisa_satisfacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_manifestacao_ouvidoria_id FOREIGN KEY (manifestacao_ouvidoria_id) REFERENCES manifestacao_ouvidoria (id) ON DELETE RESTRICT;
ALTER TABLE resposta_pesquisa_satisfacao_item
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_item_resposta_pesquisa__d2cd35a7 FOREIGN KEY (resposta_pesquisa_satisfacao_id) REFERENCES resposta_pesquisa_satisfacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_item_modelo_pesquisa_sa_caceedcf FOREIGN KEY (modelo_pesquisa_satisfacao_pergunta_id) REFERENCES modelo_pesquisa_satisfacao_pergunta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_item_modelo_pesquisa_sa_ba10c36d FOREIGN KEY (modelo_pesquisa_satisfacao_opcao_id) REFERENCES modelo_pesquisa_satisfacao_opcao (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_comissao
  ADD CONSTRAINT fk_reuniao_comissao_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_comissao_ata_arquivo_id FOREIGN KEY (ata_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_comissao_secretario_usuario_id FOREIGN KEY (secretario_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_comissao_participante
  ADD CONSTRAINT fk_reuniao_comissao_participante_reuniao_comissao_id FOREIGN KEY (reuniao_comissao_id) REFERENCES reuniao_comissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_comissao_participante_comissao_membro_id FOREIGN KEY (comissao_membro_id) REFERENCES comissao_membro (id) ON DELETE RESTRICT;
ALTER TABLE revisao_obito
  ADD CONSTRAINT fk_revisao_obito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_reuniao_comissao_id FOREIGN KEY (reuniao_comissao_id) REFERENCES reuniao_comissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_relator_usuario_id FOREIGN KEY (relator_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_obito_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE revisao_prontuario
  ADD CONSTRAINT fk_revisao_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_sorteio_revisao_prontuario_id FOREIGN KEY (sorteio_revisao_prontuario_id) REFERENCES sorteio_revisao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_modelo_checklist_qualidade_versao_id FOREIGN KEY (modelo_checklist_qualidade_versao_id) REFERENCES modelo_checklist_qualidade_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_revisor_usuario_id FOREIGN KEY (revisor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_avalizada_por_usuario_id FOREIGN KEY (avalizada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE revisao_prontuario_item
  ADD CONSTRAINT fk_revisao_prontuario_item_revisao_prontuario_id FOREIGN KEY (revisao_prontuario_id) REFERENCES revisao_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_item_modelo_checklist_qualidade_item_id FOREIGN KEY (modelo_checklist_qualidade_item_id) REFERENCES modelo_checklist_qualidade_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_item_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_revisao_prontuario_item_pendencia_prontuario_id FOREIGN KEY (pendencia_prontuario_id) REFERENCES pendencia_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE risco_institucional
  ADD CONSTRAINT fk_risco_institucional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_processo_institucional_id FOREIGN KEY (processo_institucional_id) REFERENCES processo_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_categoria_risco_institucional_id FOREIGN KEY (categoria_risco_institucional_id) REFERENCES categoria_risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_carteira_risco_id FOREIGN KEY (carteira_risco_id) REFERENCES carteira_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE risco_institucional_causa
  ADD CONSTRAINT fk_risco_institucional_causa_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_causa_causa_risco_id FOREIGN KEY (causa_risco_id) REFERENCES causa_risco (id) ON DELETE RESTRICT;
ALTER TABLE risco_institucional_controle
  ADD CONSTRAINT fk_risco_institucional_controle_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_controle_controle_risco_id FOREIGN KEY (controle_risco_id) REFERENCES controle_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_controle_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_risco_institucional_controle_auditoria_interna_id FOREIGN KEY (auditoria_interna_id) REFERENCES auditoria_interna (id) ON DELETE RESTRICT;
ALTER TABLE sinal_vigilancia_iras
  ADD CONSTRAINT fk_sinal_vigilancia_iras_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_dispositivo_invasivo_paciente_id FOREIGN KEY (dispositivo_invasivo_paciente_id) REFERENCES dispositivo_invasivo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_afericao_id FOREIGN KEY (afericao_id) REFERENCES afericao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sinal_vigilancia_iras_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT;
ALTER TABLE sitio_infeccao
  ADD CONSTRAINT fk_sitio_infeccao_sitio_pai_id FOREIGN KEY (sitio_pai_id) REFERENCES sitio_infeccao (id) ON DELETE RESTRICT;
ALTER TABLE sorteio_revisao_prontuario
  ADD CONSTRAINT fk_sorteio_revisao_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sorteio_revisao_prontuario_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sorteio_revisao_prontuario_sorteado_por_usuario_id FOREIGN KEY (sorteado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE sugestao_notificacao_incidente
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_gatilho_notificacao_i_1c95420a FOREIGN KEY (gatilho_notificacao_incidente_id) REFERENCES gatilho_notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_tipo_incidente_id FOREIGN KEY (tipo_incidente_id) REFERENCES tipo_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_destinatario_usuario_id FOREIGN KEY (destinatario_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_notificacao_incidente_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT;
ALTER TABLE surto_infeccao
  ADD CONSTRAINT fk_surto_infeccao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_tipo_surto_infeccao_id FOREIGN KEY (tipo_surto_infeccao_id) REFERENCES tipo_surto_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_microrganismo_id FOREIGN KEY (microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_notificacao_agravo_id FOREIGN KEY (notificacao_agravo_id) REFERENCES notificacao_agravo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE surto_infeccao_caso
  ADD CONSTRAINT fk_surto_infeccao_caso_surto_infeccao_id FOREIGN KEY (surto_infeccao_id) REFERENCES surto_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_caso_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_caso_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_surto_infeccao_caso_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE tipo_incidente
  ADD CONSTRAINT fk_tipo_incidente_tipo_incidente_pai_id FOREIGN KEY (tipo_incidente_pai_id) REFERENCES tipo_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_incidente_fluxo_tratamento_incidente_id FOREIGN KEY (fluxo_tratamento_incidente_id) REFERENCES fluxo_tratamento_incidente (id) ON DELETE RESTRICT;
ALTER TABLE verificacao_bundle
  ADD CONSTRAINT fk_verificacao_bundle_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_bundle_dispositivo_invasivo_paciente_id FOREIGN KEY (dispositivo_invasivo_paciente_id) REFERENCES dispositivo_invasivo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_bundle_bundle_prevencao_id FOREIGN KEY (bundle_prevencao_id) REFERENCES bundle_prevencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_bundle_verificador_usuario_id FOREIGN KEY (verificador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE verificacao_bundle_item
  ADD CONSTRAINT fk_verificacao_bundle_item_verificacao_bundle_id FOREIGN KEY (verificacao_bundle_id) REFERENCES verificacao_bundle (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_bundle_item_bundle_prevencao_item_id FOREIGN KEY (bundle_prevencao_item_id) REFERENCES bundle_prevencao_item (id) ON DELETE RESTRICT;
ALTER TABLE vigilancia_pos_alta_cirurgica
  ADD CONSTRAINT fk_vigilancia_pos_alta_cirurgica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vigilancia_pos_alta_cirurgica_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vigilancia_pos_alta_cirurgica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vigilancia_pos_alta_cirurgica_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vigilancia_pos_alta_cirurgica_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE visita_acreditacao
  ADD CONSTRAINT fk_visita_acreditacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_acreditacao_programa_acreditacao_id FOREIGN KEY (programa_acreditacao_id) REFERENCES programa_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_acreditacao_autoavaliacao_acreditacao_id FOREIGN KEY (autoavaliacao_acreditacao_id) REFERENCES autoavaliacao_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_acreditacao_relatorio_arquivo_id FOREIGN KEY (relatorio_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_acreditacao_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT;
