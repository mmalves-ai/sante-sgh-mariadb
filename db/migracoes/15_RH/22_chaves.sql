-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

ALTER TABLE cadastro_empregador_motivo_afastamento ADD CONSTRAINT fk_cadastro_empregador_motivo_afastamento_cadastro FOREIGN KEY IF NOT EXISTS (cadastro_empregador_id) REFERENCES cadastro_empregador (id) ON DELETE RESTRICT;
ALTER TABLE cadastro_empregador_motivo_afastamento ADD CONSTRAINT fk_cadastro_empregador_motivo_afastamento_motivo FOREIGN KEY IF NOT EXISTS (motivo_afastamento_id) REFERENCES motivo_afastamento (id) ON DELETE RESTRICT;
ALTER TABLE integracao_folha_financeiro_destino ADD CONSTRAINT fk_integracao_folha_financeiro_destino_conta_contabil_id FOREIGN KEY IF NOT EXISTS (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT;
