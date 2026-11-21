-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md
-- Faturamento SUS: as 18 gravações de apps/api/src/modulos/sus/porta-propria.ts, lidas contra o contrato da porta
-- (porta.ts, porta-aih.ts, tipos.ts). As tabelas estavam vazias em todos os clientes.

ALTER TABLE remessa_apac ADD CONSTRAINT fk_remessa_apac_gerador_usuario_id FOREIGN KEY IF NOT EXISTS (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE remessa_apac ADD CONSTRAINT fk_remessa_apac_substituta_remessa_apac_id FOREIGN KEY IF NOT EXISTS (substituta_remessa_apac_id) REFERENCES remessa_apac (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_apac ADD CONSTRAINT fk_autorizacao_apac_motivo_saida_dominio_sigtap_id FOREIGN KEY IF NOT EXISTS (motivo_saida_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE apac_procedimento ADD CONSTRAINT fk_apac_procedimento_conta_hospitalar_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_internacao_sus ADD CONSTRAINT fk_autorizacao_internacao_sus_conta_hospitalar_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE conta_aih_opm ADD CONSTRAINT fk_conta_aih_opm_conta_hospitalar_item_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
