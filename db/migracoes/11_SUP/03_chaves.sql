-- SUP, lote 03: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE insumo_palavra_chave
  ADD CONSTRAINT fk_insumo_palavra_chave_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE insumo_principio_ativo
  ADD CONSTRAINT fk_insumo_principio_ativo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_principio_ativo_principio_ativo_id FOREIGN KEY (principio_ativo_id) REFERENCES principio_ativo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_principio_ativo_concentracao_unidade_medida_id FOREIGN KEY (concentracao_unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE insumo_referencia_preco
  ADD CONSTRAINT fk_insumo_referencia_preco_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_referencia_preco_item_referencia_matmed_id FOREIGN KEY (item_referencia_matmed_id) REFERENCES item_referencia_matmed (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_referencia_preco_edicao_referencia_matmed_id FOREIGN KEY (edicao_referencia_matmed_id) REFERENCES edicao_referencia_matmed (id) ON DELETE RESTRICT;
ALTER TABLE insumo_unidade
  ADD CONSTRAINT fk_insumo_unidade_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_unidade_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_unidade_unidade_prescricao_id FOREIGN KEY (unidade_prescricao_id) REFERENCES unidade_prescricao (id) ON DELETE RESTRICT;
ALTER TABLE insumo_via
  ADD CONSTRAINT fk_insumo_via_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_insumo_via_via_de_uso_id FOREIGN KEY (via_de_uso_id) REFERENCES via_de_uso (id) ON DELETE RESTRICT;
ALTER TABLE inventario_estoque
  ADD CONSTRAINT fk_inventario_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_motivo_inventario_estoque_id FOREIGN KEY (motivo_inventario_estoque_id) REFERENCES motivo_inventario_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_abertura_usuario_id FOREIGN KEY (abertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_aprovacao_usuario_id FOREIGN KEY (aprovacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE inventario_estoque_contagem
  ADD CONSTRAINT fk_inventario_estoque_contagem_inventario_estoque_id FOREIGN KEY (inventario_estoque_id) REFERENCES inventario_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_contagem_contador_usuario_id FOREIGN KEY (contador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_contagem_aprovacao_usuario_id FOREIGN KEY (aprovacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inventario_estoque_item
  ADD CONSTRAINT fk_inventario_estoque_item_inventario_estoque_id FOREIGN KEY (inventario_estoque_id) REFERENCES inventario_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_item_inventario_estoque_contagem_id FOREIGN KEY (inventario_estoque_contagem_id) REFERENCES inventario_estoque_contagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_item_endereco_armazem_id FOREIGN KEY (endereco_armazem_id) REFERENCES endereco_armazem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_item_contagem_usuario_id FOREIGN KEY (contagem_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inventario_estoque_lote
  ADD CONSTRAINT fk_inventario_estoque_lote_inventario_estoque_item_id FOREIGN KEY (inventario_estoque_item_id) REFERENCES inventario_estoque_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_lote_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE inventario_estoque_divergencia
  ADD CONSTRAINT fk_inventario_estoque_divergencia_inventario_estoque_id FOREIGN KEY (inventario_estoque_id) REFERENCES inventario_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_divergencia_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_divergencia_inventario_estoque_item_id FOREIGN KEY (inventario_estoque_item_id) REFERENCES inventario_estoque_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_divergencia_motivo_ajuste_estoque_id FOREIGN KEY (motivo_ajuste_estoque_id) REFERENCES motivo_ajuste_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_divergencia_autorizacao_usuario_id FOREIGN KEY (autorizacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_divergencia_processamento_usuario_id FOREIGN KEY (processamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventario_estoque_divergencia_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE kit_material
  ADD CONSTRAINT fk_kit_material_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE kit_material_item
  ADD CONSTRAINT fk_kit_material_item_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_material_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_material_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE kit_material_procedimento
  ADD CONSTRAINT fk_kit_material_procedimento_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_material_procedimento_procedimento_cirurgico_id FOREIGN KEY (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_material_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE kit_rastreavel
  ADD CONSTRAINT fk_kit_rastreavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_rastreavel_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_rastreavel_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_rastreavel_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_rastreavel_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE kit_rastreavel_item
  ADD CONSTRAINT fk_kit_rastreavel_item_kit_rastreavel_id FOREIGN KEY (kit_rastreavel_id) REFERENCES kit_rastreavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_rastreavel_item_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_rastreavel_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE kit_rastreavel_lote
  ADD CONSTRAINT fk_kit_rastreavel_lote_kit_rastreavel_item_id FOREIGN KEY (kit_rastreavel_item_id) REFERENCES kit_rastreavel_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_kit_rastreavel_lote_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_controlado
  ADD CONSTRAINT fk_lancamento_controlado_livro_controlado_id FOREIGN KEY (livro_controlado_id) REFERENCES livro_controlado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_receita_controlada_id FOREIGN KEY (receita_controlada_id) REFERENCES receita_controlada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_prescritor_profissional_id FOREIGN KEY (prescritor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_controlado_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE livro_controlado
  ADD CONSTRAINT fk_livro_controlado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_controlado_lista_controle_especial_id FOREIGN KEY (lista_controle_especial_id) REFERENCES lista_controle_especial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_controlado_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_controlado_responsavel_tecnico_profissional_id FOREIGN KEY (responsavel_tecnico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE lance_licitacao
  ADD CONSTRAINT fk_lance_licitacao_processo_licitatorio_item_id FOREIGN KEY (processo_licitatorio_item_id) REFERENCES processo_licitatorio_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lance_licitacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lance_licitacao_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lance_licitacao_proposta_licitacao_id FOREIGN KEY (proposta_licitacao_id) REFERENCES proposta_licitacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lance_licitacao_motivo_compra_publica_id FOREIGN KEY (motivo_compra_publica_id) REFERENCES motivo_compra_publica (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_antimicrobiano
  ADD CONSTRAINT fk_liberacao_antimicrobiano_ficha_antimicrobiano_id FOREIGN KEY (ficha_antimicrobiano_id) REFERENCES ficha_antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_antimicrobiano_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_antimicrobiano_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_antimicrobiano_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_antimicrobiano_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_antimicrobiano_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_antimicrobiano_anterior_liberacao_antimicrobiano_id FOREIGN KEY (anterior_liberacao_antimicrobiano_id) REFERENCES liberacao_antimicrobiano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_antimicrobiano_liberador_profissional_id FOREIGN KEY (liberador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_farmaceutica_item
  ADD CONSTRAINT fk_liberacao_farmaceutica_item_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_farmaceutica_item_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_farmaceutica_item_horario_administracao_id FOREIGN KEY (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_farmaceutica_item_avaliacao_farmaceutica_id FOREIGN KEY (avaliacao_farmaceutica_id) REFERENCES avaliacao_farmaceutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_farmaceutica_item_situacao_farmaceutica_id FOREIGN KEY (situacao_farmaceutica_id) REFERENCES situacao_farmaceutica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_farmaceutica_item_farmaceutico_profissional_id FOREIGN KEY (farmaceutico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE locacao_material
  ADD CONSTRAINT fk_locacao_material_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_locacao_material_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_locacao_material_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_locacao_material_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_locacao_material_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_locacao_material_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_locacao_material_requisicao_material_id FOREIGN KEY (requisicao_material_id) REFERENCES requisicao_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_locacao_material_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE local_estoque
  ADD CONSTRAINT fk_local_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_origem_local_estoque_id FOREIGN KEY (origem_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_devolucao_local_estoque_id FOREIGN KEY (devolucao_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_motivo_baixa_estoque_id FOREIGN KEY (motivo_baixa_estoque_id) REFERENCES motivo_baixa_estoque (id) ON DELETE RESTRICT;
ALTER TABLE local_estoque_classificacao
  ADD CONSTRAINT fk_local_estoque_classificacao_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_classificacao_grupo_insumo_id FOREIGN KEY (grupo_insumo_id) REFERENCES grupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_classificacao_subgrupo_insumo_id FOREIGN KEY (subgrupo_insumo_id) REFERENCES subgrupo_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_classificacao_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE local_estoque_setor
  ADD CONSTRAINT fk_local_estoque_setor_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE local_estoque_transferencia
  ADD CONSTRAINT fk_local_estoque_transferencia_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_transferencia_destino_local_estoque_id FOREIGN KEY (destino_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT;
ALTER TABLE local_estoque_usuario
  ADD CONSTRAINT fk_local_estoque_usuario_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_estoque_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_insumo
  ADD CONSTRAINT fk_lote_insumo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_insumo_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_insumo_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_insumo_registro_sanitario_id FOREIGN KEY (registro_sanitario_id) REFERENCES registro_sanitario (id) ON DELETE RESTRICT;
ALTER TABLE lote_produzido
  ADD CONSTRAINT fk_lote_produzido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_ordem_manipulacao_id FOREIGN KEY (ordem_manipulacao_id) REFERENCES ordem_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_formula_padrao_manipulacao_id FOREIGN KEY (formula_padrao_manipulacao_id) REFERENCES formula_padrao_manipulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_kit_material_id FOREIGN KEY (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE lote_produzido_custo
  ADD CONSTRAINT fk_lote_produzido_custo_lote_produzido_id FOREIGN KEY (lote_produzido_id) REFERENCES lote_produzido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_produzido_custo_custo_indireto_producao_id FOREIGN KEY (custo_indireto_producao_id) REFERENCES custo_indireto_producao (id) ON DELETE RESTRICT;
ALTER TABLE movimento_estoque
  ADD CONSTRAINT fk_movimento_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_local_estoque_id FOREIGN KEY (local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_tipo_movimento_estoque_id FOREIGN KEY (tipo_movimento_estoque_id) REFERENCES tipo_movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_documento_estoque_item_id FOREIGN KEY (documento_estoque_item_id) REFERENCES documento_estoque_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_nota_entrada_item_id FOREIGN KEY (nota_entrada_item_id) REFERENCES nota_entrada_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_dispensacao_item_id FOREIGN KEY (dispensacao_item_id) REFERENCES dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_devolucao_dispensacao_item_id FOREIGN KEY (devolucao_dispensacao_item_id) REFERENCES devolucao_dispensacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_devolucao_fornecedor_item_id FOREIGN KEY (devolucao_fornecedor_item_id) REFERENCES devolucao_fornecedor_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_requisicao_material_item_id FOREIGN KEY (requisicao_material_item_id) REFERENCES requisicao_material_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_contrapartida_local_estoque_id FOREIGN KEY (contrapartida_local_estoque_id) REFERENCES local_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_motivo_baixa_estoque_id FOREIGN KEY (motivo_baixa_estoque_id) REFERENCES motivo_baixa_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_motivo_ajuste_estoque_id FOREIGN KEY (motivo_ajuste_estoque_id) REFERENCES motivo_ajuste_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_motivo_devolucao_estoque_id FOREIGN KEY (motivo_devolucao_estoque_id) REFERENCES motivo_devolucao_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_kit_rastreavel_id FOREIGN KEY (kit_rastreavel_id) REFERENCES kit_rastreavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_estoque_estorno_movimento_estoque_id FOREIGN KEY (estorno_movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT;
ALTER TABLE movimento_kit_rastreavel
  ADD CONSTRAINT fk_movimento_kit_rastreavel_kit_rastreavel_id FOREIGN KEY (kit_rastreavel_id) REFERENCES kit_rastreavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_kit_rastreavel_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_kit_rastreavel_kit_rastreavel_item_id FOREIGN KEY (kit_rastreavel_item_id) REFERENCES kit_rastreavel_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_kit_rastreavel_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_kit_rastreavel_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_kit_rastreavel_documento_estoque_id FOREIGN KEY (documento_estoque_id) REFERENCES documento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_kit_rastreavel_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_kit_rastreavel_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE movimento_lote
  ADD CONSTRAINT fk_movimento_lote_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_lote_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT;
