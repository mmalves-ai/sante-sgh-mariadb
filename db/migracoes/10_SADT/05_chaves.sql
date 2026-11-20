-- Chaves do módulo SADT, lote 05 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE requisicao_exame
  ADD CONSTRAINT fk_requisicao_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_orcamento_particular_id FOREIGN KEY (orcamento_particular_id) REFERENCES orcamento_particular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_ponto_coleta_id FOREIGN KEY (ponto_coleta_id) REFERENCES ponto_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_exame_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE requisicao_transfusao
  ADD CONSTRAINT fk_requisicao_transfusao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_prescricao_item_hemocomponente_id FOREIGN KEY (prescricao_item_hemocomponente_id) REFERENCES prescricao_item_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_servico_hemoterapia_fornecedor_id FOREIGN KEY (servico_hemoterapia_fornecedor_id) REFERENCES servico_hemoterapia_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_tipo_transfusao_id FOREIGN KEY (tipo_transfusao_id) REFERENCES tipo_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_termo_consentimento_paciente_id FOREIGN KEY (termo_consentimento_paciente_id) REFERENCES termo_consentimento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_motivo_cancelamento_requisicao_t_0308e6 FOREIGN KEY (motivo_cancelamento_requisicao_transfusao_id) REFERENCES motivo_cancelamento_requisicao_transfusao (id) ON DELETE RESTRICT;
ALTER TABLE requisicao_transfusao_item
  ADD CONSTRAINT fk_requisicao_transfusao_item_requisicao_transfusao_id FOREIGN KEY (requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_item_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_item_prescricao_item_hemocomponente_id FOREIGN KEY (prescricao_item_hemocomponente_id) REFERENCES prescricao_item_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_item_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_item_motivo_cancelamento_requisi_9e3d8d FOREIGN KEY (motivo_cancelamento_requisicao_transfusao_id) REFERENCES motivo_cancelamento_requisicao_transfusao (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_laudo_setor
  ADD CONSTRAINT fk_responsavel_laudo_setor_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_laudo_setor_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_laudo_setor_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE resposta_padrao
  ADD CONSTRAINT fk_resposta_padrao_grupo_resposta_id FOREIGN KEY (grupo_resposta_id) REFERENCES grupo_resposta (id) ON DELETE RESTRICT;
ALTER TABLE resposta_solicitacao_exame
  ADD CONSTRAINT fk_resposta_solicitacao_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_solicitacao_exame_pergunta_solicitacao_exame_id FOREIGN KEY (pergunta_solicitacao_exame_id) REFERENCES pergunta_solicitacao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_solicitacao_exame_resposta_padrao_id FOREIGN KEY (resposta_padrao_id) REFERENCES resposta_padrao (id) ON DELETE RESTRICT;
ALTER TABLE resposta_triagem_doador
  ADD CONSTRAINT fk_resposta_triagem_doador_doacao_sangue_id FOREIGN KEY (doacao_sangue_id) REFERENCES doacao_sangue (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_triagem_doador_pergunta_triagem_doador_id FOREIGN KEY (pergunta_triagem_doador_id) REFERENCES pergunta_triagem_doador (id) ON DELETE RESTRICT;
ALTER TABLE restricao_exame
  ADD CONSTRAINT fk_restricao_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_exame_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_exame_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_exame_motivo_restricao_exame_id FOREIGN KEY (motivo_restricao_exame_id) REFERENCES motivo_restricao_exame (id) ON DELETE RESTRICT;
ALTER TABLE resultado_analito
  ADD CONSTRAINT fk_resultado_analito_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_analito_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_analito_resposta_padrao_id FOREIGN KEY (resposta_padrao_id) REFERENCES resposta_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_analito_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_analito_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_analito_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_analito_faixa_referencia_id FOREIGN KEY (faixa_referencia_id) REFERENCES faixa_referencia (id) ON DELETE RESTRICT;
ALTER TABLE resultado_controle_qualidade
  ADD CONSTRAINT fk_resultado_controle_qualidade_corrida_controle_qualidade_id FOREIGN KEY (corrida_controle_qualidade_id) REFERENCES corrida_controle_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_controle_qualidade_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_controle_qualidade_material_controle_qualidade_id FOREIGN KEY (material_controle_qualidade_id) REFERENCES material_controle_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_controle_qualidade_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_controle_qualidade_regra_controle_qualidade_id FOREIGN KEY (regra_controle_qualidade_id) REFERENCES regra_controle_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE resultado_cultura
  ADD CONSTRAINT fk_resultado_cultura_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_cultura_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_cultura_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_cultura_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_cultura_classificacao_resultado_cultura_id FOREIGN KEY (classificacao_resultado_cultura_id) REFERENCES classificacao_resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_cultura_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_cultura_faixa_contagem_colonia_id FOREIGN KEY (faixa_contagem_colonia_id) REFERENCES faixa_contagem_colonia (id) ON DELETE RESTRICT;
ALTER TABLE resultado_curva_ponto
  ADD CONSTRAINT fk_resultado_curva_ponto_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_curva_ponto_curva_exame_ponto_id FOREIGN KEY (curva_exame_ponto_id) REFERENCES curva_exame_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_curva_ponto_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_curva_ponto_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT;
ALTER TABLE resultado_exame
  ADD CONSTRAINT fk_resultado_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_modelo_resultado_id FOREIGN KEY (modelo_resultado_id) REFERENCES modelo_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_digitado_por_usuario_id FOREIGN KEY (digitado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_conferido_por_profissional_id FOREIGN KEY (conferido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_liberado_por_profissional_id FOREIGN KEY (liberado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_motivo_liberacao_resultado_id FOREIGN KEY (motivo_liberacao_resultado_id) REFERENCES motivo_liberacao_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_laudo_arquivo_id FOREIGN KEY (laudo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE resultado_exame_versao
  ADD CONSTRAINT fk_resultado_exame_versao_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_versao_motivo_retificacao_laudo_id FOREIGN KEY (motivo_retificacao_laudo_id) REFERENCES motivo_retificacao_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_exame_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE resultado_observacao
  ADD CONSTRAINT fk_resultado_observacao_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_observacao_texto_padrao_resultado_id FOREIGN KEY (texto_padrao_resultado_id) REFERENCES texto_padrao_resultado (id) ON DELETE RESTRICT;
ALTER TABLE resultado_sensibilidade
  ADD CONSTRAINT fk_resultado_sensibilidade_isolado_microbiano_id FOREIGN KEY (isolado_microbiano_id) REFERENCES isolado_microbiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_sensibilidade_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_sensibilidade_ponto_corte_antimicrobiano_id FOREIGN KEY (ponto_corte_antimicrobiano_id) REFERENCES ponto_corte_antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE resultado_variavel_formula
  ADD CONSTRAINT fk_resultado_variavel_formula_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resultado_variavel_formula_variavel_formula_id FOREIGN KEY (variavel_formula_id) REFERENCES variavel_formula (id) ON DELETE RESTRICT;
ALTER TABLE secao_laudo_estruturado
  ADD CONSTRAINT fk_secao_laudo_estruturado_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE servico_domiciliar_exame
  ADD CONSTRAINT fk_servico_domiciliar_exame_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_domiciliar_exame_area_coleta_domiciliar_id FOREIGN KEY (area_coleta_domiciliar_id) REFERENCES area_coleta_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_domiciliar_exame_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_domiciliar_exame_forma_entrega_resultado_id FOREIGN KEY (forma_entrega_resultado_id) REFERENCES forma_entrega_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_domiciliar_exame_local_entrega_resultado_id FOREIGN KEY (local_entrega_resultado_id) REFERENCES local_entrega_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_domiciliar_exame_realizado_por_profissional_id FOREIGN KEY (realizado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE servico_hemoterapia_fornecedor
  ADD CONSTRAINT fk_servico_hemoterapia_fornecedor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_hemoterapia_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE setor_diagnostico
  ADD CONSTRAINT fk_setor_diagnostico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_diagnostico_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_diagnostico_responsavel_tecnico_profissional_id FOREIGN KEY (responsavel_tecnico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_diagnostico_cabecalho_arquivo_id FOREIGN KEY (cabecalho_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_diagnostico_rodape_arquivo_id FOREIGN KEY (rodape_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_diagnostico_desativado_por_usuario_id FOREIGN KEY (desativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE situacao_amostra
  ADD CONSTRAINT fk_situacao_amostra_situacao_anterior_id FOREIGN KEY (situacao_anterior_id) REFERENCES situacao_amostra (id) ON DELETE RESTRICT;
ALTER TABLE substancia_interferente
  ADD CONSTRAINT fk_substancia_interferente_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substancia_interferente_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substancia_interferente_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT;
ALTER TABLE suporte_guarda_amostra
  ADD CONSTRAINT fk_suporte_guarda_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suporte_guarda_amostra_equipamento_guarda_amostra_id FOREIGN KEY (equipamento_guarda_amostra_id) REFERENCES equipamento_guarda_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suporte_guarda_amostra_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suporte_guarda_amostra_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suporte_guarda_amostra_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE suporte_guarda_amostra_exame
  ADD CONSTRAINT fk_suporte_guarda_amostra_exame_suporte_guarda_amostra_id FOREIGN KEY (suporte_guarda_amostra_id) REFERENCES suporte_guarda_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suporte_guarda_amostra_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE teste_imuno_hematologico
  ADD CONSTRAINT fk_teste_imuno_hematologico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_bolsa_hemocomponente_id FOREIGN KEY (bolsa_hemocomponente_id) REFERENCES bolsa_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_amostra_pre_transfusional_id FOREIGN KEY (amostra_pre_transfusional_id) REFERENCES amostra_pre_transfusional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_requisicao_transfusao_id FOREIGN KEY (requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_tipo_teste_imuno_hematologico_id FOREIGN KEY (tipo_teste_imuno_hematologico_id) REFERENCES tipo_teste_imuno_hematologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_grupo_sanguineo_id FOREIGN KEY (grupo_sanguineo_id) REFERENCES grupo_sanguineo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_fator_rh_id FOREIGN KEY (fator_rh_id) REFERENCES fator_rh (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_realizado_por_profissional_id FOREIGN KEY (realizado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teste_imuno_hematologico_liberado_por_profissional_id FOREIGN KEY (liberado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE texto_padrao_resultado
  ADD CONSTRAINT fk_texto_padrao_resultado_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_resultado_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_texto_padrao_resultado_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE tipo_teste_imuno_hematologico
  ADD CONSTRAINT fk_tipo_teste_imuno_hematologico_teste_pai_id FOREIGN KEY (teste_pai_id) REFERENCES tipo_teste_imuno_hematologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_teste_imuno_hematologico_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE unidade_resultado
  ADD CONSTRAINT fk_unidade_resultado_unidade_base_id FOREIGN KEY (unidade_base_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE valor_grandeza_laudo
  ADD CONSTRAINT fk_valor_grandeza_laudo_laudo_diagnostico_id FOREIGN KEY (laudo_diagnostico_id) REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_grandeza_laudo_grandeza_laudo_id FOREIGN KEY (grandeza_laudo_id) REFERENCES grandeza_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_grandeza_laudo_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE variavel_formula
  ADD CONSTRAINT fk_variavel_formula_formula_calculo_id FOREIGN KEY (formula_calculo_id) REFERENCES formula_calculo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_variavel_formula_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_variavel_formula_grandeza_laudo_id FOREIGN KEY (grandeza_laudo_id) REFERENCES grandeza_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_variavel_formula_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE visualizador_imagem
  ADD CONSTRAINT fk_visualizador_imagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
