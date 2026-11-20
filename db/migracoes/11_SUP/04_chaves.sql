-- 11_SUP, lote 04: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE nota_entrada
  ADD CONSTRAINT fk_nota_entrada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_tipo_entrada_estoque_id FOREIGN KEY (tipo_entrada_estoque_id) REFERENCES tipo_entrada_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_empenho_id FOREIGN KEY (empenho_id) REFERENCES empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_recebido_por_usuario_id FOREIGN KEY (recebido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_transportadora_empresa_fornecedora_id FOREIGN KEY (transportadora_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_conhecimento_transporte_id FOREIGN KEY (conhecimento_transporte_id) REFERENCES conhecimento_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_nota_corrigida_id FOREIGN KEY (nota_corrigida_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_xml_arquivo_id FOREIGN KEY (xml_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_confirmada_por_usuario_id FOREIGN KEY (confirmada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE nota_entrada_atendimento
  ADD CONSTRAINT fk_nota_entrada_atendimento_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_atendimento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE nota_entrada_cambio
  ADD CONSTRAINT fk_nota_entrada_cambio_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_cambio_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT;
ALTER TABLE nota_entrada_imposto
  ADD CONSTRAINT fk_nota_entrada_imposto_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_imposto_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_imposto_dado_fiscal_item_id FOREIGN KEY (dado_fiscal_item_id) REFERENCES dado_fiscal_item (id) ON DELETE RESTRICT;
ALTER TABLE nota_entrada_item
  ADD CONSTRAINT fk_nota_entrada_item_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_pedido_compra_item_id FOREIGN KEY (pedido_compra_item_id) REFERENCES pedido_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_registro_sanitario_id FOREIGN KEY (registro_sanitario_id) REFERENCES registro_sanitario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nota_entrada_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_fornecedor
  ADD CONSTRAINT fk_ocorrencia_fornecedor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_fornecedor_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_fornecedor_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_fornecedor_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_fornecedor_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_fornecedor_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_fornecedor_devolucao_fornecedor_id FOREIGN KEY (devolucao_fornecedor_id) REFERENCES devolucao_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_fornecedor_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ordem_manipulacao
  ADD CONSTRAINT fk_ordem_manipulacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_prescricao_item_solucao_id FOREIGN KEY (prescricao_item_solucao_id) REFERENCES prescricao_item_solucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_formula_padrao_manipulacao_id FOREIGN KEY (formula_padrao_manipulacao_id) REFERENCES formula_padrao_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_capela_manipulacao_id FOREIGN KEY (capela_manipulacao_id) REFERENCES capela_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_grupo_manipulacao_id FOREIGN KEY (grupo_manipulacao_id) REFERENCES grupo_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_lote_produzido_id FOREIGN KEY (lote_produzido_id) REFERENCES lote_produzido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_preparado_por_profissional_id FOREIGN KEY (preparado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_conferido_por_profissional_id FOREIGN KEY (conferido_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE ordem_manipulacao_insumo
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_ordem_manipulacao_id FOREIGN KEY (ordem_manipulacao_id) REFERENCES ordem_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_pesado_por_usuario_id FOREIGN KEY (pesado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_conferido_por_usuario_id FOREIGN KEY (conferido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_manipulacao_insumo_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE ordem_separacao
  ADD CONSTRAINT fk_ordem_separacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_separador_usuario_id FOREIGN KEY (separador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_validada_por_usuario_id FOREIGN KEY (validada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ordem_separacao_item
  ADD CONSTRAINT fk_ordem_separacao_item_ordem_separacao_id FOREIGN KEY (ordem_separacao_id) REFERENCES ordem_separacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_item_requisicao_material_item_id FOREIGN KEY (requisicao_material_item_id) REFERENCES requisicao_material_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_item_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_item_endereco_armazem_id FOREIGN KEY (endereco_armazem_id) REFERENCES endereco_armazem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_separacao_item_motivo_nao_atendimento_id FOREIGN KEY (motivo_nao_atendimento_id) REFERENCES motivo_nao_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE ordem_unitarizacao
  ADD CONSTRAINT fk_ordem_unitarizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_capela_manipulacao_id FOREIGN KEY (capela_manipulacao_id) REFERENCES capela_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_regra_fracionamento_insumo_id FOREIGN KEY (regra_fracionamento_insumo_id) REFERENCES regra_fracionamento_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_farmaceutico_profissional_id FOREIGN KEY (farmaceutico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ordem_unitarizacao_item
  ADD CONSTRAINT fk_ordem_unitarizacao_item_ordem_unitarizacao_id FOREIGN KEY (ordem_unitarizacao_id) REFERENCES ordem_unitarizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_origem_insumo_id FOREIGN KEY (origem_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_origem_lote_insumo_id FOREIGN KEY (origem_lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_origem_unidade_medida_id FOREIGN KEY (origem_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_resultante_insumo_id FOREIGN KEY (resultante_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_resultante_lote_insumo_id FOREIGN KEY (resultante_lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_resultante_unidade_medida_id FOREIGN KEY (resultante_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_motivo_baixa_estoque_id FOREIGN KEY (motivo_baixa_estoque_id) REFERENCES motivo_baixa_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordem_unitarizacao_item_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE padrao_leitura_codigo
  ADD CONSTRAINT fk_padrao_leitura_codigo_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE parametro_reposicao
  ADD CONSTRAINT fk_parametro_reposicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_reposicao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_reposicao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_parametro_reposicao_nivel_servico_id FOREIGN KEY (nivel_servico_id) REFERENCES nivel_servico (id) ON DELETE RESTRICT;
ALTER TABLE parecer_padrao_analise_produto
  ADD CONSTRAINT fk_parecer_padrao_analise_produto_modalidade_analise_produto_id FOREIGN KEY (modalidade_analise_produto_id) REFERENCES modalidade_analise_produto (id) ON DELETE RESTRICT;
ALTER TABLE pedido_compra
  ADD CONSTRAINT fk_pedido_compra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_cotacao_id FOREIGN KEY (cotacao_id) REFERENCES cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_ata_registro_preco_id FOREIGN KEY (ata_registro_preco_id) REFERENCES ata_registro_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_contrato_fornecedor_id FOREIGN KEY (contrato_fornecedor_id) REFERENCES contrato_fornecedor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_empenho_id FOREIGN KEY (empenho_id) REFERENCES empenho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_origem_recurso_compra_id FOREIGN KEY (origem_recurso_compra_id) REFERENCES origem_recurso_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_portal_cotacao_id FOREIGN KEY (portal_cotacao_id) REFERENCES portal_cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_destino_entrega_compra_id FOREIGN KEY (destino_entrega_compra_id) REFERENCES destino_entrega_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_comprador_usuario_id FOREIGN KEY (comprador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE pedido_compra_acompanhamento
  ADD CONSTRAINT fk_pedido_compra_acompanhamento_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_acompanhamento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_acompanhamento_acompanhamento_anterior_id FOREIGN KEY (acompanhamento_anterior_id) REFERENCES pedido_compra_acompanhamento (id) ON DELETE RESTRICT;
ALTER TABLE pedido_compra_entrega
  ADD CONSTRAINT fk_pedido_compra_entrega_pedido_compra_item_id FOREIGN KEY (pedido_compra_item_id) REFERENCES pedido_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_entrega_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE pedido_compra_item
  ADD CONSTRAINT fk_pedido_compra_item_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_registro_sanitario_id FOREIGN KEY (registro_sanitario_id) REFERENCES registro_sanitario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_cotacao_item_id FOREIGN KEY (cotacao_item_id) REFERENCES cotacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_ata_registro_preco_item_id FOREIGN KEY (ata_registro_preco_item_id) REFERENCES ata_registro_preco_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_empenho_item_id FOREIGN KEY (empenho_item_id) REFERENCES empenho_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_item_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE pedido_compra_parcela
  ADD CONSTRAINT fk_pedido_compra_parcela_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_compra_parcela_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_processo_compra
  ADD CONSTRAINT fk_pendencia_processo_compra_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_processo_compra_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_processo_compra_cotacao_id FOREIGN KEY (cotacao_id) REFERENCES cotacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_processo_compra_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_processo_compra_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_processo_compra_liberada_por_usuario_id FOREIGN KEY (liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pesquisa_preco
  ADD CONSTRAINT fk_pesquisa_preco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pesquisa_preco_item
  ADD CONSTRAINT fk_pesquisa_preco_item_pesquisa_preco_id FOREIGN KEY (pesquisa_preco_id) REFERENCES pesquisa_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_item_processo_licitatorio_item_id FOREIGN KEY (processo_licitatorio_item_id) REFERENCES processo_licitatorio_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pesquisa_preco_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE ponto_consumo_gas
  ADD CONSTRAINT fk_ponto_consumo_gas_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_consumo_gas_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_consumo_gas_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponto_consumo_gas_sala_cirurgica_id FOREIGN KEY (sala_cirurgica_id) REFERENCES sala_cirurgica (id) ON DELETE RESTRICT;
ALTER TABLE prazo_requisicao_material
  ADD CONSTRAINT fk_prazo_requisicao_material_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_requisicao_material_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prazo_requisicao_material_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT;
ALTER TABLE principio_ativo
  ADD CONSTRAINT fk_principio_ativo_classe_terapeutica_id FOREIGN KEY (classe_terapeutica_id) REFERENCES classe_terapeutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_principio_ativo_unidade_medida_padrao_id FOREIGN KEY (unidade_medida_padrao_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_principio_ativo_lista_controle_especial_id FOREIGN KEY (lista_controle_especial_id) REFERENCES lista_controle_especial (id) ON DELETE RESTRICT;
ALTER TABLE processo_licitatorio
  ADD CONSTRAINT fk_processo_licitatorio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_agente_contratacao_usuario_id FOREIGN KEY (agente_contratacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_origem_recurso_compra_id FOREIGN KEY (origem_recurso_compra_id) REFERENCES origem_recurso_compra (id) ON DELETE RESTRICT;
ALTER TABLE processo_licitatorio_item
  ADD CONSTRAINT fk_processo_licitatorio_item_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_item_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_processo_licitatorio_item_vencedora_proposta_licitacao_item FOREIGN KEY (vencedora_proposta_licitacao_item_id) REFERENCES proposta_licitacao_item (id) ON DELETE RESTRICT;
ALTER TABLE programacao_suprimento
  ADD CONSTRAINT fk_programacao_suprimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_suprimento_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_suprimento_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_suprimento_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_suprimento_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_programacao_suprimento_aprovada_por_usuario_id FOREIGN KEY (aprovada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE programacao_suprimento_periodo
  ADD CONSTRAINT fk_programacao_suprimento_periodo_programacao_suprimento_id FOREIGN KEY (programacao_suprimento_id) REFERENCES programacao_suprimento (id) ON DELETE RESTRICT;
ALTER TABLE proposta_licitacao
  ADD CONSTRAINT fk_proposta_licitacao_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_licitacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_licitacao_condicao_pagamento_id FOREIGN KEY (condicao_pagamento_id) REFERENCES condicao_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_licitacao_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_licitacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE proposta_licitacao_item
  ADD CONSTRAINT fk_proposta_licitacao_item_proposta_licitacao_id FOREIGN KEY (proposta_licitacao_id) REFERENCES proposta_licitacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_licitacao_item_processo_licitatorio_item_id FOREIGN KEY (processo_licitatorio_item_id) REFERENCES processo_licitatorio_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_licitacao_item_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE questionario_homologacao
  ADD CONSTRAINT fk_questionario_homologacao_categoria_fornecimento_id FOREIGN KEY (categoria_fornecimento_id) REFERENCES categoria_fornecimento (id) ON DELETE RESTRICT;
ALTER TABLE questionario_homologacao_pergunta
  ADD CONSTRAINT fk_questionario_homologacao_pergunta_questionario_homologacao_id FOREIGN KEY (questionario_homologacao_id) REFERENCES questionario_homologacao (id) ON DELETE RESTRICT;
ALTER TABLE rastreio_implante
  ADD CONSTRAINT fk_rastreio_implante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_ato_cirurgico_id FOREIGN KEY (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_consumo_opme_id FOREIGN KEY (consumo_opme_id) REFERENCES consumo_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_registro_sanitario_id FOREIGN KEY (registro_sanitario_id) REFERENCES registro_sanitario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_cirurgiao_profissional_id FOREIGN KEY (cirurgiao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rastreio_implante_etiqueta_arquivo_id FOREIGN KEY (etiqueta_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE recalculo_saldo_estoque
  ADD CONSTRAINT fk_recalculo_saldo_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recalculo_saldo_estoque_saldo_estoque_id FOREIGN KEY (saldo_estoque_id) REFERENCES saldo_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recalculo_saldo_estoque_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recalculo_saldo_estoque_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recalculo_saldo_estoque_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE receita_controlada
  ADD CONSTRAINT fk_receita_controlada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_receita_medica_id FOREIGN KEY (receita_medica_id) REFERENCES receita_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_prescritor_solicitante_externo_id FOREIGN KEY (prescritor_solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_lista_controle_especial_id FOREIGN KEY (lista_controle_especial_id) REFERENCES lista_controle_especial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_retida_por_usuario_id FOREIGN KEY (retida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_receita_controlada_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE registro_importacao
  ADD CONSTRAINT fk_registro_importacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_tipo_compra_importacao_id FOREIGN KEY (tipo_compra_importacao_id) REFERENCES tipo_compra_importacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_cfop_id FOREIGN KEY (cfop_id) REFERENCES cfop (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_moeda_id FOREIGN KEY (moeda_id) REFERENCES moeda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_desembaraco_unidade_federativa_id FOREIGN KEY (desembaraco_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_transportadora_empresa_fornecedora_id FOREIGN KEY (transportadora_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE registro_importacao_item
  ADD CONSTRAINT fk_registro_importacao_item_registro_importacao_id FOREIGN KEY (registro_importacao_id) REFERENCES registro_importacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_importacao_item_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT;
ALTER TABLE registro_sanitario
  ADD CONSTRAINT fk_registro_sanitario_apresentacao_comercial_id FOREIGN KEY (apresentacao_comercial_id) REFERENCES apresentacao_comercial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_registro_sanitario_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT;
ALTER TABLE regra_contabil_estoque
  ADD CONSTRAINT fk_regra_contabil_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_tipo_movimento_estoque_id FOREIGN KEY (tipo_movimento_estoque_id) REFERENCES tipo_movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_categoria_contabil_insumo_id FOREIGN KEY (categoria_contabil_insumo_id) REFERENCES categoria_contabil_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_contraparte_estabelecimento_id FOREIGN KEY (contraparte_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_debito_conta_contabil_id FOREIGN KEY (debito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_credito_conta_contabil_id FOREIGN KEY (credito_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contabil_estoque_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT;
