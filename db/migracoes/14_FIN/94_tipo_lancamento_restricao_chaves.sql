-- Financeiro, chaves da restrição de tipos de lançamento por perfil e estabelecimento (F3.8, 07-FIN linha 99): só para
-- frente e idempotente.
ALTER TABLE restricao_tipo_lancamento_perfil ADD CONSTRAINT fk_restricao_tipo_lancamento_perfil_perfil_acesso_id FOREIGN KEY IF NOT EXISTS (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE restricao_tipo_lancamento_perfil ADD CONSTRAINT fk_restricao_tipo_lancamento_perfil_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE permissao_tipo_lancamento ADD CONSTRAINT fk_permissao_tipo_lancamento_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE permissao_tipo_lancamento ADD INDEX IF NOT EXISTS ix_permissao_tipo_lancamento_estabelecimento (estabelecimento_id, perfil_acesso_id, operacao);
