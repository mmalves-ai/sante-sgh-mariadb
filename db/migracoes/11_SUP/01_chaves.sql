-- Módulo SUP, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE acrescimo_supressao_licitacao
  ADD CONSTRAINT fk_acrescimo_supressao_licitacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acrescimo_supressao_licitacao_processo_licitatorio_item_id FOREIGN KEY (processo_licitatorio_item_id) REFERENCES processo_licitatorio_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acrescimo_supressao_licitacao_empenho_id FOREIGN KEY (empenho_id) REFERENCES empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acrescimo_supressao_licitacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE adesao_ata_registro_preco
  ADD CONSTRAINT fk_adesao_ata_registro_preco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adesao_ata_registro_preco_ata_registro_preco_id FOREIGN KEY (ata_registro_preco_id) REFERENCES ata_registro_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adesao_ata_registro_preco_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adesao_ata_registro_preco_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adesao_ata_registro_preco_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adesao_ata_registro_preco_motivo_compra_publica_id FOREIGN KEY (motivo_compra_publica_id) REFERENCES motivo_compra_publica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adesao_ata_registro_preco_documentacao_conferida_por_usuario_ FOREIGN KEY (documentacao_conferida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adesao_ata_registro_preco_avaliador_usuario_id FOREIGN KEY (avaliador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apresentacao_comercial
  ADD CONSTRAINT fk_apresentacao_comercial_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apresentacao_comercial_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apresentacao_comercial_tipo_embalagem_insumo_id FOREIGN KEY (tipo_embalagem_insumo_id) REFERENCES tipo_embalagem_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apresentacao_comercial_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE ata_registro_preco
  ADD CONSTRAINT fk_ata_registro_preco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE ata_registro_preco_item
  ADD CONSTRAINT fk_ata_registro_preco_item_ata_registro_preco_id FOREIGN KEY (ata_registro_preco_id) REFERENCES ata_registro_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_item_processo_licitatorio_item_id FOREIGN KEY (processo_licitatorio_item_id) REFERENCES processo_licitatorio_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ata_registro_preco_item_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_requisicao
  ADD CONSTRAINT fk_atendimento_requisicao_requisicao_material_item_id FOREIGN KEY (requisicao_material_item_id) REFERENCES requisicao_material_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_insumo_atendido_id FOREIGN KEY (insumo_atendido_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_apresentacao_comercial_id FOREIGN KEY (apresentacao_comercial_id) REFERENCES apresentacao_comercial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_motivo_nao_atendimento_id FOREIGN KEY (motivo_nao_atendimento_id) REFERENCES motivo_nao_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_requisicao_atendido_por_usuario_id FOREIGN KEY (atendido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE atividade_economica
  ADD CONSTRAINT fk_atividade_economica_atividade_economica_pai_id FOREIGN KEY (atividade_economica_pai_id) REFERENCES atividade_economica (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_opme
  ADD CONSTRAINT fk_autorizacao_opme_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_solicitacao_opme_id FOREIGN KEY (solicitacao_opme_id) REFERENCES solicitacao_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_resposta_autorizacao_id FOREIGN KEY (resposta_autorizacao_id) REFERENCES resposta_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_opme_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_fornecedor
  ADD CONSTRAINT fk_avaliacao_fornecedor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_fornecedor_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_fornecedor_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_fornecedor_faixa_avaliacao_fornecedor_id FOREIGN KEY (faixa_avaliacao_fornecedor_id) REFERENCES faixa_avaliacao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_fornecedor_avaliador_usuario_id FOREIGN KEY (avaliador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_fornecedor_item
  ADD CONSTRAINT fk_avaliacao_fornecedor_item_avaliacao_fornecedor_id FOREIGN KEY (avaliacao_fornecedor_id) REFERENCES avaliacao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_fornecedor_item_criterio_avaliacao_fornecedor_id FOREIGN KEY (criterio_avaliacao_fornecedor_id) REFERENCES criterio_avaliacao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_fornecedor_item_questionario_homologacao_pergunta_i FOREIGN KEY (questionario_homologacao_pergunta_id) REFERENCES questionario_homologacao_pergunta (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_tecnica_produto
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_forma_apresentacao_medicamento_id FOREIGN KEY (forma_apresentacao_medicamento_id) REFERENCES forma_apresentacao_medicamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_programa_avaliacao_produto_id FOREIGN KEY (programa_avaliacao_produto_id) REFERENCES programa_avaliacao_produto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_modalidade_analise_produto_id FOREIGN KEY (modalidade_analise_produto_id) REFERENCES modalidade_analise_produto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_parecer_padrao_analise_produto_id FOREIGN KEY (parecer_padrao_analise_produto_id) REFERENCES parecer_padrao_analise_produto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_avaliador_usuario_id FOREIGN KEY (avaliador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_tecnica_produto_marca
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_marca_avaliacao_tecnica_produto_id FOREIGN KEY (avaliacao_tecnica_produto_id) REFERENCES avaliacao_tecnica_produto (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_tecnica_produto_marca_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE bloqueio_lote
  ADD CONSTRAINT fk_bloqueio_lote_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_lote_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_lote_alerta_sanitario_id FOREIGN KEY (alerta_sanitario_id) REFERENCES alerta_sanitario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_lote_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_lote_bloqueado_por_usuario_id FOREIGN KEY (bloqueado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_lote_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE capela_manipulacao
  ADD CONSTRAINT fk_capela_manipulacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_capela_manipulacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE capela_manipulacao_grupo
  ADD CONSTRAINT fk_capela_manipulacao_grupo_capela_manipulacao_id FOREIGN KEY (capela_manipulacao_id) REFERENCES capela_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_capela_manipulacao_grupo_grupo_manipulacao_id FOREIGN KEY (grupo_manipulacao_id) REFERENCES grupo_manipulacao (id) ON DELETE RESTRICT;
ALTER TABLE categoria_contabil_insumo
  ADD CONSTRAINT fk_categoria_contabil_insumo_conta_estoque_id FOREIGN KEY (conta_estoque_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_categoria_contabil_insumo_conta_consumo_id FOREIGN KEY (conta_consumo_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE classe_terapeutica
  ADD CONSTRAINT fk_classe_terapeutica_classe_terapeutica_pai_id FOREIGN KEY (classe_terapeutica_pai_id) REFERENCES classe_terapeutica (id) ON DELETE RESTRICT;
ALTER TABLE comprador_grupo_insumo
  ADD CONSTRAINT fk_comprador_grupo_insumo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comprador_grupo_insumo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comprador_grupo_insumo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comprador_grupo_insumo_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_opme
  ADD CONSTRAINT fk_conciliacao_opme_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_opme_solicitacao_opme_id FOREIGN KEY (solicitacao_opme_id) REFERENCES solicitacao_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_opme_autorizacao_opme_id FOREIGN KEY (autorizacao_opme_id) REFERENCES autorizacao_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_opme_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_opme_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_opme_conciliado_por_usuario_id FOREIGN KEY (conciliado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_kit_rastreavel
  ADD CONSTRAINT fk_conferencia_kit_rastreavel_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_kit_rastreavel_kit_rastreavel_id FOREIGN KEY (kit_rastreavel_id) REFERENCES kit_rastreavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_kit_rastreavel_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_manipulacao
  ADD CONSTRAINT fk_conferencia_manipulacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_manipulacao_ordem_manipulacao_id FOREIGN KEY (ordem_manipulacao_id) REFERENCES ordem_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_manipulacao_ordem_manipulacao_insumo_id FOREIGN KEY (ordem_manipulacao_insumo_id) REFERENCES ordem_manipulacao_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_manipulacao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_manipulacao_segundo_conferente_usuario_id FOREIGN KEY (segundo_conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_recebimento
  ADD CONSTRAINT fk_conferencia_recebimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_validador_usuario_id FOREIGN KEY (validador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_recebimento_item
  ADD CONSTRAINT fk_conferencia_recebimento_item_conferencia_recebimento_id FOREIGN KEY (conferencia_recebimento_id) REFERENCES conferencia_recebimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_item_pedido_compra_item_id FOREIGN KEY (pedido_compra_item_id) REFERENCES pedido_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_item_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_item_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conferencia_recebimento_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE conhecimento_transporte
  ADD CONSTRAINT fk_conhecimento_transporte_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conhecimento_transporte_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conhecimento_transporte_transportadora_empresa_fornecedora_id FOREIGN KEY (transportadora_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conhecimento_transporte_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conhecimento_transporte_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE consumo_centro_custo
  ADD CONSTRAINT fk_consumo_centro_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_centro_custo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_centro_custo_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_centro_custo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_centro_custo_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_centro_custo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE consumo_gas_medicinal
  ADD CONSTRAINT fk_consumo_gas_medicinal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_uso_gas_medicinal_id FOREIGN KEY (uso_gas_medicinal_id) REFERENCES uso_gas_medicinal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_ponto_consumo_gas_id FOREIGN KEY (ponto_consumo_gas_id) REFERENCES ponto_consumo_gas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_gas_medicinal_registrado_por_profissional_id FOREIGN KEY (registrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE consumo_opme
  ADD CONSTRAINT fk_consumo_opme_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_solicitacao_opme_item_id FOREIGN KEY (solicitacao_opme_item_id) REFERENCES solicitacao_opme_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_autorizacao_opme_id FOREIGN KEY (autorizacao_opme_id) REFERENCES autorizacao_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consumo_opme_registrado_por_usuario_id FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cota_consumo_setor
  ADD CONSTRAINT fk_cota_consumo_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_consumo_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_consumo_setor_local_estoque_origem_id FOREIGN KEY (local_estoque_origem_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_consumo_setor_local_estoque_destino_id FOREIGN KEY (local_estoque_destino_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_consumo_setor_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cota_consumo_setor_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE cotacao
  ADD CONSTRAINT fk_cotacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_comprador_usuario_id FOREIGN KEY (comprador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_portal_cotacao_id FOREIGN KEY (portal_cotacao_id) REFERENCES portal_cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_destino_entrega_compra_id FOREIGN KEY (destino_entrega_compra_id) REFERENCES destino_entrega_compra (id) ON DELETE RESTRICT;
ALTER TABLE cotacao_fornecedor
  ADD CONSTRAINT fk_cotacao_fornecedor_cotacao_id FOREIGN KEY (cotacao_id) REFERENCES cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_fornecedor_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_fornecedor_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_fornecedor_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE cotacao_item
  ADD CONSTRAINT fk_cotacao_item_cotacao_id FOREIGN KEY (cotacao_id) REFERENCES cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_item_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE cotacao_resposta_item
  ADD CONSTRAINT fk_cotacao_resposta_item_cotacao_fornecedor_id FOREIGN KEY (cotacao_fornecedor_id) REFERENCES cotacao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_resposta_item_cotacao_item_id FOREIGN KEY (cotacao_item_id) REFERENCES cotacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotacao_resposta_item_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE custo_indireto_producao_valor
  ADD CONSTRAINT fk_custo_indireto_producao_valor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_indireto_producao_valor_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_indireto_producao_valor_custo_indireto_producao_id FOREIGN KEY (custo_indireto_producao_id) REFERENCES custo_indireto_producao (id) ON DELETE RESTRICT;
ALTER TABLE custo_medio_historico
  ADD CONSTRAINT fk_custo_medio_historico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_medio_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_medio_historico_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_medio_historico_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_custo_medio_historico_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE destino_entrega_compra
  ADD CONSTRAINT fk_destino_entrega_compra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_destino_entrega_compra_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_destino_entrega_compra_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE devolucao_dispensacao
  ADD CONSTRAINT fk_devolucao_dispensacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_motivo_devolucao_estoque_id FOREIGN KEY (motivo_devolucao_estoque_id) REFERENCES motivo_devolucao_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_devolvido_por_profissional_id FOREIGN KEY (devolvido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE devolucao_dispensacao_item
  ADD CONSTRAINT fk_devolucao_dispensacao_item_devolucao_dispensacao_id FOREIGN KEY (devolucao_dispensacao_id) REFERENCES devolucao_dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_item_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_item_apresentacao_comercial_id FOREIGN KEY (apresentacao_comercial_id) REFERENCES apresentacao_comercial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_dispensacao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE devolucao_fornecedor
  ADD CONSTRAINT fk_devolucao_fornecedor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_motivo_devolucao_fornecedor_id FOREIGN KEY (motivo_devolucao_fornecedor_id) REFERENCES motivo_devolucao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE devolucao_fornecedor_item
  ADD CONSTRAINT fk_devolucao_fornecedor_item_devolucao_fornecedor_id FOREIGN KEY (devolucao_fornecedor_id) REFERENCES devolucao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_item_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_devolucao_fornecedor_item_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT;
