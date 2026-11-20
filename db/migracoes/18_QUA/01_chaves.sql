-- Chaves do lote 18_QUA-01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acao_imediata_incidente
  ADD CONSTRAINT fk_acao_imediata_incidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_imediata_incidente_tipo_incidente_id FOREIGN KEY (tipo_incidente_id) REFERENCES tipo_incidente (id) ON DELETE RESTRICT;
ALTER TABLE acao_plano_qualidade
  ADD CONSTRAINT fk_acao_plano_qualidade_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_plano_qualidade_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_plano_qualidade_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_plano_qualidade_eficacia_verificador_usuario_id FOREIGN KEY (eficacia_verificador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_plano_qualidade_achado_auditoria_id FOREIGN KEY (achado_auditoria_id) REFERENCES achado_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_plano_qualidade_analise_incidente_causa_id FOREIGN KEY (analise_incidente_causa_id) REFERENCES analise_incidente_causa (id) ON DELETE RESTRICT;
ALTER TABLE acao_plano_qualidade_evento
  ADD CONSTRAINT fk_acao_plano_qualidade_evento_acao_plano_qualidade_id FOREIGN KEY (acao_plano_qualidade_id) REFERENCES acao_plano_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_plano_qualidade_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE achado_auditoria
  ADD CONSTRAINT fk_achado_auditoria_auditoria_interna_id FOREIGN KEY (auditoria_interna_id) REFERENCES auditoria_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_achado_auditoria_auditoria_interna_item_id FOREIGN KEY (auditoria_interna_item_id) REFERENCES auditoria_interna_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_achado_auditoria_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_achado_auditoria_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_achado_auditoria_nao_conformidade_qualidade_id FOREIGN KEY (nao_conformidade_qualidade_id) REFERENCES nao_conformidade_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_achado_auditoria_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE alerta_sanitario
  ADD CONSTRAINT fk_alerta_sanitario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE alerta_sanitario_verificacao
  ADD CONSTRAINT fk_alerta_sanitario_verificacao_alerta_sanitario_id FOREIGN KEY (alerta_sanitario_id) REFERENCES alerta_sanitario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_verificacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_verificacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_verificacao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_verificacao_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_sanitario_verificacao_verificador_usuario_id FOREIGN KEY (verificador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE analise_cultura_positiva
  ADD CONSTRAINT fk_analise_cultura_positiva_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_resultado_cultura_id FOREIGN KEY (resultado_cultura_id) REFERENCES resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_isolado_microbiano_id FOREIGN KEY (isolado_microbiano_id) REFERENCES isolado_microbiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_analista_usuario_id FOREIGN KEY (analista_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_conduta_analise_cultura_id FOREIGN KEY (conduta_analise_cultura_id) REFERENCES conduta_analise_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_cultura_positiva_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT;
ALTER TABLE analise_incidente
  ADD CONSTRAINT fk_analise_incidente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_grau_dano_id FOREIGN KEY (grau_dano_id) REFERENCES grau_dano (id) ON DELETE RESTRICT;
ALTER TABLE analise_incidente_causa
  ADD CONSTRAINT fk_analise_incidente_causa_analise_incidente_id FOREIGN KEY (analise_incidente_id) REFERENCES analise_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_causa_fator_contribuinte_id FOREIGN KEY (fator_contribuinte_id) REFERENCES fator_contribuinte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_causa_causa_pai_id FOREIGN KEY (causa_pai_id) REFERENCES analise_incidente_causa (id) ON DELETE RESTRICT;
ALTER TABLE analise_incidente_participante
  ADD CONSTRAINT fk_analise_incidente_participante_analise_incidente_id FOREIGN KEY (analise_incidente_id) REFERENCES analise_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_participante_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_incidente_participante_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_interna
  ADD CONSTRAINT fk_auditoria_interna_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_programa_auditoria_id FOREIGN KEY (programa_auditoria_id) REFERENCES programa_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_categoria_auditoria_interna_id FOREIGN KEY (categoria_auditoria_interna_id) REFERENCES categoria_auditoria_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_processo_institucional_id FOREIGN KEY (processo_institucional_id) REFERENCES processo_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_modelo_checklist_qualidade_versao_id FOREIGN KEY (modelo_checklist_qualidade_versao_id) REFERENCES modelo_checklist_qualidade_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_auditor_lider_usuario_id FOREIGN KEY (auditor_lider_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_interna_auditor
  ADD CONSTRAINT fk_auditoria_interna_auditor_auditoria_interna_id FOREIGN KEY (auditoria_interna_id) REFERENCES auditoria_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_auditor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_interna_item
  ADD CONSTRAINT fk_auditoria_interna_item_auditoria_interna_id FOREIGN KEY (auditoria_interna_id) REFERENCES auditoria_interna (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_item_modelo_checklist_qualidade_item_id FOREIGN KEY (modelo_checklist_qualidade_item_id) REFERENCES modelo_checklist_qualidade_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_interna_item_respondente_usuario_id FOREIGN KEY (respondente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE autoavaliacao_acreditacao
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_programa_acreditacao_id FOREIGN KEY (programa_acreditacao_id) REFERENCES programa_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_avaliador_usuario_id FOREIGN KEY (avaliador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE autoavaliacao_acreditacao_item
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_item_autoavaliacao_acreditacao_id FOREIGN KEY (autoavaliacao_acreditacao_id) REFERENCES autoavaliacao_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_item_requisito_acreditacao_id FOREIGN KEY (requisito_acreditacao_id) REFERENCES requisito_acreditacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_item_verificador_usuario_id FOREIGN KEY (verificador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autoavaliacao_acreditacao_item_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_risco
  ADD CONSTRAINT fk_avaliacao_risco_risco_institucional_id FOREIGN KEY (risco_institucional_id) REFERENCES risco_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_risco_escala_avaliacao_risco_id FOREIGN KEY (escala_avaliacao_risco_id) REFERENCES escala_avaliacao_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_risco_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE bundle_prevencao
  ADD CONSTRAINT fk_bundle_prevencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bundle_prevencao_tipo_dispositivo_invasivo_id FOREIGN KEY (tipo_dispositivo_invasivo_id) REFERENCES tipo_dispositivo_invasivo (id) ON DELETE RESTRICT;
ALTER TABLE bundle_prevencao_item
  ADD CONSTRAINT fk_bundle_prevencao_item_bundle_prevencao_id FOREIGN KEY (bundle_prevencao_id) REFERENCES bundle_prevencao (id) ON DELETE RESTRICT;
ALTER TABLE campo_tipo_incidente
  ADD CONSTRAINT fk_campo_tipo_incidente_tipo_incidente_id FOREIGN KEY (tipo_incidente_id) REFERENCES tipo_incidente (id) ON DELETE RESTRICT;
ALTER TABLE carteira_risco
  ADD CONSTRAINT fk_carteira_risco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_risco_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_risco_processo_institucional_id FOREIGN KEY (processo_institucional_id) REFERENCES processo_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_risco_gestor_usuario_id FOREIGN KEY (gestor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE carteira_risco_responsavel
  ADD CONSTRAINT fk_carteira_risco_responsavel_carteira_risco_id FOREIGN KEY (carteira_risco_id) REFERENCES carteira_risco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_risco_responsavel_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carteira_risco_responsavel_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE caso_infeccao
  ADD CONSTRAINT fk_caso_infeccao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_sitio_infeccao_id FOREIGN KEY (sitio_infeccao_id) REFERENCES sitio_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_componente_vigilancia_id FOREIGN KEY (componente_vigilancia_id) REFERENCES componente_vigilancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_dispositivo_invasivo_paciente_id FOREIGN KEY (dispositivo_invasivo_paciente_id) REFERENCES dispositivo_invasivo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_confirmador_usuario_id FOREIGN KEY (confirmador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE caso_infeccao_criterio
  ADD CONSTRAINT fk_caso_infeccao_criterio_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_criterio_criterio_infeccao_id FOREIGN KEY (criterio_infeccao_id) REFERENCES criterio_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_criterio_resultado_cultura_id FOREIGN KEY (resultado_cultura_id) REFERENCES resultado_cultura (id) ON DELETE RESTRICT;
ALTER TABLE caso_infeccao_evento
  ADD CONSTRAINT fk_caso_infeccao_evento_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE caso_infeccao_microrganismo
  ADD CONSTRAINT fk_caso_infeccao_microrganismo_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_microrganismo_microrganismo_id FOREIGN KEY (microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_microrganismo_perfil_multirresistencia_id FOREIGN KEY (perfil_multirresistencia_id) REFERENCES perfil_multirresistencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_microrganismo_resultado_cultura_id FOREIGN KEY (resultado_cultura_id) REFERENCES resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_caso_infeccao_microrganismo_isolado_microbiano_id FOREIGN KEY (isolado_microbiano_id) REFERENCES isolado_microbiano (id) ON DELETE RESTRICT;
ALTER TABLE causa_risco
  ADD CONSTRAINT fk_causa_risco_categoria_risco_institucional_id FOREIGN KEY (categoria_risco_institucional_id) REFERENCES categoria_risco_institucional (id) ON DELETE RESTRICT;
ALTER TABLE comissao_hospitalar
  ADD CONSTRAINT fk_comissao_hospitalar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_hospitalar_tipo_comissao_id FOREIGN KEY (tipo_comissao_id) REFERENCES tipo_comissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_hospitalar_ato_arquivo_id FOREIGN KEY (ato_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE comissao_membro
  ADD CONSTRAINT fk_comissao_membro_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_membro_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comissao_membro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE comunicacao_incidente_paciente
  ADD CONSTRAINT fk_comunicacao_incidente_paciente_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_incidente_paciente_comunicador_profissional_id FOREIGN KEY (comunicador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_incidente_paciente_testemunha_colaborador_id FOREIGN KEY (testemunha_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE consumo_antimicrobiano_vigilancia
  ADD CONSTRAINT fk_consumo_antimicrobiano_vigilancia_fechamento_vigilanci_517f8a FOREIGN KEY (fechamento_vigilancia_iras_id) REFERENCES fechamento_vigilancia_iras (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_antimicrobiano_vigilancia_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_antimicrobiano_vigilancia_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_antimicrobiano_vigilancia_dose_diaria_definida_id FOREIGN KEY (dose_diaria_definida_id) REFERENCES dose_diaria_definida (id) ON DELETE RESTRICT;
ALTER TABLE consumo_preparacao_alcoolica
  ADD CONSTRAINT fk_consumo_preparacao_alcoolica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_preparacao_alcoolica_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_preparacao_alcoolica_fechamento_vigilancia_iras_id FOREIGN KEY (fechamento_vigilancia_iras_id) REFERENCES fechamento_vigilancia_iras (id) ON DELETE RESTRICT;
ALTER TABLE contato_manifestacao
  ADD CONSTRAINT fk_contato_manifestacao_manifestacao_ouvidoria_id FOREIGN KEY (manifestacao_ouvidoria_id) REFERENCES manifestacao_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_manifestacao_canal_ouvidoria_id FOREIGN KEY (canal_ouvidoria_id) REFERENCES canal_ouvidoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_contato_manifestacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE controle_risco
  ADD CONSTRAINT fk_controle_risco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_controle_risco_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE criterio_infeccao
  ADD CONSTRAINT fk_criterio_infeccao_sitio_infeccao_id FOREIGN KEY (sitio_infeccao_id) REFERENCES sitio_infeccao (id) ON DELETE RESTRICT;
ALTER TABLE deliberacao_reuniao
  ADD CONSTRAINT fk_deliberacao_reuniao_reuniao_comissao_id FOREIGN KEY (reuniao_comissao_id) REFERENCES reuniao_comissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_deliberacao_reuniao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_deliberacao_reuniao_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE denominador_vigilancia
  ADD CONSTRAINT fk_denominador_vigilancia_fechamento_vigilancia_iras_id FOREIGN KEY (fechamento_vigilancia_iras_id) REFERENCES fechamento_vigilancia_iras (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_denominador_vigilancia_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_denominador_vigilancia_componente_vigilancia_id FOREIGN KEY (componente_vigilancia_id) REFERENCES componente_vigilancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_denominador_vigilancia_tipo_dispositivo_invasivo_id FOREIGN KEY (tipo_dispositivo_invasivo_id) REFERENCES tipo_dispositivo_invasivo (id) ON DELETE RESTRICT;
ALTER TABLE documento_qualidade
  ADD CONSTRAINT fk_documento_qualidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_tipo_documento_qualidade_id FOREIGN KEY (tipo_documento_qualidade_id) REFERENCES tipo_documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_pasta_documento_qualidade_id FOREIGN KEY (pasta_documento_qualidade_id) REFERENCES pasta_documento_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_processo_institucional_id FOREIGN KEY (processo_institucional_id) REFERENCES processo_institucional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_documento_qualidade_versao_id FOREIGN KEY (documento_qualidade_versao_id) REFERENCES documento_qualidade_versao (id) ON DELETE RESTRICT;
ALTER TABLE documento_qualidade_aprovacao
  ADD CONSTRAINT fk_documento_qualidade_aprovacao_documento_qualidade_versao_id FOREIGN KEY (documento_qualidade_versao_id) REFERENCES documento_qualidade_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_aprovacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_aprovacao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_aprovacao_decisor_usuario_id FOREIGN KEY (decisor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_qualidade_ciencia
  ADD CONSTRAINT fk_documento_qualidade_ciencia_documento_qualidade_versao_id FOREIGN KEY (documento_qualidade_versao_id) REFERENCES documento_qualidade_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_ciencia_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_qualidade_ciencia_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
