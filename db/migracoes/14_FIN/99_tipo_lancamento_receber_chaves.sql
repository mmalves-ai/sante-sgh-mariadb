-- Financeiro, chaves do tipo de documento por perfil no título a receber (F3.8, 07-FIN linha 99, C1-044): só para
-- frente e idempotente. A chave única nova entra antes de a anterior sair (a anterior apoia a chave estrangeira do perfil).
ALTER TABLE permissao_tipo_lancamento ADD UNIQUE KEY IF NOT EXISTS uq_permissao_tipo_lancamento_alvo (perfil_acesso_id, estabelecimento_id, operacao, tipo_credor_id, tipo_lancamento_bancario_id, tipo_documento_financeiro_id);
ALTER TABLE permissao_tipo_lancamento DROP INDEX IF EXISTS uq_permissao_tipo_lancamento;
ALTER TABLE permissao_tipo_lancamento ADD INDEX IF NOT EXISTS ix_permissao_tipo_lancamento_tipo_documento_financeiro_id (tipo_documento_financeiro_id);
ALTER TABLE permissao_tipo_lancamento ADD CONSTRAINT fk_permissao_tipo_lancamento_tipo_documento_financeiro_id FOREIGN KEY IF NOT EXISTS (tipo_documento_financeiro_id) REFERENCES tipo_documento_financeiro (id) ON DELETE RESTRICT;
