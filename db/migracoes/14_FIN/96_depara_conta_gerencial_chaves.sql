-- Chaves do de-para da consolidação (F8, 07-FIN linha 127, C2-101): só para frente e idempotente.
ALTER TABLE depara_conta_gerencial ADD CONSTRAINT fk_depara_conta_gerencial_grupo_consolidacao_id FOREIGN KEY IF NOT EXISTS (grupo_consolidacao_id) REFERENCES grupo_consolidacao (id) ON DELETE RESTRICT;
ALTER TABLE depara_conta_gerencial ADD CONSTRAINT fk_depara_conta_gerencial_conta_contabil_id FOREIGN KEY IF NOT EXISTS (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
ALTER TABLE depara_conta_gerencial ADD CONSTRAINT fk_depara_conta_gerencial_conta_gerencial_consolidada_id FOREIGN KEY IF NOT EXISTS (conta_gerencial_consolidada_id) REFERENCES conta_gerencial_consolidada (id) ON DELETE RESTRICT;
ALTER TABLE saldo_consolidado_mensal ADD UNIQUE KEY IF NOT EXISTS uq_saldo_consolidado_mensal_grupo_conta_competencia_origem (grupo_consolidacao_id, conta_gerencial_consolidada_id, competencia, estabelecimento_origem_id);
ALTER TABLE saldo_consolidado_mensal ADD INDEX IF NOT EXISTS ix_saldo_consolidado_mensal_conta_gerencial_consolidada_id (conta_gerencial_consolidada_id);
ALTER TABLE saldo_consolidado_mensal DROP INDEX IF EXISTS uq_saldo_consolidado_mensal_conta_competencia_origem;
ALTER TABLE saldo_consolidado_mensal ADD CONSTRAINT fk_saldo_consolidado_mensal_grupo_consolidacao_id FOREIGN KEY IF NOT EXISTS (grupo_consolidacao_id) REFERENCES grupo_consolidacao (id) ON DELETE RESTRICT;
