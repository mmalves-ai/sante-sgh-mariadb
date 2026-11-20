-- Chaves do módulo SGO, lote 10 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE tipo_lancamento_fatura
  ADD CONSTRAINT fk_tipo_lancamento_fatura_pro_rata_tipo_lancamento_fatura_id FOREIGN KEY (pro_rata_tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_fatura_desconto_tipo_lancamento_fatura_id FOREIGN KEY (desconto_tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_fatura_retroativo_tipo_lancamento_fatura_id FOREIGN KEY (retroativo_tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_fatura_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_fatura_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE tipo_lancamento_fatura_vigencia
  ADD CONSTRAINT fk_tipo_lancamento_fatura_vigencia_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_lancamento_fatura_vigencia_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE tipo_observacao_operadora
  ADD CONSTRAINT fk_tipo_observacao_operadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE token_atendimento_beneficiario
  ADD CONSTRAINT fk_token_atendimento_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_token_atendimento_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_token_atendimento_beneficiario_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_token_atendimento_beneficiario_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT;
ALTER TABLE transferencia_capital_cooperado
  ADD CONSTRAINT fk_transferencia_capital_cooperado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_capital_cooperado_cedente_prestador_rede_id FOREIGN KEY (cedente_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_capital_cooperado_cessionario_prestador_rede_id FOREIGN KEY (cessionario_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_capital_cooperado_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_capital_cooperado_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE troca_tiss_operadora
  ADD CONSTRAINT fk_troca_tiss_operadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_operadora_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_operadora_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_operadora_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_tiss_operadora_resposta_troca_tiss_operadora_id FOREIGN KEY (resposta_troca_tiss_operadora_id) REFERENCES troca_tiss_operadora (id) ON DELETE RESTRICT;
ALTER TABLE vendedor_plano
  ADD CONSTRAINT fk_vendedor_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vendedor_plano_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vendedor_plano_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vendedor_plano_classe_vendedor_plano_id FOREIGN KEY (classe_vendedor_plano_id) REFERENCES classe_vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vendedor_plano_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vendedor_plano_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE verba_desconto_folha
  ADD CONSTRAINT fk_verba_desconto_folha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verba_desconto_folha_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_funcional_beneficiario
  ADD CONSTRAINT fk_vinculo_funcional_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_funcional_beneficiario_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT;
