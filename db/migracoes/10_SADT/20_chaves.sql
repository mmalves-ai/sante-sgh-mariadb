-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE aviso_valor_critico_tentativa ADD CONSTRAINT fk_aviso_valor_critico_tentativa_conta_portal_profissio_0a685563 FOREIGN KEY IF NOT EXISTS (conta_portal_profissional_externo_id) REFERENCES conta_portal_profissional_externo (id) ON DELETE RESTRICT;

