-- Módulo SADT, lote 02: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE ensaio_analise
  ADD CONSTRAINT fk_ensaio_analise_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ensaio_analise_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ensaio_analise_referencia_bibliografica_analise_id FOREIGN KEY (referencia_bibliografica_analise_id) REFERENCES referencia_bibliografica_analise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ensaio_analise_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE ensaio_analise_produto
  ADD CONSTRAINT fk_ensaio_analise_produto_ensaio_analise_id FOREIGN KEY (ensaio_analise_id) REFERENCES ensaio_analise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ensaio_analise_produto_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE ensaio_analise_programa
  ADD CONSTRAINT fk_ensaio_analise_programa_ensaio_analise_id FOREIGN KEY (ensaio_analise_id) REFERENCES ensaio_analise (id) ON DELETE RESTRICT;
ALTER TABLE ensaio_analise_unidade
  ADD CONSTRAINT fk_ensaio_analise_unidade_ensaio_analise_id FOREIGN KEY (ensaio_analise_id) REFERENCES ensaio_analise (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ensaio_analise_unidade_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE entrega_resultado
  ADD CONSTRAINT fk_entrega_resultado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_forma_entrega_resultado_id FOREIGN KEY (forma_entrega_resultado_id) REFERENCES forma_entrega_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_local_entrega_resultado_id FOREIGN KEY (local_entrega_resultado_id) REFERENCES local_entrega_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_entregue_por_usuario_id FOREIGN KEY (entregue_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT;
ALTER TABLE entrega_resultado_item
  ADD CONSTRAINT fk_entrega_resultado_item_entrega_resultado_id FOREIGN KEY (entrega_resultado_id) REFERENCES entrega_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_item_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_resultado_item_laudo_diagnostico_id FOREIGN KEY (laudo_diagnostico_id) REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE equipamento_analitico
  ADD CONSTRAINT fk_equipamento_analitico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_analitico_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_analitico_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_analitico_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT;
ALTER TABLE equipamento_guarda_amostra
  ADD CONSTRAINT fk_equipamento_guarda_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipamento_guarda_amostra_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE equipe_busca_ativa
  ADD CONSTRAINT fk_equipe_busca_ativa_regra_busca_ativa_id FOREIGN KEY (regra_busca_ativa_id) REFERENCES regra_busca_ativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_busca_ativa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE escala_execucao
  ADD CONSTRAINT fk_escala_execucao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_execucao_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_execucao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_execucao_recurso_agendavel_id FOREIGN KEY (recurso_agendavel_id) REFERENCES recurso_agendavel (id) ON DELETE RESTRICT;
ALTER TABLE escala_execucao_dia
  ADD CONSTRAINT fk_escala_execucao_dia_escala_execucao_id FOREIGN KEY (escala_execucao_id) REFERENCES escala_execucao (id) ON DELETE RESTRICT;
ALTER TABLE escala_execucao_exame
  ADD CONSTRAINT fk_escala_execucao_exame_escala_execucao_id FOREIGN KEY (escala_execucao_id) REFERENCES escala_execucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_execucao_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_execucao_exame_grupo_prioridade_legal_id FOREIGN KEY (grupo_prioridade_legal_id) REFERENCES grupo_prioridade_legal (id) ON DELETE RESTRICT;
ALTER TABLE estoque_minimo_hemocomponente
  ADD CONSTRAINT fk_estoque_minimo_hemocomponente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estoque_minimo_hemocomponente_hemocomponente_id FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estoque_minimo_hemocomponente_grupo_sanguineo_id FOREIGN KEY (grupo_sanguineo_id) REFERENCES grupo_sanguineo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estoque_minimo_hemocomponente_fator_rh_id FOREIGN KEY (fator_rh_id) REFERENCES fator_rh (id) ON DELETE RESTRICT;
ALTER TABLE estudo_imagem
  ADD CONSTRAINT fk_estudo_imagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estudo_imagem_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estudo_imagem_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estudo_imagem_modalidade_imagem_id FOREIGN KEY (modalidade_imagem_id) REFERENCES modalidade_imagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estudo_imagem_visualizador_imagem_id FOREIGN KEY (visualizador_imagem_id) REFERENCES visualizador_imagem (id) ON DELETE RESTRICT;
ALTER TABLE evento_status_imagem
  ADD CONSTRAINT fk_evento_status_imagem_estudo_imagem_id FOREIGN KEY (estudo_imagem_id) REFERENCES estudo_imagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_status_imagem_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_status_imagem_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE exame
  ADD CONSTRAINT fk_exame_especialidade_diagnostica_id FOREIGN KEY (especialidade_diagnostica_id) REFERENCES especialidade_diagnostica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_modalidade_imagem_id FOREIGN KEY (modalidade_imagem_id) REFERENCES modalidade_imagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_tipo_notificacao_agravo_id FOREIGN KEY (tipo_notificacao_agravo_id) REFERENCES tipo_notificacao_agravo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_desativado_por_usuario_id FOREIGN KEY (desativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE exame_analito
  ADD CONSTRAINT fk_exame_analito_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_analito_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_analito_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_analito_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_analito_grupo_resposta_id FOREIGN KEY (grupo_resposta_id) REFERENCES grupo_resposta (id) ON DELETE RESTRICT;
ALTER TABLE exame_equivalencia_codigo
  ADD CONSTRAINT fk_exame_equivalencia_codigo_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_equivalencia_codigo_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_equivalencia_codigo_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE exame_item
  ADD CONSTRAINT fk_exame_item_requisicao_exame_id FOREIGN KEY (requisicao_exame_id) REFERENCES requisicao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_recipiente_coleta_id FOREIGN KEY (recipiente_coleta_id) REFERENCES recipiente_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_tecnico_profissional_id FOREIGN KEY (tecnico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_realizado_por_usuario_id FOREIGN KEY (realizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_revisado_por_usuario_id FOREIGN KEY (revisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_item_motivo_cancelamento_item_exame_id FOREIGN KEY (motivo_cancelamento_item_exame_id) REFERENCES motivo_cancelamento_item_exame (id) ON DELETE RESTRICT;
ALTER TABLE exame_laboratorio_apoio
  ADD CONSTRAINT fk_exame_laboratorio_apoio_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_laboratorio_apoio_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_laboratorio_apoio_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE exame_lateralidade
  ADD CONSTRAINT fk_exame_lateralidade_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE exame_material
  ADD CONSTRAINT fk_exame_material_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_material_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_material_recipiente_coleta_id FOREIGN KEY (recipiente_coleta_id) REFERENCES recipiente_coleta (id) ON DELETE RESTRICT;
ALTER TABLE exame_orientacao_preparo
  ADD CONSTRAINT fk_exame_orientacao_preparo_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_orientacao_preparo_orientacao_preparo_id FOREIGN KEY (orientacao_preparo_id) REFERENCES orientacao_preparo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_orientacao_preparo_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_orientacao_preparo_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE exame_restricao_portal
  ADD CONSTRAINT fk_exame_restricao_portal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_restricao_portal_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE exame_secundario
  ADD CONSTRAINT fk_exame_secundario_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_secundario_secundario_exame_id FOREIGN KEY (secundario_exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_secundario_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_secundario_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE exame_setor_executante
  ADD CONSTRAINT fk_exame_setor_executante_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_setor_executante_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_setor_executante_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT;
ALTER TABLE exame_sitio_anatomico_coleta
  ADD CONSTRAINT fk_exame_sitio_anatomico_coleta_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_sitio_anatomico_coleta_sitio_anatomico_coleta_id FOREIGN KEY (sitio_anatomico_coleta_id) REFERENCES sitio_anatomico_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_exame_sitio_anatomico_coleta_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT;
ALTER TABLE excecao_restricao_exame
  ADD CONSTRAINT fk_excecao_restricao_exame_restricao_exame_id FOREIGN KEY (restricao_exame_id) REFERENCES restricao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_restricao_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_restricao_exame_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_restricao_exame_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_restricao_exame_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_restricao_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_restricao_exame_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE faixa_referencia
  ADD CONSTRAINT fk_faixa_referencia_exame_analito_id FOREIGN KEY (exame_analito_id) REFERENCES exame_analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_referencia_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_referencia_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_referencia_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_referencia_referencia_bibliografica_analise_id FOREIGN KEY (referencia_bibliografica_analise_id) REFERENCES referencia_bibliografica_analise (id) ON DELETE RESTRICT;
ALTER TABLE faixa_referencia_grandeza
  ADD CONSTRAINT fk_faixa_referencia_grandeza_grandeza_laudo_id FOREIGN KEY (grandeza_laudo_id) REFERENCES grandeza_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_referencia_grandeza_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT;
ALTER TABLE faixa_referencia_versao
  ADD CONSTRAINT fk_faixa_referencia_versao_faixa_referencia_id FOREIGN KEY (faixa_referencia_id) REFERENCES faixa_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_referencia_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE forma_entrega_resultado
  ADD CONSTRAINT fk_forma_entrega_resultado_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE formula_calculo
  ADD CONSTRAINT fk_formula_calculo_exame_analito_id FOREIGN KEY (exame_analito_id) REFERENCES exame_analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_calculo_grandeza_laudo_id FOREIGN KEY (grandeza_laudo_id) REFERENCES grandeza_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_calculo_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE grandeza_laudo
  ADD CONSTRAINT fk_grandeza_laudo_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grandeza_laudo_secao_laudo_estruturado_id FOREIGN KEY (secao_laudo_estruturado_id) REFERENCES secao_laudo_estruturado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grandeza_laudo_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE grupo_trabalho_bancada
  ADD CONSTRAINT fk_grupo_trabalho_bancada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_modelo_mapa_bancada_id FOREIGN KEY (modelo_mapa_bancada_id) REFERENCES modelo_mapa_bancada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_analista_usuario_id FOREIGN KEY (analista_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_aberto_por_usuario_id FOREIGN KEY (aberto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE grupo_trabalho_bancada_item
  ADD CONSTRAINT fk_grupo_trabalho_bancada_item_grupo_trabalho_bancada_id FOREIGN KEY (grupo_trabalho_bancada_id) REFERENCES grupo_trabalho_bancada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_item_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grupo_trabalho_bancada_item_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT;
ALTER TABLE guarda_amostra
  ADD CONSTRAINT fk_guarda_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guarda_amostra_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guarda_amostra_equipamento_guarda_amostra_id FOREIGN KEY (equipamento_guarda_amostra_id) REFERENCES equipamento_guarda_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guarda_amostra_suporte_guarda_amostra_id FOREIGN KEY (suporte_guarda_amostra_id) REFERENCES suporte_guarda_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_guarda_amostra_motivo_retirada_amostra_id FOREIGN KEY (motivo_retirada_amostra_id) REFERENCES motivo_retirada_amostra (id) ON DELETE RESTRICT;
ALTER TABLE hemocomponente
  ADD CONSTRAINT fk_hemocomponente_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_hemocomponente_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE interface_equipamento
  ADD CONSTRAINT fk_interface_equipamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interface_equipamento_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interface_equipamento_laboratorio_apoio_id FOREIGN KEY (laboratorio_apoio_id) REFERENCES laboratorio_apoio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interface_equipamento_modelo_comunicacao_id FOREIGN KEY (modelo_comunicacao_id) REFERENCES modelo_comunicacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_interface_equipamento_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT;
