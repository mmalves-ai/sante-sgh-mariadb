-- Módulo SADT, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE achado_mama
  ADD CONSTRAINT fk_achado_mama_laudo_mama_id FOREIGN KEY (laudo_mama_id) REFERENCES laudo_mama (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_achado_mama_categoria_achado_mama_id FOREIGN KEY (categoria_achado_mama_id) REFERENCES categoria_achado_mama (id) ON DELETE RESTRICT;

ALTER TABLE alerta_contagem_celular
  ADD CONSTRAINT fk_alerta_contagem_celular_atalho_contador_celula_id FOREIGN KEY (atalho_contador_celula_id) REFERENCES atalho_contador_celula (id) ON DELETE RESTRICT;

ALTER TABLE amostra_analise_ensaio
  ADD CONSTRAINT fk_amostra_analise_ensaio_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_analise_ensaio_ensaio_analise_id FOREIGN KEY (ensaio_analise_id) REFERENCES ensaio_analise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_analise_ensaio_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_analise_ensaio_referencia_bibliografica_analise_id FOREIGN KEY (referencia_bibliografica_analise_id) REFERENCES referencia_bibliografica_analise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_analise_ensaio_resultado_padrao_ensaio_id FOREIGN KEY (resultado_padrao_ensaio_id) REFERENCES resultado_padrao_ensaio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_analise_ensaio_concluido_por_usuario_id FOREIGN KEY (concluido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_analise_ensaio_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE amostra_anatomopatologica
  ADD CONSTRAINT fk_amostra_anatomopatologica_laudo_anatomopatologico_id FOREIGN KEY (laudo_anatomopatologico_id) REFERENCES laudo_anatomopatologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_anatomopatologica_amostra_pai_id FOREIGN KEY (amostra_pai_id) REFERENCES amostra_anatomopatologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_anatomopatologica_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT;

ALTER TABLE amostra_biologica
  ADD CONSTRAINT fk_amostra_biologica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_requerente_analise_id FOREIGN KEY (requerente_analise_id) REFERENCES requerente_analise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_amostra_pai_id FOREIGN KEY (amostra_pai_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_regra_subamostra_id FOREIGN KEY (regra_subamostra_id) REFERENCES regra_subamostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_recipiente_coleta_id FOREIGN KEY (recipiente_coleta_id) REFERENCES recipiente_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_dispositivo_coleta_id FOREIGN KEY (dispositivo_coleta_id) REFERENCES dispositivo_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_ponto_coleta_id FOREIGN KEY (ponto_coleta_id) REFERENCES ponto_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_curva_exame_ponto_id FOREIGN KEY (curva_exame_ponto_id) REFERENCES curva_exame_ponto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_coletor_profissional_id FOREIGN KEY (coletor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_motivo_nova_coleta_id FOREIGN KEY (motivo_nova_coleta_id) REFERENCES motivo_nova_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_recebida_por_usuario_id FOREIGN KEY (recebida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_local_atual_setor_funcional_id FOREIGN KEY (local_atual_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;

ALTER TABLE amostra_biologica_evento
  ADD CONSTRAINT fk_amostra_biologica_evento_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_evento_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_evento_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_evento_amostra_analise_ensaio_id FOREIGN KEY (amostra_analise_ensaio_id) REFERENCES amostra_analise_ensaio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_evento_motivo_retirada_amostra_id FOREIGN KEY (motivo_retirada_amostra_id) REFERENCES motivo_retirada_amostra (id) ON DELETE RESTRICT;

ALTER TABLE amostra_biologica_exame
  ADD CONSTRAINT fk_amostra_biologica_exame_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_exame_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_biologica_exame_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT;

ALTER TABLE amostra_pre_transfusional
  ADD CONSTRAINT fk_amostra_pre_transfusional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_pre_transfusional_requisicao_transfusao_id FOREIGN KEY (requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_pre_transfusional_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_pre_transfusional_coletor_profissional_id FOREIGN KEY (coletor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_amostra_pre_transfusional_recebida_por_usuario_id FOREIGN KEY (recebida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE analito
  ADD CONSTRAINT fk_analito_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analito_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT;

ALTER TABLE antimicrobiano
  ADD CONSTRAINT fk_antimicrobiano_classe_antimicrobiano_id FOREIGN KEY (classe_antimicrobiano_id) REFERENCES classe_antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_antimicrobiano_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT;

ALTER TABLE area_coleta_domiciliar
  ADD CONSTRAINT fk_area_coleta_domiciliar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_coleta_domiciliar_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;

ALTER TABLE area_coleta_domiciliar_entrega
  ADD CONSTRAINT fk_area_coleta_domiciliar_entrega_area_coleta_domiciliar_id FOREIGN KEY (area_coleta_domiciliar_id) REFERENCES area_coleta_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_coleta_domiciliar_entrega_forma_entrega_resultado_id FOREIGN KEY (forma_entrega_resultado_id) REFERENCES forma_entrega_resultado (id) ON DELETE RESTRICT;

ALTER TABLE atalho_contador_celula
  ADD CONSTRAINT fk_atalho_contador_celula_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atalho_contador_celula_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT;

ALTER TABLE ato_transfusional
  ADD CONSTRAINT fk_ato_transfusional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_requisicao_transfusao_id FOREIGN KEY (requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_requisicao_transfusao_item_id FOREIGN KEY (requisicao_transfusao_item_id) REFERENCES requisicao_transfusao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_bolsa_hemocomponente_id FOREIGN KEY (bolsa_hemocomponente_id) REFERENCES bolsa_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_prescricao_item_hemocomponente_id FOREIGN KEY (prescricao_item_hemocomponente_id) REFERENCES prescricao_item_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_executor_profissional_id FOREIGN KEY (executor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_conferente_profissional_id FOREIGN KEY (conferente_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_destino_final_bolsa_id FOREIGN KEY (destino_final_bolsa_id) REFERENCES destino_final_bolsa (id) ON DELETE RESTRICT;

ALTER TABLE avaliacao_regra_resultado
  ADD CONSTRAINT fk_avaliacao_regra_resultado_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_regra_resultado_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_regra_resultado_regra_autoliberacao_id FOREIGN KEY (regra_autoliberacao_id) REFERENCES regra_autoliberacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_regra_resultado_condicao_autoliberacao_id FOREIGN KEY (condicao_autoliberacao_id) REFERENCES condicao_autoliberacao (id) ON DELETE RESTRICT;

ALTER TABLE aviso_valor_critico
  ADD CONSTRAINT fk_aviso_valor_critico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_resultado_analito_id FOREIGN KEY (resultado_analito_id) REFERENCES resultado_analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_regra_valor_critico_id FOREIGN KEY (regra_valor_critico_id) REFERENCES regra_valor_critico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_comunicado_profissional_id FOREIGN KEY (comunicado_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_comunicado_por_usuario_id FOREIGN KEY (comunicado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE aviso_valor_critico_tentativa
  ADD CONSTRAINT fk_aviso_valor_critico_tentativa_aviso_valor_critico_id FOREIGN KEY (aviso_valor_critico_id) REFERENCES aviso_valor_critico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_tentativa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_tentativa_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_tentativa_destinatario_profissional_id FOREIGN KEY (destinatario_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_valor_critico_tentativa_destinatario_usuario_id FOREIGN KEY (destinatario_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE bancada_analitica
  ADD CONSTRAINT fk_bancada_analitica_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;

ALTER TABLE bloqueio_exame_resultado
  ADD CONSTRAINT fk_bloqueio_exame_resultado_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_exame_resultado_exame_avaliado_id FOREIGN KEY (exame_avaliado_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_exame_resultado_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT;

ALTER TABLE bolsa_hemocomponente
  ADD CONSTRAINT fk_bolsa_hemocomponente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_grupo_sanguineo_id FOREIGN KEY (grupo_sanguineo_id) REFERENCES grupo_sanguineo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_fator_rh_id FOREIGN KEY (fator_rh_id) REFERENCES fator_rh (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_recebida_por_usuario_id FOREIGN KEY (recebida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_servico_hemoterapia_fornecedor_id FOREIGN KEY (servico_hemoterapia_fornecedor_id) REFERENCES servico_hemoterapia_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_doacao_sangue_id FOREIGN KEY (doacao_sangue_id) REFERENCES doacao_sangue (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_bolsa_origem_id FOREIGN KEY (bolsa_origem_id) REFERENCES bolsa_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_local_guarda_hemocomponente_id FOREIGN KEY (local_guarda_hemocomponente_id) REFERENCES local_guarda_hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_reservada_requisicao_transfusao_id FOREIGN KEY (reservada_requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_destino_final_bolsa_id FOREIGN KEY (destino_final_bolsa_id) REFERENCES destino_final_bolsa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bolsa_hemocomponente_motivo_devolucao_bolsa_id FOREIGN KEY (motivo_devolucao_bolsa_id) REFERENCES motivo_devolucao_bolsa (id) ON DELETE RESTRICT;

ALTER TABLE busca_ativa_contato
  ADD CONSTRAINT fk_busca_ativa_contato_busca_ativa_resultado_id FOREIGN KEY (busca_ativa_resultado_id) REFERENCES busca_ativa_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_contato_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_contato_canal_notificacao_id FOREIGN KEY (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_contato_nova_coleta_id FOREIGN KEY (nova_coleta_id) REFERENCES nova_coleta (id) ON DELETE RESTRICT;

ALTER TABLE busca_ativa_resultado
  ADD CONSTRAINT fk_busca_ativa_resultado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_regra_busca_ativa_id FOREIGN KEY (regra_busca_ativa_id) REFERENCES regra_busca_ativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_concluido_por_usuario_id FOREIGN KEY (concluido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE busca_ativa_resultado_exame
  ADD CONSTRAINT fk_busca_ativa_resultado_exame_busca_ativa_resultado_id FOREIGN KEY (busca_ativa_resultado_id) REFERENCES busca_ativa_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_busca_ativa_resultado_exame_reativado_por_usuario_id FOREIGN KEY (reativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE condicao_autoliberacao
  ADD CONSTRAINT fk_condicao_autoliberacao_regra_autoliberacao_id FOREIGN KEY (regra_autoliberacao_id) REFERENCES regra_autoliberacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_condicao_autoliberacao_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_condicao_autoliberacao_exame_relacionado_id FOREIGN KEY (exame_relacionado_id) REFERENCES exame (id) ON DELETE RESTRICT;

ALTER TABLE configuracao_setor_diagnostico
  ADD CONSTRAINT fk_configuracao_setor_diagnostico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_diagnostico_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_diagnostico_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_diagnostico_modelo_impressao_laudo_id FOREIGN KEY (modelo_impressao_laudo_id) REFERENCES modelo_impressao_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_diagnostico_coleta_item_faturavel_id FOREIGN KEY (coleta_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_setor_diagnostico_laudo_item_faturavel_id FOREIGN KEY (laudo_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;

ALTER TABLE consumo_padrao_exame
  ADD CONSTRAINT fk_consumo_padrao_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_padrao_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_padrao_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;

ALTER TABLE consumo_padrao_exame_item
  ADD CONSTRAINT fk_consumo_padrao_exame_item_consumo_padrao_exame_id FOREIGN KEY (consumo_padrao_exame_id) REFERENCES consumo_padrao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_padrao_exame_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_padrao_exame_item_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_padrao_exame_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;

ALTER TABLE corrida_controle_qualidade
  ADD CONSTRAINT fk_corrida_controle_qualidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corrida_controle_qualidade_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corrida_controle_qualidade_material_controle_qualidade_id FOREIGN KEY (material_controle_qualidade_id) REFERENCES material_controle_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corrida_controle_qualidade_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corrida_controle_qualidade_regra_controle_qualidade_id FOREIGN KEY (regra_controle_qualidade_id) REFERENCES regra_controle_qualidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corrida_controle_qualidade_executor_usuario_id FOREIGN KEY (executor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_corrida_controle_qualidade_avaliada_por_usuario_id FOREIGN KEY (avaliada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE cota_exame
  ADD CONSTRAINT fk_cota_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_exame_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_exame_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_exame_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_exame_solicitante_setor_funcional_id FOREIGN KEY (solicitante_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;

ALTER TABLE curva_exame
  ADD CONSTRAINT fk_curva_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_curva_exame_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT;

ALTER TABLE curva_exame_ponto
  ADD CONSTRAINT fk_curva_exame_ponto_curva_exame_id FOREIGN KEY (curva_exame_id) REFERENCES curva_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_curva_exame_ponto_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;

ALTER TABLE de_para_analito_apoio
  ADD CONSTRAINT fk_de_para_analito_apoio_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_de_para_analito_apoio_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_de_para_analito_apoio_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT;

ALTER TABLE de_para_analito_equipamento
  ADD CONSTRAINT fk_de_para_analito_equipamento_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_de_para_analito_equipamento_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_de_para_analito_equipamento_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;

ALTER TABLE de_para_exame_equipamento
  ADD CONSTRAINT fk_de_para_exame_equipamento_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_de_para_exame_equipamento_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_de_para_exame_equipamento_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;

ALTER TABLE de_para_material_apoio
  ADD CONSTRAINT fk_de_para_material_apoio_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_de_para_material_apoio_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;

ALTER TABLE diligencia_amostra
  ADD CONSTRAINT fk_diligencia_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diligencia_amostra_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diligencia_amostra_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diligencia_amostra_busca_ativa_resultado_id FOREIGN KEY (busca_ativa_resultado_id) REFERENCES busca_ativa_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diligencia_amostra_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diligencia_amostra_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diligencia_amostra_concluida_por_usuario_id FOREIGN KEY (concluida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE dispositivo_coleta
  ADD CONSTRAINT fk_dispositivo_coleta_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;

ALTER TABLE doacao_sangue
  ADD CONSTRAINT fk_doacao_sangue_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doacao_sangue_doador_pessoa_fisica_id FOREIGN KEY (doador_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doacao_sangue_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doacao_sangue_triagem_profissional_id FOREIGN KEY (triagem_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doacao_sangue_coletor_profissional_id FOREIGN KEY (coletor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doacao_sangue_grupo_sanguineo_id FOREIGN KEY (grupo_sanguineo_id) REFERENCES grupo_sanguineo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doacao_sangue_fator_rh_id FOREIGN KEY (fator_rh_id) REFERENCES fator_rh (id) ON DELETE RESTRICT;

ALTER TABLE emissao_laudo
  ADD CONSTRAINT fk_emissao_laudo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_emitido_por_usuario_id FOREIGN KEY (emitido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_motivo_reimpressao_id FOREIGN KEY (motivo_reimpressao_id) REFERENCES motivo_reimpressao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_entrega_resultado_id FOREIGN KEY (entrega_resultado_id) REFERENCES entrega_resultado (id) ON DELETE RESTRICT;

ALTER TABLE emissao_laudo_exame
  ADD CONSTRAINT fk_emissao_laudo_exame_emissao_laudo_id FOREIGN KEY (emissao_laudo_id) REFERENCES emissao_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_exame_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_laudo_exame_laudo_diagnostico_id FOREIGN KEY (laudo_diagnostico_id) REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT;
