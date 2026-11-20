-- Módulo SUP, lote 05 (F1.3): chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE regra_contagem_rotativa
  ADD CONSTRAINT fk_regra_contagem_rotativa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contagem_rotativa_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contagem_rotativa_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contagem_rotativa_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_contagem_rotativa_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE regra_envio_avaliacao_farmaceutica
  ADD CONSTRAINT fk_regra_envio_avaliacao_farmaceutica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_envio_avaliacao_farmaceutica_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_envio_avaliacao_farmaceutica_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE regra_fracionamento_insumo
  ADD CONSTRAINT fk_regra_fracionamento_insumo_origem_insumo_id FOREIGN KEY (origem_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fracionamento_insumo_resultante_insumo_id FOREIGN KEY (resultante_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fracionamento_insumo_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_fracionamento_insumo_condicao_armazenamento_id FOREIGN KEY (condicao_armazenamento_id) REFERENCES condicao_armazenamento (id) ON DELETE RESTRICT;
ALTER TABLE regra_integracao_prescricao
  ADD CONSTRAINT fk_regra_integracao_prescricao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_tipo_item_prescricao_id FOREIGN KEY (tipo_item_prescricao_id) REFERENCES tipo_item_prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_atendente_local_estoque_id FOREIGN KEY (atendente_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_substituto_local_estoque_id FOREIGN KEY (substituto_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_integracao_prescricao_regra_envio_avaliacao_farm_15d600 FOREIGN KEY (regra_envio_avaliacao_farmaceutica_id) REFERENCES regra_envio_avaliacao_farmaceutica (id) ON DELETE RESTRICT;
ALTER TABLE regra_liberacao_antimicrobiano
  ADD CONSTRAINT fk_regra_liberacao_antimicrobiano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_liberacao_antimicrobiano_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_liberacao_antimicrobiano_antimicrobiano_id FOREIGN KEY (antimicrobiano_id) REFERENCES antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE regra_parcelamento_entrega_compra
  ADD CONSTRAINT fk_regra_parcelamento_entrega_compra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_parcelamento_entrega_compra_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_parcelamento_entrega_compra_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_parcelamento_entrega_compra_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_parcelamento_entrega_compra_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE regra_requisicao_intercompanhia
  ADD CONSTRAINT fk_regra_requisicao_intercompanhia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_intercompanhia_origem_local_estoque_id FOREIGN KEY (origem_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_intercompanhia_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_intercompanhia_destino_local_estoque_id FOREIGN KEY (destino_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_intercompanhia_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_requisicao_intercompanhia_tipo_movimento_estoque_id FOREIGN KEY (tipo_movimento_estoque_id) REFERENCES tipo_movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE remessa_consignada
  ADD CONSTRAINT fk_remessa_consignada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_consignada_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_consignada_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_consignada_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_consignada_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE remessa_consignada_item
  ADD CONSTRAINT fk_remessa_consignada_item_remessa_consignada_id FOREIGN KEY (remessa_consignada_id) REFERENCES remessa_consignada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_consignada_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_consignada_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_consignada_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE reposicao_consignada
  ADD CONSTRAINT fk_reposicao_consignada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_remessa_consignada_item_id FOREIGN KEY (remessa_consignada_item_id) REFERENCES remessa_consignada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_consumo_opme_id FOREIGN KEY (consumo_opme_id) REFERENCES consumo_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_pedido_compra_id FOREIGN KEY (pedido_compra_id) REFERENCES pedido_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_consignada_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE reposicao_kit_rastreavel
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_kit_rastreavel_id FOREIGN KEY (kit_rastreavel_id) REFERENCES kit_rastreavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_dispensacao_id FOREIGN KEY (dispensacao_id) REFERENCES dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_devolucao_dispensacao_id FOREIGN KEY (devolucao_dispensacao_id) REFERENCES devolucao_dispensacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reposicao_kit_rastreavel_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE requisicao_material
  ADD CONSTRAINT fk_requisicao_material_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_atendente_local_estoque_id FOREIGN KEY (atendente_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_solicitante_local_estoque_id FOREIGN KEY (solicitante_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_prescricao_id FOREIGN KEY (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_cancelador_usuario_id FOREIGN KEY (cancelador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE requisicao_material_item
  ADD CONSTRAINT fk_requisicao_material_item_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_item_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_item_motivo_nao_atendimento_id FOREIGN KEY (motivo_nao_atendimento_id) REFERENCES motivo_nao_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_material_item_motivo_devolucao_estoque_id FOREIGN KEY (motivo_devolucao_estoque_id) REFERENCES motivo_devolucao_estoque (id) ON DELETE RESTRICT;
ALTER TABLE reserva_endereco
  ADD CONSTRAINT fk_reserva_endereco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_endereco_armazem_id FOREIGN KEY (endereco_armazem_id) REFERENCES endereco_armazem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_nota_entrada_id FOREIGN KEY (nota_entrada_id) REFERENCES nota_entrada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_ordem_separacao_id FOREIGN KEY (ordem_separacao_id) REFERENCES ordem_separacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_endereco_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reserva_estoque
  ADD CONSTRAINT fk_reserva_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_requisicao_material_item_id FOREIGN KEY (requisicao_material_item_id) REFERENCES requisicao_material_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_estoque_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE romaneio_entrega
  ADD CONSTRAINT fk_romaneio_entrega_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_veiculo_entrega_id FOREIGN KEY (veiculo_entrega_id) REFERENCES veiculo_entrega (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_motorista_id FOREIGN KEY (motorista_id) REFERENCES motorista (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_transportadora_empresa_fornecedora_id FOREIGN KEY (transportadora_empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_tipo_combustivel_id FOREIGN KEY (tipo_combustivel_id) REFERENCES tipo_combustivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_liberador_usuario_id FOREIGN KEY (liberador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_conferente_usuario_id FOREIGN KEY (conferente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE romaneio_entrega_item
  ADD CONSTRAINT fk_romaneio_entrega_item_romaneio_entrega_id FOREIGN KEY (romaneio_entrega_id) REFERENCES romaneio_entrega (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_item_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_item_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_item_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_item_destino_local_estoque_id FOREIGN KEY (destino_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_item_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_romaneio_entrega_item_recebedor_usuario_id FOREIGN KEY (recebedor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_consignado
  ADD CONSTRAINT fk_saldo_consignado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_consignado_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_consignado_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_consignado_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_consignado_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE saldo_estoque
  ADD CONSTRAINT fk_saldo_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_estoque_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_estoque_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE saldo_estoque_mensal
  ADD CONSTRAINT fk_saldo_estoque_mensal_saldo_estoque_id FOREIGN KEY (saldo_estoque_id) REFERENCES saldo_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_estoque_mensal_fechamento_estoque_id FOREIGN KEY (fechamento_estoque_id) REFERENCES fechamento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_estoque_mensal_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE saldo_lote
  ADD CONSTRAINT fk_saldo_lote_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_lote_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_lote_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_lote_endereco_armazem_id FOREIGN KEY (endereco_armazem_id) REFERENCES endereco_armazem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_saldo_lote_bloqueio_lote_id FOREIGN KEY (bloqueio_lote_id) REFERENCES bloqueio_lote (id) ON DELETE RESTRICT;
ALTER TABLE sequencia_documento_estoque
  ADD CONSTRAINT fk_sequencia_documento_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sequencia_documento_estoque_tipo_movimento_estoque_id FOREIGN KEY (tipo_movimento_estoque_id) REFERENCES tipo_movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE servico_contratavel
  ADD CONSTRAINT fk_servico_contratavel_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_contratavel_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_contratavel_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_contratavel_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_contratavel_natureza_operacao_id FOREIGN KEY (natureza_operacao_id) REFERENCES natureza_operacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_contratavel_servico_lc116_id FOREIGN KEY (servico_lc116_id) REFERENCES servico_lc116 (id) ON DELETE RESTRICT;
ALTER TABLE sobra_fracionamento
  ADD CONSTRAINT fk_sobra_fracionamento_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sobra_fracionamento_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sobra_fracionamento_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sobra_fracionamento_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_cadastro_insumo
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_comissao_hospitalar_id FOREIGN KEY (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_parecerista_usuario_id FOREIGN KEY (parecerista_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_cadastro_insumo_criado_insumo_id FOREIGN KEY (criado_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_compra
  ADD CONSTRAINT fk_solicitacao_compra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_motivo_solicitacao_compra_id FOREIGN KEY (motivo_solicitacao_compra_id) REFERENCES motivo_solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_comprador_usuario_id FOREIGN KEY (comprador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_conta_orcamentaria_id FOREIGN KEY (conta_orcamentaria_id) REFERENCES conta_orcamentaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_origem_recurso_compra_id FOREIGN KEY (origem_recurso_compra_id) REFERENCES origem_recurso_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_processo_licitatorio_id FOREIGN KEY (processo_licitatorio_id) REFERENCES processo_licitatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_sugestao_compra_id FOREIGN KEY (sugestao_compra_id) REFERENCES sugestao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_original_solicitacao_compra_id FOREIGN KEY (original_solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_cancelador_usuario_id FOREIGN KEY (cancelador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_compra_entrega
  ADD CONSTRAINT fk_solicitacao_compra_entrega_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_entrega_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_compra_fonte_recurso
  ADD CONSTRAINT fk_solicitacao_compra_fonte_recurso_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_fonte_recurso_origem_recurso_compra_id FOREIGN KEY (origem_recurso_compra_id) REFERENCES origem_recurso_compra (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_compra_item
  ADD CONSTRAINT fk_solicitacao_compra_item_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_servico_contratavel_id FOREIGN KEY (servico_contratavel_id) REFERENCES servico_contratavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_cotacao_item_id FOREIGN KEY (cotacao_item_id) REFERENCES cotacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_processo_licitatorio_item_id FOREIGN KEY (processo_licitatorio_item_id) REFERENCES processo_licitatorio_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_guia_tiss_opme_id FOREIGN KEY (guia_tiss_opme_id) REFERENCES guia_tiss_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_motivo_cancelamento_compra_id FOREIGN KEY (motivo_cancelamento_compra_id) REFERENCES motivo_cancelamento_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_item_cancelador_usuario_id FOREIGN KEY (cancelador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_compra_rateio
  ADD CONSTRAINT fk_solicitacao_compra_rateio_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_rateio_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_compra_rateio_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_opme
  ADD CONSTRAINT fk_solicitacao_opme_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_solicitacao_autorizacao_id FOREIGN KEY (solicitacao_autorizacao_id) REFERENCES solicitacao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_solicitacao_compra_id FOREIGN KEY (solicitacao_compra_id) REFERENCES solicitacao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_opme_item
  ADD CONSTRAINT fk_solicitacao_opme_item_solicitacao_opme_id FOREIGN KEY (solicitacao_opme_id) REFERENCES solicitacao_opme (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_item_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_item_fonte_referencia_matmed_id FOREIGN KEY (fonte_referencia_matmed_id) REFERENCES fonte_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_item_cotacao_item_id FOREIGN KEY (cotacao_item_id) REFERENCES cotacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_opme_item_guia_tiss_opme_id FOREIGN KEY (guia_tiss_opme_id) REFERENCES guia_tiss_opme (id) ON DELETE RESTRICT;
ALTER TABLE subgrupo_insumo
  ADD CONSTRAINT fk_subgrupo_insumo_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_subgrupo_insumo_categoria_contabil_insumo_id FOREIGN KEY (categoria_contabil_insumo_id) REFERENCES categoria_contabil_insumo (id) ON DELETE RESTRICT;
ALTER TABLE substituicao_dispensacao
  ADD CONSTRAINT fk_substituicao_dispensacao_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_anterior_insumo_id FOREIGN KEY (anterior_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_novo_insumo_id FOREIGN KEY (novo_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_apresentacao_comercial_id FOREIGN KEY (apresentacao_comercial_id) REFERENCES apresentacao_comercial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_substituicao_insumo_id FOREIGN KEY (substituicao_insumo_id) REFERENCES substituicao_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_farmaceutico_profissional_id FOREIGN KEY (farmaceutico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_dispensacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE substituicao_insumo
  ADD CONSTRAINT fk_substituicao_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_substituicao_insumo_substituto_insumo_id FOREIGN KEY (substituto_insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE sugestao_compra
  ADD CONSTRAINT fk_sugestao_compra_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_compra_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_compra_comprador_usuario_id FOREIGN KEY (comprador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE sugestao_compra_item
  ADD CONSTRAINT fk_sugestao_compra_item_sugestao_compra_id FOREIGN KEY (sugestao_compra_id) REFERENCES sugestao_compra (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_compra_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_compra_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sugestao_compra_item_solicitacao_compra_item_id FOREIGN KEY (solicitacao_compra_item_id) REFERENCES solicitacao_compra_item (id) ON DELETE RESTRICT;
ALTER TABLE taxa_manuseio_implante
  ADD CONSTRAINT fk_taxa_manuseio_implante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_manuseio_implante_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_manuseio_implante_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_manuseio_implante_cobranca_item_faturavel_id FOREIGN KEY (cobranca_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_taxa_manuseio_implante_limite_opme_procedimento_id FOREIGN KEY (limite_opme_procedimento_id) REFERENCES limite_opme_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE terceiro_destinatario
  ADD CONSTRAINT fk_terceiro_destinatario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terceiro_destinatario_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terceiro_destinatario_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE termo_livro_controlado
  ADD CONSTRAINT fk_termo_livro_controlado_livro_controlado_id FOREIGN KEY (livro_controlado_id) REFERENCES livro_controlado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_livro_controlado_lista_controle_especial_id FOREIGN KEY (lista_controle_especial_id) REFERENCES lista_controle_especial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_livro_controlado_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_livro_controlado_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_livro_controlado_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_livro_controlado_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_livro_controlado_documento_assinado_id FOREIGN KEY (documento_assinado_id) REFERENCES documento_assinado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_livro_controlado_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
