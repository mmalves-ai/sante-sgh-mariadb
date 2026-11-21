-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE dispositivo_recepcao ADD CONSTRAINT fk_dispositivo_recepcao_painel_tv_id FOREIGN KEY IF NOT EXISTS (painel_tv_id) REFERENCES painel_tv (id) ON DELETE RESTRICT;
