-- Chaves do módulo SUP, lote 02 (aplicadas depois de todos os tabelas.sql).
ALTER TABLE empresa_fornecedora
  ADD CONSTRAINT fk_empresa_fornecedora_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_tipo_credor_id FOREIGN KEY (tipo_credor_id) REFERENCES tipo_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_principal_categoria_fornecimento_id FOREIGN KEY (principal_categoria_fornecimento_id) REFERENCES categoria_fornecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_faixa_avaliacao_fornecedor_id FOREIGN KEY (faixa_avaliacao_fornecedor_id) REFERENCES faixa_avaliacao_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE empresa_fornecedora_autorizacao
  ADD CONSTRAINT fk_empresa_fornecedora_autorizacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_autorizacao_tipo_documento_processo_compr FOREIGN KEY (tipo_documento_processo_compra_id) REFERENCES tipo_documento_processo_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_autorizacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE empresa_fornecedora_categoria
  ADD CONSTRAINT fk_empresa_fornecedora_categoria_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_categoria_categoria_fornecimento_id FOREIGN KEY (categoria_fornecimento_id) REFERENCES categoria_fornecimento (id) ON DELETE RESTRICT;
ALTER TABLE empresa_fornecedora_contato
  ADD CONSTRAINT fk_empresa_fornecedora_contato_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empresa_fornecedora_contato_tipo_telefone_id FOREIGN KEY (tipo_telefone_id) REFERENCES tipo_telefone (id) ON DELETE RESTRICT;
ALTER TABLE fabricante
  ADD CONSTRAINT fk_fabricante_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE fabricante_fornecedor
  ADD CONSTRAINT fk_fabricante_fornecedor_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fabricante_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE insumo
  ADD CONSTRAINT fk_insumo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_categoria_contabil_insumo_id FOREIGN KEY (categoria_contabil_insumo_id) REFERENCES categoria_contabil_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_referencia_insumo_id FOREIGN KEY (referencia_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_forma_apresentacao_medicamento_id FOREIGN KEY (forma_apresentacao_medicamento_id) REFERENCES forma_apresentacao_medicamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_lista_controle_especial_id FOREIGN KEY (lista_controle_especial_id) REFERENCES lista_controle_especial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_tipo_embalagem_insumo_id FOREIGN KEY (tipo_embalagem_insumo_id) REFERENCES tipo_embalagem_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_condicao_armazenamento_id FOREIGN KEY (condicao_armazenamento_id) REFERENCES condicao_armazenamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_estoque_unidade_medida_id FOREIGN KEY (estoque_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_compra_unidade_medida_id FOREIGN KEY (compra_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_consumo_unidade_medida_id FOREIGN KEY (consumo_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_prescricao_unidade_medida_id FOREIGN KEY (prescricao_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE insumo_estabelecimento
  ADD CONSTRAINT fk_insumo_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_estabelecimento_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_estabelecimento_padrao_local_estoque_id FOREIGN KEY (padrao_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_estabelecimento_principal_empresa_fornecedora_id FOREIGN KEY (principal_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE insumo_classe_terapeutica
  ADD CONSTRAINT fk_insumo_classe_terapeutica_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_classe_terapeutica_classe_terapeutica_id FOREIGN KEY (classe_terapeutica_id) REFERENCES classe_terapeutica (id) ON DELETE RESTRICT;
ALTER TABLE insumo_codigo_barras
  ADD CONSTRAINT fk_insumo_codigo_barras_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_codigo_barras_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_codigo_barras_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_codigo_barras_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE insumo_fornecedor
  ADD CONSTRAINT fk_insumo_fornecedor_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_fornecedor_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_fornecedor_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE estabilidade_insumo
  ADD CONSTRAINT fk_estabilidade_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabilidade_insumo_condicao_armazenamento_id FOREIGN KEY (condicao_armazenamento_id) REFERENCES condicao_armazenamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabilidade_insumo_diluente_insumo_id FOREIGN KEY (diluente_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE especialidade_classe_insumo
  ADD CONSTRAINT fk_especialidade_classe_insumo_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_classe_insumo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_classe_insumo_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_classe_insumo_classe_terapeutica_id FOREIGN KEY (classe_terapeutica_id) REFERENCES classe_terapeutica (id) ON DELETE RESTRICT;
ALTER TABLE endereco_armazem
  ADD CONSTRAINT fk_endereco_armazem_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_armazem_superior_endereco_armazem_id FOREIGN KEY (superior_endereco_armazem_id) REFERENCES endereco_armazem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_armazem_condicao_armazenamento_id FOREIGN KEY (condicao_armazenamento_id) REFERENCES condicao_armazenamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_armazem_capacidade_unidade_medida_id FOREIGN KEY (capacidade_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE insumo_endereco
  ADD CONSTRAINT fk_insumo_endereco_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_endereco_endereco_armazem_id FOREIGN KEY (endereco_armazem_id) REFERENCES endereco_armazem (id) ON DELETE RESTRICT;
ALTER TABLE etiqueta_identificacao
  ADD CONSTRAINT fk_etiqueta_identificacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_ordem_unitarizacao_id FOREIGN KEY (ordem_unitarizacao_id) REFERENCES ordem_unitarizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_modelo_etiqueta_id FOREIGN KEY (modelo_etiqueta_id) REFERENCES modelo_etiqueta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_identificacao_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE dose_unitarizada
  ADD CONSTRAINT fk_dose_unitarizada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_unitarizada_ordem_unitarizacao_id FOREIGN KEY (ordem_unitarizacao_id) REFERENCES ordem_unitarizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_unitarizada_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_unitarizada_origem_lote_insumo_id FOREIGN KEY (origem_lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_unitarizada_etiqueta_identificacao_id FOREIGN KEY (etiqueta_identificacao_id) REFERENCES etiqueta_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_unitarizada_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_unitarizada_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE dispensacao
  ADD CONSTRAINT fk_dispensacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_dispensado_usuario_id FOREIGN KEY (dispensado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE dispensacao_item
  ADD CONSTRAINT fk_dispensacao_item_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_item_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dispensacao_item_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE dose_dispensada
  ADD CONSTRAINT fk_dose_dispensada_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_dispensada_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_dispensada_dose_unitarizada_id FOREIGN KEY (dose_unitarizada_id) REFERENCES dose_unitarizada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_dispensada_etiqueta_identificacao_id FOREIGN KEY (etiqueta_identificacao_id) REFERENCES etiqueta_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dose_dispensada_emissor_usuario_id FOREIGN KEY (emissor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE entrega_setor
  ADD CONSTRAINT fk_entrega_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_origem_local_estoque_id FOREIGN KEY (origem_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_situacao_farmaceutica_id FOREIGN KEY (situacao_farmaceutica_id) REFERENCES situacao_farmaceutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_entregador_usuario_id FOREIGN KEY (entregador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE entrega_setor_item
  ADD CONSTRAINT fk_entrega_setor_item_entrega_setor_id FOREIGN KEY (entrega_setor_id) REFERENCES entrega_setor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_item_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_entrega_setor_item_dose_dispensada_id FOREIGN KEY (dose_dispensada_id) REFERENCES dose_dispensada (id) ON DELETE RESTRICT;
ALTER TABLE horario_padrao_medicacao
  ADD CONSTRAINT fk_horario_padrao_medicacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_padrao_medicacao_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_horario_padrao_medicacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE documento_estoque
  ADD CONSTRAINT fk_documento_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_tipo_movimento_estoque_id FOREIGN KEY (tipo_movimento_estoque_id) REFERENCES tipo_movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_origem_local_estoque_id FOREIGN KEY (origem_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_destino_local_estoque_id FOREIGN KEY (destino_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_motivo_ajuste_estoque_id FOREIGN KEY (motivo_ajuste_estoque_id) REFERENCES motivo_ajuste_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_motivo_devolucao_estoque_id FOREIGN KEY (motivo_devolucao_estoque_id) REFERENCES motivo_devolucao_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_motivo_baixa_estoque_id FOREIGN KEY (motivo_baixa_estoque_id) REFERENCES motivo_baixa_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_concluido_usuario_id FOREIGN KEY (concluido_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE documento_estoque_item
  ADD CONSTRAINT fk_documento_estoque_item_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_requisicao_material_item_id FOREIGN KEY (requisicao_material_item_id) REFERENCES requisicao_material_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_estoque_item_endereco_armazem_id FOREIGN KEY (endereco_armazem_id) REFERENCES endereco_armazem (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_estoque
  ADD CONSTRAINT fk_fechamento_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_estoque_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_estoque_consolidacao_usuario_id FOREIGN KEY (consolidacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_estoque_reabertura_usuario_id FOREIGN KEY (reabertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE emprestimo_insumo
  ADD CONSTRAINT fk_emprestimo_insumo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_insumo_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_insumo_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_insumo_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT;
ALTER TABLE emprestimo_insumo_item
  ADD CONSTRAINT fk_emprestimo_insumo_item_emprestimo_insumo_id FOREIGN KEY (emprestimo_insumo_id) REFERENCES emprestimo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_insumo_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_insumo_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_insumo_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emprestimo_insumo_item_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE envio_controlado_nacional
  ADD CONSTRAINT fk_envio_controlado_nacional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_retorno_arquivo_id FOREIGN KEY (retorno_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE envio_controlado_nacional_item
  ADD CONSTRAINT fk_envio_controlado_nacional_item_envio_controlado_nacional_id FOREIGN KEY (envio_controlado_nacional_id) REFERENCES envio_controlado_nacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_item_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_item_livro_controlado_id FOREIGN KEY (livro_controlado_id) REFERENCES livro_controlado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_controlado_nacional_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE empenho
  ADD CONSTRAINT fk_empenho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_tipo_empenho_id FOREIGN KEY (tipo_empenho_id) REFERENCES tipo_empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE empenho_item
  ADD CONSTRAINT fk_empenho_item_empenho_id FOREIGN KEY (empenho_id) REFERENCES empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_item_pedido_compra_item_id FOREIGN KEY (pedido_compra_item_id) REFERENCES pedido_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_empenho_item_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE equipe_licitacao
  ADD CONSTRAINT fk_equipe_licitacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_licitacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE equipe_licitacao_processo
  ADD CONSTRAINT fk_equipe_licitacao_processo_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_licitacao_processo_equipe_licitacao_id FOREIGN KEY (equipe_licitacao_id) REFERENCES equipe_licitacao (id) ON DELETE RESTRICT;
ALTER TABLE excecao_avaliacao_fornecedor
  ADD CONSTRAINT fk_excecao_avaliacao_fornecedor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_avaliacao_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_avaliacao_fornecedor_categoria_fornecimento_id FOREIGN KEY (categoria_fornecimento_id) REFERENCES categoria_fornecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_avaliacao_fornecedor_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_avaliacao_fornecedor_tipo_entrada_estoque_id FOREIGN KEY (tipo_entrada_estoque_id) REFERENCES tipo_entrada_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_avaliacao_fornecedor_tipo_documento_processo_compra_i FOREIGN KEY (tipo_documento_processo_compra_id) REFERENCES tipo_documento_processo_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_excecao_avaliacao_fornecedor_questionario_homologacao_id FOREIGN KEY (questionario_homologacao_id) REFERENCES questionario_homologacao (id) ON DELETE RESTRICT;
ALTER TABLE faixa_taxa_consignacao
  ADD CONSTRAINT fk_faixa_taxa_consignacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_taxa_consignacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_taxa_consignacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_taxa_consignacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE homologacao_fornecedor
  ADD CONSTRAINT fk_homologacao_fornecedor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_questionario_homologacao_id FOREIGN KEY (questionario_homologacao_id) REFERENCES questionario_homologacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_categoria_fornecimento_id FOREIGN KEY (categoria_fornecimento_id) REFERENCES categoria_fornecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_avaliador_usuario_id FOREIGN KEY (avaliador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_faixa_avaliacao_fornecedor_id FOREIGN KEY (faixa_avaliacao_fornecedor_id) REFERENCES faixa_avaliacao_fornecedor (id) ON DELETE RESTRICT;
ALTER TABLE homologacao_fornecedor_resposta
  ADD CONSTRAINT fk_homologacao_fornecedor_resposta_homologacao_fornecedor_id FOREIGN KEY (homologacao_fornecedor_id) REFERENCES homologacao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_resposta_questionario_homologacao_perg FOREIGN KEY (questionario_homologacao_pergunta_id) REFERENCES questionario_homologacao_pergunta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_homologacao_fornecedor_resposta_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE formula_padrao_manipulacao
  ADD CONSTRAINT fk_formula_padrao_manipulacao_produto_insumo_id FOREIGN KEY (produto_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_padrao_manipulacao_grupo_manipulacao_id FOREIGN KEY (grupo_manipulacao_id) REFERENCES grupo_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_padrao_manipulacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_padrao_manipulacao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE formula_padrao_manipulacao_item
  ADD CONSTRAINT fk_formula_padrao_manipulacao_item_formula_padrao_manipulacao_id FOREIGN KEY (formula_padrao_manipulacao_id) REFERENCES formula_padrao_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_padrao_manipulacao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_formula_padrao_manipulacao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
