-- 16_SGO lote 05: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)

ALTER TABLE limite_utilizacao_periodo
  ADD CONSTRAINT fk_limite_utilizacao_periodo_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_limite_utilizacao_periodo_nivel_acumulo_limite_id FOREIGN KEY (nivel_acumulo_limite_id) REFERENCES nivel_acumulo_limite (id) ON DELETE RESTRICT;
ALTER TABLE livro_auxiliar_operadora
  ADD CONSTRAINT fk_livro_auxiliar_operadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_gerado_por_usuario_id FOREIGN KEY (gerado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE livro_auxiliar_operadora_item
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_livro_auxiliar_operadora_id FOREIGN KEY (livro_auxiliar_operadora_id) REFERENCES livro_auxiliar_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_contrapartida_conta_contabil_id FOREIGN KEY (contrapartida_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_titular_beneficiario_plano_id FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_livro_auxiliar_operadora_item_segmentacao_assistencial_id FOREIGN KEY (segmentacao_assistencial_id) REFERENCES segmentacao_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE local_atendimento_rede
  ADD CONSTRAINT fk_local_atendimento_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_rede_tipo_endereco_id FOREIGN KEY (tipo_endereco_id) REFERENCES tipo_endereco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_rede_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_atendimento_rede_modelo_horario_atendimento_id FOREIGN KEY (modelo_horario_atendimento_id) REFERENCES modelo_horario_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE lote_atendimento_reciproco
  ADD CONSTRAINT fk_lote_atendimento_reciproco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_atendimento_reciproco_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_atendimento_reciproco_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_atendimento_reciproco_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_atendimento_reciproco_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE lote_cancelamento_fatura
  ADD CONSTRAINT fk_lote_cancelamento_fatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_cancelamento_fatura_motivo_ajuste_fatura_id FOREIGN KEY (motivo_ajuste_fatura_id) REFERENCES motivo_ajuste_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_cancelamento_fatura_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_cancelamento_fatura_item
  ADD CONSTRAINT fk_lote_cancelamento_fatura_item_lote_cancelamento_fatura_id FOREIGN KEY (lote_cancelamento_fatura_id) REFERENCES lote_cancelamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_cancelamento_fatura_item_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT;
ALTER TABLE lote_conta_recebida
  ADD CONSTRAINT fk_lote_conta_recebida_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_conta_recebida_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_conta_recebida_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_conta_recebida_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_conta_recebida_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_emissao_cartao
  ADD CONSTRAINT fk_lote_emissao_cartao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_emissao_cartao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_emissao_cartao_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_emissao_cartao_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_emissao_cartao_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_emissao_cartao_motivo_solicitacao_cartao_id FOREIGN KEY (motivo_solicitacao_cartao_id) REFERENCES motivo_solicitacao_cartao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_emissao_cartao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_emissao_cartao_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_faturamento_plano
  ADD CONSTRAINT fk_lote_faturamento_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_carteira_contrato_plano_id FOREIGN KEY (carteira_contrato_plano_id) REFERENCES carteira_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_forma_cobranca_plano_id FOREIGN KEY (forma_cobranca_plano_id) REFERENCES forma_cobranca_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_reprocessa_lote_faturamento_plano_id FOREIGN KEY (reprocessa_lote_faturamento_plano_id) REFERENCES lote_faturamento_plano (id) ON DELETE RESTRICT;
ALTER TABLE lote_faturamento_plano_critica
  ADD CONSTRAINT fk_lote_faturamento_plano_critica_lote_faturamento_plano_id FOREIGN KEY (lote_faturamento_plano_id) REFERENCES lote_faturamento_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_critica_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_critica_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_critica_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_critica_resolvida_por_usuario_id FOREIGN KEY (resolvida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_faturamento_plano_escopo
  ADD CONSTRAINT fk_lote_faturamento_plano_escopo_lote_faturamento_plano_id FOREIGN KEY (lote_faturamento_plano_id) REFERENCES lote_faturamento_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_escopo_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_escopo_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_escopo_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_escopo_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_escopo_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_faturamento_plano_escopo_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE lote_pagamento_rede
  ADD CONSTRAINT fk_lote_pagamento_rede_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_pagamento_rede_item
  ADD CONSTRAINT fk_lote_pagamento_rede_item_lote_pagamento_rede_id FOREIGN KEY (lote_pagamento_rede_id) REFERENCES lote_pagamento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_item_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_item_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_item_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_item_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_item_nota_fiscal_prestador_rede_id FOREIGN KEY (nota_fiscal_prestador_rede_id) REFERENCES nota_fiscal_prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE lote_pagamento_rede_tributo
  ADD CONSTRAINT fk_lote_pagamento_rede_tributo_lote_pagamento_rede_id FOREIGN KEY (lote_pagamento_rede_id) REFERENCES lote_pagamento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_tributo_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_tributo_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_tributo_retencao_titulo_id FOREIGN KEY (retencao_titulo_id) REFERENCES retencao_titulo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_tributo_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_tributo_tipo_documento_financeiro_id FOREIGN KEY (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_pagamento_rede_tributo_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE lote_reciprocidade_item
  ADD CONSTRAINT fk_lote_reciprocidade_item_lote_atendimento_reciproco_id FOREIGN KEY (lote_atendimento_reciproco_id) REFERENCES lote_atendimento_reciproco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reciprocidade_item_reciprocidade_beneficiario_id FOREIGN KEY (reciprocidade_beneficiario_id) REFERENCES reciprocidade_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_reciprocidade_item_reciprocidade_movimento_id FOREIGN KEY (reciprocidade_movimento_id) REFERENCES reciprocidade_movimento (id) ON DELETE RESTRICT;
ALTER TABLE manutencao_plano_ex_empregado
  ADD CONSTRAINT fk_manutencao_plano_ex_empregado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manutencao_plano_ex_empregado_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manutencao_plano_ex_empregado_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_manutencao_plano_ex_empregado_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT;
ALTER TABLE mapa_conta_balancete_ans
  ADD CONSTRAINT fk_mapa_conta_balancete_ans_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_conta_balancete_ans_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_conta_balancete_ans_plano_contas_padrao_ans_id FOREIGN KEY (plano_contas_padrao_ans_id) REFERENCES plano_contas_padrao_ans (id) ON DELETE RESTRICT;
ALTER TABLE marcador_prestador_rede
  ADD CONSTRAINT fk_marcador_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marcador_prestador_rede_marcador_rede_id FOREIGN KEY (marcador_rede_id) REFERENCES marcador_rede (id) ON DELETE RESTRICT;
ALTER TABLE material_divulgacao
  ADD CONSTRAINT fk_material_divulgacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_divulgacao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE material_divulgacao_estoque
  ADD CONSTRAINT fk_material_divulgacao_estoque_material_divulgacao_id FOREIGN KEY (material_divulgacao_id) REFERENCES material_divulgacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_divulgacao_estoque_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_material_divulgacao_estoque_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_cartao_beneficiario
  ADD CONSTRAINT fk_mensagem_cartao_beneficiario_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_cartao_beneficiario_servico_adicional_plano_id FOREIGN KEY (servico_adicional_plano_id) REFERENCES servico_adicional_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_cartao_beneficiario_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_cobranca
  ADD CONSTRAINT fk_mensagem_cobranca_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_cobranca_conta_bancaria_id FOREIGN KEY (conta_bancaria_id) REFERENCES conta_bancaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_cobranca_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE mensagem_pedido_autorizacao
  ADD CONSTRAINT fk_mensagem_pedido_autorizacao_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_pedido_autorizacao_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_pedido_autorizacao_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensagem_pedido_autorizacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE mensalidade_beneficiario
  ADD CONSTRAINT fk_mensalidade_beneficiario_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_faixa_etaria_modelo_item_id FOREIGN KEY (faixa_etaria_modelo_item_id) REFERENCES faixa_etaria_modelo_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_receita_conta_contabil_id FOREIGN KEY (receita_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_ativo_conta_contabil_id FOREIGN KEY (ativo_conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mensalidade_beneficiario_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE meta_venda
  ADD CONSTRAINT fk_meta_venda_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_venda_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_venda_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_venda_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT;
ALTER TABLE meta_venda_item
  ADD CONSTRAINT fk_meta_venda_item_meta_venda_id FOREIGN KEY (meta_venda_id) REFERENCES meta_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_venda_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT;
ALTER TABLE migracao_plano_lote
  ADD CONSTRAINT fk_migracao_plano_lote_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_anterior_contrato_plano_id FOREIGN KEY (anterior_contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_anterior_produto_plano_id FOREIGN KEY (anterior_produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_destino_contrato_plano_id FOREIGN KEY (destino_contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_destino_produto_plano_id FOREIGN KEY (destino_produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE migracao_plano_lote_item
  ADD CONSTRAINT fk_migracao_plano_lote_item_migracao_plano_lote_id FOREIGN KEY (migracao_plano_lote_id) REFERENCES migracao_plano_lote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_item_titular_beneficiario_plano_id FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_migracao_plano_lote_item_novo_beneficiario_plano_id FOREIGN KEY (novo_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT;
ALTER TABLE modalidade_reembolso
  ADD CONSTRAINT fk_modalidade_reembolso_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT;
ALTER TABLE modelo_comunicacao_beneficiario
  ADD CONSTRAINT fk_modelo_comunicacao_beneficiario_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_comunicacao_beneficiario_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_comunicacao_beneficiario_motivo_decisao_autorizacao_id FOREIGN KEY (motivo_decisao_autorizacao_id) REFERENCES motivo_decisao_autorizacao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_contrato_plano
  ADD CONSTRAINT fk_modelo_contrato_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_carteira_contrato_plano_id FOREIGN KEY (carteira_contrato_plano_id) REFERENCES carteira_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_forma_cobranca_plano_id FOREIGN KEY (forma_cobranca_plano_id) REFERENCES forma_cobranca_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_modelo_desconto_folha_id FOREIGN KEY (modelo_desconto_folha_id) REFERENCES modelo_desconto_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_suspenso_por_usuario_id FOREIGN KEY (suspenso_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_contrato_plano_item
  ADD CONSTRAINT fk_modelo_contrato_plano_item_modelo_contrato_plano_id FOREIGN KEY (modelo_contrato_plano_id) REFERENCES modelo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_tabela_preco_plano_id FOREIGN KEY (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_aposentado_tabela_preco_plano_id FOREIGN KEY (aposentado_tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_aposentado_faixa_etaria_modelo_id FOREIGN KEY (aposentado_faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_regra_franquia_plano_id FOREIGN KEY (regra_franquia_plano_id) REFERENCES regra_franquia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_grupo_prazo_carencia_id FOREIGN KEY (grupo_prazo_carencia_id) REFERENCES grupo_prazo_carencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_item_indice_reajuste_plano_id FOREIGN KEY (indice_reajuste_plano_id) REFERENCES indice_reajuste_plano (id) ON DELETE RESTRICT;
ALTER TABLE modelo_contrato_plano_lancamento
  ADD CONSTRAINT fk_modelo_contrato_plano_lancamento_modelo_contrato_plano_id FOREIGN KEY (modelo_contrato_plano_id) REFERENCES modelo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_lancamento_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_lancamento_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_lancamento_grau_parentesco_dep_f6efc616 FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_lancamento_classe_beneficiario_plano_id FOREIGN KEY (classe_beneficiario_plano_id) REFERENCES classe_beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_contrato_plano_lancamento_favorecido_pessoa_j_599bd4df FOREIGN KEY (favorecido_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE modelo_criterio_item
  ADD CONSTRAINT fk_modelo_criterio_item_conjunto_criterio_aplicacao_id FOREIGN KEY (conjunto_criterio_aplicacao_id) REFERENCES conjunto_criterio_aplicacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_tipo_contrato_plano_id FOREIGN KEY (tipo_contrato_plano_id) REFERENCES tipo_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_grupo_procedimento_operadora_id FOREIGN KEY (grupo_procedimento_operadora_id) REFERENCES grupo_procedimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_carteira_contrato_plano_id FOREIGN KEY (carteira_contrato_plano_id) REFERENCES carteira_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_criterio_item_titular_beneficiario_plano_id FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT;
ALTER TABLE modelo_desconto_folha
  ADD CONSTRAINT fk_modelo_desconto_folha_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_desconto_folha_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT;
ALTER TABLE modelo_desconto_folha_lancamento
  ADD CONSTRAINT fk_modelo_desconto_folha_lancamento_modelo_desconto_folha_id FOREIGN KEY (modelo_desconto_folha_id) REFERENCES modelo_desconto_folha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_desconto_folha_lancamento_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pedido_autorizacao
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_solicitante_prestador_rede_id FOREIGN KEY (solicitante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_executante_prestador_rede_id FOREIGN KEY (executante_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_tipo_guia_plano_id FOREIGN KEY (tipo_guia_plano_id) REFERENCES tipo_guia_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_tipo_atendimento_termo_ter_8ae33fad FOREIGN KEY (tipo_atendimento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_tipo_consulta_termo_terminologia_id FOREIGN KEY (tipo_consulta_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_tipo_internacao_termo_term_1d4d7857 FOREIGN KEY (tipo_internacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_regime_internacao_termo_te_dd47221e FOREIGN KEY (regime_internacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_indicador_acidente_termo_t_0bdd584a FOREIGN KEY (indicador_acidente_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_cid_principal_termo_terminologia_id FOREIGN KEY (cid_principal_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_cid_secundario_termo_termi_9ea05b50 FOREIGN KEY (cid_secundario_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_estadiamento_termo_terminologia_id FOREIGN KEY (estadiamento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_ecog_termo_terminologia_id FOREIGN KEY (ecog_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_finalidade_tratamento_term_9e824cb4 FOREIGN KEY (finalidade_tratamento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pedido_autorizacao_item
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_item_modelo_pedido_autorizacao_id FOREIGN KEY (modelo_pedido_autorizacao_id) REFERENCES modelo_pedido_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_item_via_administracao_ter_c69f767b FOREIGN KEY (via_administracao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_autorizacao_item_regiao_dente_termo_te_5164eb40 FOREIGN KEY (regiao_dente_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE modelo_protocolo_atendimento
  ADD CONSTRAINT fk_modelo_protocolo_atendimento_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_protocolo_atendimento_servico_atendimento_operadora_id FOREIGN KEY (servico_atendimento_operadora_id) REFERENCES servico_atendimento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_protocolo_atendimento_motivo_contato_beneficiario_id FOREIGN KEY (motivo_contato_beneficiario_id) REFERENCES motivo_contato_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_protocolo_atendimento_gravidade_protocolo_ben_993b5abe FOREIGN KEY (gravidade_protocolo_beneficiario_id) REFERENCES gravidade_protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_protocolo_atendimento_origem_protocolo_id FOREIGN KEY (origem_protocolo_id) REFERENCES origem_protocolo (id) ON DELETE RESTRICT;
ALTER TABLE modelo_questionario_saude_pergunta
  ADD CONSTRAINT fk_modelo_questionario_saude_pergunta_modelo_questionar_b9efcd7d FOREIGN KEY (modelo_questionario_saude_id) REFERENCES modelo_questionario_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_questionario_saude_pergunta_grupo_patologia_id FOREIGN KEY (grupo_patologia_id) REFERENCES grupo_patologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_questionario_saude_pergunta_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
