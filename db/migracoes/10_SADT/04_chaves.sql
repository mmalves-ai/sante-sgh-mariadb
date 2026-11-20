-- SADT, lote 04: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE movimento_bolsa
  ADD CONSTRAINT fk_movimento_bolsa_bolsa_hemocomponente_id FOREIGN KEY (bolsa_hemocomponente_id) REFERENCES bolsa_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bolsa_tipo_movimento_bolsa_id FOREIGN KEY (tipo_movimento_bolsa_id) REFERENCES tipo_movimento_bolsa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bolsa_motivo_devolucao_bolsa_id FOREIGN KEY (motivo_devolucao_bolsa_id) REFERENCES motivo_devolucao_bolsa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bolsa_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bolsa_local_guarda_hemocomponente_id FOREIGN KEY (local_guarda_hemocomponente_id) REFERENCES local_guarda_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_bolsa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE movimento_guarda_amostra
  ADD CONSTRAINT fk_movimento_guarda_amostra_guarda_amostra_id FOREIGN KEY (guarda_amostra_id) REFERENCES guarda_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_guarda_amostra_motivo_retirada_amostra_id FOREIGN KEY (motivo_retirada_amostra_id) REFERENCES motivo_retirada_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_guarda_amostra_suporte_guarda_amostra_id FOREIGN KEY (suporte_guarda_amostra_id) REFERENCES suporte_guarda_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_guarda_amostra_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE nova_coleta
  ADD CONSTRAINT fk_nova_coleta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nova_coleta_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nova_coleta_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nova_coleta_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nova_coleta_nova_amostra_biologica_id FOREIGN KEY (nova_amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nova_coleta_motivo_nova_coleta_id FOREIGN KEY (motivo_nova_coleta_id) REFERENCES motivo_nova_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nova_coleta_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nova_coleta_contato_usuario_id FOREIGN KEY (contato_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE orientacao_preparo
  ADD CONSTRAINT fk_orientacao_preparo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orientacao_preparo_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE painel_antibiograma
  ADD CONSTRAINT fk_painel_antibiograma_microrganismo_id FOREIGN KEY (microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_antibiograma_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE painel_antibiograma_item
  ADD CONSTRAINT fk_painel_antibiograma_item_painel_antibiograma_id FOREIGN KEY (painel_antibiograma_id) REFERENCES painel_antibiograma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_antibiograma_item_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE perfil_portal_modalidade
  ADD CONSTRAINT fk_perfil_portal_modalidade_perfil_portal_resultado_id FOREIGN KEY (perfil_portal_resultado_id) REFERENCES perfil_portal_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_portal_modalidade_modalidade_imagem_id FOREIGN KEY (modalidade_imagem_id) REFERENCES modalidade_imagem (id) ON DELETE RESTRICT;
ALTER TABLE perfil_portal_resultado
  ADD CONSTRAINT fk_perfil_portal_resultado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE perfil_portal_setor
  ADD CONSTRAINT fk_perfil_portal_setor_perfil_portal_resultado_id FOREIGN KEY (perfil_portal_resultado_id) REFERENCES perfil_portal_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_portal_setor_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE perfil_portal_usuario
  ADD CONSTRAINT fk_perfil_portal_usuario_perfil_portal_resultado_id FOREIGN KEY (perfil_portal_resultado_id) REFERENCES perfil_portal_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_perfil_portal_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pergunta_solicitacao_exame
  ADD CONSTRAINT fk_pergunta_solicitacao_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pergunta_solicitacao_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pergunta_solicitacao_exame_grupo_resposta_id FOREIGN KEY (grupo_resposta_id) REFERENCES grupo_resposta (id) ON DELETE RESTRICT;
ALTER TABLE pergunta_triagem_doador
  ADD CONSTRAINT fk_pergunta_triagem_doador_grupo_resposta_id FOREIGN KEY (grupo_resposta_id) REFERENCES grupo_resposta (id) ON DELETE RESTRICT;
ALTER TABLE polo_triagem_amostra
  ADD CONSTRAINT fk_polo_triagem_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_polo_triagem_amostra_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE polo_triagem_amostra_setor
  ADD CONSTRAINT fk_polo_triagem_amostra_setor_polo_triagem_amostra_id FOREIGN KEY (polo_triagem_amostra_id) REFERENCES polo_triagem_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_polo_triagem_amostra_setor_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE ponto_coleta
  ADD CONSTRAINT fk_ponto_coleta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_coleta_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_coleta_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_coleta_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE ponto_coleta_setor
  ADD CONSTRAINT fk_ponto_coleta_setor_ponto_coleta_id FOREIGN KEY (ponto_coleta_id) REFERENCES ponto_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_coleta_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE ponto_corte_antimicrobiano
  ADD CONSTRAINT fk_ponto_corte_antimicrobiano_microrganismo_id FOREIGN KEY (microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_corte_antimicrobiano_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_corte_antimicrobiano_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE prazo_entrega_exame
  ADD CONSTRAINT fk_prazo_entrega_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_entrega_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_entrega_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_entrega_exame_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_entrega_exame_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_operacional_exame
  ADD CONSTRAINT fk_procedimento_operacional_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_elaborado_por_usuario_id FOREIGN KEY (elaborado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_revisado_por_profissional_id FOREIGN KEY (revisado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_aprovado_por_profissional_id FOREIGN KEY (aprovado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_operacional_exame_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE prova_compatibilidade
  ADD CONSTRAINT fk_prova_compatibilidade_requisicao_transfusao_id FOREIGN KEY (requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prova_compatibilidade_amostra_pre_transfusional_id FOREIGN KEY (amostra_pre_transfusional_id) REFERENCES amostra_pre_transfusional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prova_compatibilidade_bolsa_hemocomponente_id FOREIGN KEY (bolsa_hemocomponente_id) REFERENCES bolsa_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prova_compatibilidade_executante_usuario_id FOREIGN KEY (executante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prova_compatibilidade_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reacao_transfusional
  ADD CONSTRAINT fk_reacao_transfusional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_transfusional_ato_transfusional_id FOREIGN KEY (ato_transfusional_id) REFERENCES ato_transfusional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_transfusional_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_transfusional_bolsa_hemocomponente_id FOREIGN KEY (bolsa_hemocomponente_id) REFERENCES bolsa_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_transfusional_tipo_reacao_transfusional_id FOREIGN KEY (tipo_reacao_transfusional_id) REFERENCES tipo_reacao_transfusional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_transfusional_medico_profissional_id FOREIGN KEY (medico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_transfusional_notificacao_incidente_id FOREIGN KEY (notificacao_incidente_id) REFERENCES notificacao_incidente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reacao_transfusional_registrado_por_usuario_id FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE recipiente_coleta
  ADD CONSTRAINT fk_recipiente_coleta_modelo_etiqueta_id FOREIGN KEY (modelo_etiqueta_id) REFERENCES modelo_etiqueta (id) ON DELETE RESTRICT;
ALTER TABLE referencia_bibliografica_analise
  ADD CONSTRAINT fk_referencia_bibliografica_analise_norma_regulatoria_id FOREIGN KEY (norma_regulatoria_id) REFERENCES norma_regulatoria (id) ON DELETE RESTRICT;
ALTER TABLE registro_hemodinamica
  ADD CONSTRAINT fk_registro_hemodinamica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_hemodinamica_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_hemodinamica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_hemodinamica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_hemodinamica_primeiro_operador_profissional_id FOREIGN KEY (primeiro_operador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_hemodinamica_segundo_operador_profissional_id FOREIGN KEY (segundo_operador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_hemodinamica_anestesista_profissional_id FOREIGN KEY (anestesista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE registro_hemodinamica_achado
  ADD CONSTRAINT fk_registro_hemodinamica_achado_registro_hemodinamica_id FOREIGN KEY (registro_hemodinamica_id) REFERENCES registro_hemodinamica (id) ON DELETE RESTRICT;
ALTER TABLE regra_autoliberacao
  ADD CONSTRAINT fk_regra_autoliberacao_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_autoliberacao_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE regra_busca_ativa
  ADD CONSTRAINT fk_regra_busca_ativa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_busca_ativa_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_busca_ativa_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_busca_ativa_classificacao_resultado_cultura_id FOREIGN KEY (classificacao_resultado_cultura_id) REFERENCES classificacao_resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_busca_ativa_motivo_nova_coleta_id FOREIGN KEY (motivo_nova_coleta_id) REFERENCES motivo_nova_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_busca_ativa_modelo_comunicacao_id FOREIGN KEY (modelo_comunicacao_id) REFERENCES modelo_comunicacao (id) ON DELETE RESTRICT;
ALTER TABLE regra_controle_qualidade
  ADD CONSTRAINT fk_regra_controle_qualidade_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_qualidade_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_qualidade_material_controle_qualidade_id FOREIGN KEY (material_controle_qualidade_id) REFERENCES material_controle_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_controle_qualidade_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE regra_descarte_amostra
  ADD CONSTRAINT fk_regra_descarte_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_descarte_amostra_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_descarte_amostra_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_descarte_amostra_classificacao_resultado_cultura_id FOREIGN KEY (classificacao_resultado_cultura_id) REFERENCES classificacao_resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_descarte_amostra_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE regra_pedido_exame_automatico
  ADD CONSTRAINT fk_regra_pedido_exame_automatico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pedido_exame_automatico_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pedido_exame_automatico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_pedido_exame_automatico_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE regra_prioridade_etiqueta_amostra
  ADD CONSTRAINT fk_regra_prioridade_etiqueta_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_prioridade_etiqueta_amostra_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE regra_prioridade_etiqueta_amostra_fonte_pagadora
  ADD CONSTRAINT fk_rpeafp_regra_prioridade_etiqueta_amostra_id FOREIGN KEY (regra_prioridade_etiqueta_amostra_id) REFERENCES regra_prioridade_etiqueta_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpeafp_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE regra_resposta_pergunta_exame
  ADD CONSTRAINT fk_regra_resposta_pergunta_exame_pergunta_solicitacao_exame_id FOREIGN KEY (pergunta_solicitacao_exame_id) REFERENCES pergunta_solicitacao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_resposta_pergunta_exame_resposta_padrao_id FOREIGN KEY (resposta_padrao_id) REFERENCES resposta_padrao (id) ON DELETE RESTRICT;
ALTER TABLE regra_setor_executante
  ADD CONSTRAINT fk_regra_setor_executante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_setor_executante_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_setor_executante_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_setor_executante_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_setor_executante_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_setor_executante_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE regra_setor_executante_horario
  ADD CONSTRAINT fk_regra_setor_executante_horario_regra_setor_executante_id FOREIGN KEY (regra_setor_executante_id) REFERENCES regra_setor_executante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_setor_executante_horario_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE regra_subamostra
  ADD CONSTRAINT fk_regra_subamostra_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subamostra_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subamostra_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subamostra_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subamostra_destino_setor_diagnostico_id FOREIGN KEY (destino_setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE regra_subamostra_recipiente
  ADD CONSTRAINT fk_regra_subamostra_recipiente_regra_subamostra_id FOREIGN KEY (regra_subamostra_id) REFERENCES regra_subamostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_subamostra_recipiente_recipiente_coleta_id FOREIGN KEY (recipiente_coleta_id) REFERENCES recipiente_coleta (id) ON DELETE RESTRICT;
ALTER TABLE regra_valor_critico
  ADD CONSTRAINT fk_regra_valor_critico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valor_critico_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valor_critico_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valor_critico_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valor_critico_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_valor_critico_classificacao_resultado_cultura_id FOREIGN KEY (classificacao_resultado_cultura_id) REFERENCES classificacao_resultado_cultura (id) ON DELETE RESTRICT;
ALTER TABLE remessa_laboratorio_apoio
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_enviada_por_usuario_id FOREIGN KEY (enviada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_lote_transporte_amostra_id FOREIGN KEY (lote_transporte_amostra_id) REFERENCES lote_transporte_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE remessa_laboratorio_apoio_item
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_item_remessa_laboratorio_apoio_id FOREIGN KEY (remessa_laboratorio_apoio_id) REFERENCES remessa_laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_item_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_item_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_laboratorio_apoio_item_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT;
ALTER TABLE requerente_analise
  ADD CONSTRAINT fk_requerente_analise_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requerente_analise_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE requerente_analise_atividade
  ADD CONSTRAINT fk_requerente_analise_atividade_requerente_analise_id FOREIGN KEY (requerente_analise_id) REFERENCES requerente_analise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requerente_analise_atividade_atividade_economica_id FOREIGN KEY (atividade_economica_id) REFERENCES atividade_economica (id) ON DELETE RESTRICT;
