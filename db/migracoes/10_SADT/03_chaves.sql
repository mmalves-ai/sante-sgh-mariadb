-- SADT, lote 03 (F1.3): chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE intervalo_repeticao_exame
  ADD CONSTRAINT fk_intervalo_repeticao_exame_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_repeticao_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_repeticao_exame_exame_conflitante_id FOREIGN KEY (exame_conflitante_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervalo_repeticao_exame_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE isolado_microbiano
  ADD CONSTRAINT fk_isolado_microbiano_resultado_cultura_id FOREIGN KEY (resultado_cultura_id) REFERENCES resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolado_microbiano_microrganismo_id FOREIGN KEY (microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolado_microbiano_faixa_contagem_colonia_id FOREIGN KEY (faixa_contagem_colonia_id) REFERENCES faixa_contagem_colonia (id) ON DELETE RESTRICT;
ALTER TABLE item_exame_equipe
  ADD CONSTRAINT fk_item_exame_equipe_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_equipe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_equipe_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE item_exame_evento
  ADD CONSTRAINT fk_item_exame_evento_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_evento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_evento_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_evento_motivo_cancelamento_item_exame_id FOREIGN KEY (motivo_cancelamento_item_exame_id) REFERENCES motivo_cancelamento_item_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_evento_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE item_exame_insumo
  ADD CONSTRAINT fk_item_exame_insumo_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_insumo_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_insumo_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_insumo_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_insumo_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_exame_insumo_consumo_padrao_exame_id FOREIGN KEY (consumo_padrao_exame_id) REFERENCES consumo_padrao_exame (id) ON DELETE RESTRICT;
ALTER TABLE item_lista_trabalho_imagem
  ADD CONSTRAINT fk_item_lista_trabalho_imagem_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lista_trabalho_imagem_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lista_trabalho_imagem_modalidade_imagem_id FOREIGN KEY (modalidade_imagem_id) REFERENCES modalidade_imagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lista_trabalho_imagem_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lista_trabalho_imagem_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_lista_trabalho_imagem_estudo_imagem_id FOREIGN KEY (estudo_imagem_id) REFERENCES estudo_imagem (id) ON DELETE RESTRICT;
ALTER TABLE kit_exame_item
  ADD CONSTRAINT fk_kit_exame_item_kit_exame_id FOREIGN KEY (kit_exame_id) REFERENCES kit_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_exame_item_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_exame_item_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_exame_item_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE kit_exame_versao
  ADD CONSTRAINT fk_kit_exame_versao_kit_exame_id FOREIGN KEY (kit_exame_id) REFERENCES kit_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_exame_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE kit_exame_versao_item
  ADD CONSTRAINT fk_kit_exame_versao_item_kit_exame_versao_id FOREIGN KEY (kit_exame_versao_id) REFERENCES kit_exame_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_exame_versao_item_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_exame_versao_item_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_exame_versao_item_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT;
ALTER TABLE laboratorio_apoio
  ADD CONSTRAINT fk_laboratorio_apoio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laboratorio_apoio_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE laudo_anatomopatologico
  ADD CONSTRAINT fk_laudo_anatomopatologico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_patologista_profissional_id FOREIGN KEY (patologista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_topografia_termo_id FOREIGN KEY (topografia_termo_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_morfologia_termo_id FOREIGN KEY (morfologia_termo_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_diagnostico_termo_id FOREIGN KEY (diagnostico_termo_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_grau_histologico_id FOREIGN KEY (grau_histologico_id) REFERENCES grau_histologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE laudo_diagnostico
  ADD CONSTRAINT fk_laudo_diagnostico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_modelo_laudo_id FOREIGN KEY (modelo_laudo_id) REFERENCES modelo_laudo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_laudista_profissional_id FOREIGN KEY (laudista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_revisor_profissional_id FOREIGN KEY (revisor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_tecnico_profissional_id FOREIGN KEY (tecnico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_diagnostico_termo_id FOREIGN KEY (diagnostico_termo_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_assinado_por_usuario_id FOREIGN KEY (assinado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_emitido_por_usuario_id FOREIGN KEY (emitido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_achado_critico_comunicado_por_usuario_id FOREIGN KEY (achado_critico_comunicado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE laudo_diagnostico_versao
  ADD CONSTRAINT fk_laudo_diagnostico_versao_laudo_diagnostico_id FOREIGN KEY (laudo_diagnostico_id) REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_versao_laudista_profissional_id FOREIGN KEY (laudista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_versao_assinatura_documento_id FOREIGN KEY (assinatura_documento_id) REFERENCES assinatura_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_diagnostico_versao_motivo_retificacao_laudo_id FOREIGN KEY (motivo_retificacao_laudo_id) REFERENCES motivo_retificacao_laudo (id) ON DELETE RESTRICT;
ALTER TABLE laudo_mama
  ADD CONSTRAINT fk_laudo_mama_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_laudo_diagnostico_id FOREIGN KEY (laudo_diagnostico_id) REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_categoria_direita_id FOREIGN KEY (categoria_direita_id) REFERENCES categoria_achado_mama (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_categoria_esquerda_id FOREIGN KEY (categoria_esquerda_id) REFERENCES categoria_achado_mama (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_laudista_profissional_id FOREIGN KEY (laudista_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE laudo_palavra_chave
  ADD CONSTRAINT fk_laudo_palavra_chave_laudo_diagnostico_id FOREIGN KEY (laudo_diagnostico_id) REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_palavra_chave_palavra_chave_laudo_id FOREIGN KEY (palavra_chave_laudo_id) REFERENCES palavra_chave_laudo (id) ON DELETE RESTRICT;
ALTER TABLE leitura_cultura
  ADD CONSTRAINT fk_leitura_cultura_resultado_cultura_id FOREIGN KEY (resultado_cultura_id) REFERENCES resultado_cultura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leitura_cultura_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_exame
  ADD CONSTRAINT fk_liberacao_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_exame_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_exame_resultado_exame_id FOREIGN KEY (resultado_exame_id) REFERENCES resultado_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_exame_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_exame_assinatura_documento_id FOREIGN KEY (assinatura_documento_id) REFERENCES assinatura_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_exame_motivo_liberacao_resultado_id FOREIGN KEY (motivo_liberacao_resultado_id) REFERENCES motivo_liberacao_resultado (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_excecao_exame
  ADD CONSTRAINT fk_liberacao_excecao_exame_exame_item_id FOREIGN KEY (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_cota_exame_id FOREIGN KEY (cota_exame_id) REFERENCES cota_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_intervalo_repeticao_exame_id FOREIGN KEY (intervalo_repeticao_exame_id) REFERENCES intervalo_repeticao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_bloqueio_exame_resultado_id FOREIGN KEY (bloqueio_exame_resultado_id) REFERENCES bloqueio_exame_resultado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_restricao_exame_id FOREIGN KEY (restricao_exame_id) REFERENCES restricao_exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_autorizador_profissional_id FOREIGN KEY (autorizador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_excecao_exame_motivo_restricao_exame_id FOREIGN KEY (motivo_restricao_exame_id) REFERENCES motivo_restricao_exame (id) ON DELETE RESTRICT;
ALTER TABLE limite_delta_analito
  ADD CONSTRAINT fk_limite_delta_analito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_delta_analito_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_delta_analito_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_delta_analito_unidade_resultado_id FOREIGN KEY (unidade_resultado_id) REFERENCES unidade_resultado (id) ON DELETE RESTRICT;
ALTER TABLE local_entrega_resultado
  ADD CONSTRAINT fk_local_entrega_resultado_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE local_guarda_hemocomponente
  ADD CONSTRAINT fk_local_guarda_hemocomponente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE lote_etiqueta_coleta
  ADD CONSTRAINT fk_lote_etiqueta_coleta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_etiqueta_coleta_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_etiqueta_coleta_ponto_coleta_id FOREIGN KEY (ponto_coleta_id) REFERENCES ponto_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_etiqueta_coleta_gerado_por_usuario_id FOREIGN KEY (gerado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_transporte_amostra
  ADD CONSTRAINT fk_lote_transporte_amostra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_ponto_coleta_id FOREIGN KEY (ponto_coleta_id) REFERENCES ponto_coleta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_destino_setor_diagnostico_id FOREIGN KEY (destino_setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_enviado_por_usuario_id FOREIGN KEY (enviado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_recebido_por_usuario_id FOREIGN KEY (recebido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_transporte_amostra_item
  ADD CONSTRAINT fk_lote_transporte_amostra_item_lote_transporte_amostra_id FOREIGN KEY (lote_transporte_amostra_id) REFERENCES lote_transporte_amostra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_item_amostra_biologica_id FOREIGN KEY (amostra_biologica_id) REFERENCES amostra_biologica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_transporte_amostra_item_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE material_controle_qualidade
  ADD CONSTRAINT fk_material_controle_qualidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_controle_qualidade_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_controle_qualidade_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_controle_qualidade_equipamento_analitico_id FOREIGN KEY (equipamento_analitico_id) REFERENCES equipamento_analitico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_controle_qualidade_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT;
ALTER TABLE microrganismo
  ADD CONSTRAINT fk_microrganismo_painel_antibiograma_id FOREIGN KEY (painel_antibiograma_id) REFERENCES painel_antibiograma (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_microrganismo_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE microrganismo_notificacao
  ADD CONSTRAINT fk_microrganismo_notificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_microrganismo_notificacao_microrganismo_id FOREIGN KEY (microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_microrganismo_notificacao_diagnostico_termo_id FOREIGN KEY (diagnostico_termo_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_microrganismo_notificacao_regra_alerta_id FOREIGN KEY (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT;
ALTER TABLE modelo_etiqueta_amostra_biologica
  ADD CONSTRAINT fk_modelo_etiqueta_amostra_biologica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_amostra_biologica_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_etiqueta_amostra_biologica_recipiente_coleta_id FOREIGN KEY (recipiente_coleta_id) REFERENCES recipiente_coleta (id) ON DELETE RESTRICT;
ALTER TABLE modelo_impressao_laudo
  ADD CONSTRAINT fk_modelo_impressao_laudo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_impressao_laudo_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_impressao_laudo_cabecalho_arquivo_id FOREIGN KEY (cabecalho_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_impressao_laudo_rodape_arquivo_id FOREIGN KEY (rodape_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE modelo_laudo
  ADD CONSTRAINT fk_modelo_laudo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_laudo_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_laudo_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_laudo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE modelo_mapa_bancada
  ADD CONSTRAINT fk_modelo_mapa_bancada_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_mapa_bancada_bancada_analitica_id FOREIGN KEY (bancada_analitica_id) REFERENCES bancada_analitica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_mapa_bancada_suporte_guarda_amostra_id FOREIGN KEY (suporte_guarda_amostra_id) REFERENCES suporte_guarda_amostra (id) ON DELETE RESTRICT;
ALTER TABLE modelo_mapa_bancada_exame
  ADD CONSTRAINT fk_modelo_mapa_bancada_exame_modelo_mapa_bancada_id FOREIGN KEY (modelo_mapa_bancada_id) REFERENCES modelo_mapa_bancada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_mapa_bancada_exame_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_mapa_bancada_exame_analito_id FOREIGN KEY (analito_id) REFERENCES analito (id) ON DELETE RESTRICT;
ALTER TABLE modelo_resultado
  ADD CONSTRAINT fk_modelo_resultado_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_resultado_material_biologico_id FOREIGN KEY (material_biologico_id) REFERENCES material_biologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_resultado_setor_diagnostico_id FOREIGN KEY (setor_diagnostico_id) REFERENCES setor_diagnostico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_resultado_metodo_analitico_id FOREIGN KEY (metodo_analitico_id) REFERENCES metodo_analitico (id) ON DELETE RESTRICT;
ALTER TABLE monitoramento_transfusao
  ADD CONSTRAINT fk_monitoramento_transfusao_ato_transfusional_id FOREIGN KEY (ato_transfusional_id) REFERENCES ato_transfusional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_monitoramento_transfusao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
