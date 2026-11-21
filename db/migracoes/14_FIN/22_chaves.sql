-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

ALTER TABLE cota_depreciacao ADD CONSTRAINT fk_cota_depreciacao_centro_custo_id FOREIGN KEY IF NOT EXISTS (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
