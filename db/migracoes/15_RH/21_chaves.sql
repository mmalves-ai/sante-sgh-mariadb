-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE integracao_folha_financeiro ADD CONSTRAINT fk_integracao_folha_financeiro_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE integracao_folha_financeiro_destino ADD CONSTRAINT fk_integracao_folha_financeiro_destino_integracao FOREIGN KEY IF NOT EXISTS (integracao_folha_financeiro_id) REFERENCES integracao_folha_financeiro (id) ON DELETE RESTRICT;
ALTER TABLE integracao_folha_financeiro_destino ADD CONSTRAINT fk_integracao_folha_financeiro_destino_empresa_fornecedora_id FOREIGN KEY IF NOT EXISTS (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE integracao_folha_financeiro_destino ADD CONSTRAINT fk_integracao_folha_financeiro_destino_natureza_financeira_id FOREIGN KEY IF NOT EXISTS (natureza_financeira_id) REFERENCES natureza_financeira (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_titulos_folha ADD CONSTRAINT fk_lancamento_titulos_folha_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_titulos_folha ADD CONSTRAINT fk_lancamento_titulos_folha_competencia_folha_id FOREIGN KEY IF NOT EXISTS (competencia_folha_id) REFERENCES competencia_folha (id) ON DELETE RESTRICT;
ALTER TABLE lancamento_titulos_folha ADD CONSTRAINT fk_lancamento_titulos_folha_lancado_por_usuario_id FOREIGN KEY IF NOT EXISTS (lancado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE titulo_folha ADD CONSTRAINT fk_titulo_folha_lancamento_titulos_folha_id FOREIGN KEY IF NOT EXISTS (lancamento_titulos_folha_id) REFERENCES lancamento_titulos_folha (id) ON DELETE RESTRICT;
ALTER TABLE titulo_folha ADD CONSTRAINT fk_titulo_folha_empresa_fornecedora_id FOREIGN KEY IF NOT EXISTS (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
-- O credor passa a ser a empresa fornecedora (o mesmo do título a pagar); a coluna antiga sai depois das chaves.
ALTER TABLE titulo_folha DROP FOREIGN KEY IF EXISTS fk_titulo_folha_credor_pessoa_juridica_id;
ALTER TABLE titulo_folha DROP COLUMN IF EXISTS credor_pessoa_juridica_id;
