-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE isolamento_paciente ADD CONSTRAINT fk_isolamento_paciente_exame_item FOREIGN KEY IF NOT EXISTS (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT;
