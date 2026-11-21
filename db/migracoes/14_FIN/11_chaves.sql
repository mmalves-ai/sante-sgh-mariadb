-- FIN, lote 11: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE coleta_estatistica_custo
  ADD CONSTRAINT fk_coleta_estatistica_custo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE estatistica_centro_mes
  ADD CONSTRAINT fk_estatistica_centro_mes_coleta_estatistica_custo_id FOREIGN KEY (coleta_estatistica_custo_id) REFERENCES coleta_estatistica_custo (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_fiscal_gerado
  ADD CONSTRAINT fk_arquivo_fiscal_gerado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_fiscal_gerado_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_fiscal_gerado_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE glosa_titulo_receber
  ADD CONSTRAINT fk_glosa_titulo_receber_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_glosa_titulo_receber_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
ALTER TABLE fluxo_aprovacao
  ADD CONSTRAINT fk_fluxo_aprovacao_tipo_credor_id FOREIGN KEY (tipo_credor_id) REFERENCES tipo_credor (id) ON DELETE RESTRICT;
ALTER TABLE movimento_caixa
  ADD CONSTRAINT fk_movimento_caixa_orcamento_particular_id FOREIGN KEY (orcamento_particular_id) REFERENCES orcamento_particular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_movimento_caixa_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE cota_depreciacao
  ADD CONSTRAINT fk_cota_depreciacao_calculo_depreciacao_id FOREIGN KEY (calculo_depreciacao_id) REFERENCES calculo_depreciacao (id) ON DELETE RESTRICT;
ALTER TABLE movimento_bem
  ADD CONSTRAINT fk_movimento_bem_referencia_movimento_bem_id FOREIGN KEY (referencia_movimento_bem_id) REFERENCES movimento_bem (id) ON DELETE RESTRICT;
ALTER TABLE inventario_bem_item
  ADD CONSTRAINT fk_inventario_bem_item_encontrado_centro_custo_id FOREIGN KEY (encontrado_centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
