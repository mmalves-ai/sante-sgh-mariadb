-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE exame_oftalmologico_item ADD CONSTRAINT fk_exame_oftalmologico_item_exame FOREIGN KEY IF NOT EXISTS (exame_oftalmologico_id) REFERENCES exame_oftalmologico (id) ON DELETE RESTRICT;
ALTER TABLE exame_oftalmologico_item ADD CONSTRAINT fk_exame_oftalmologico_item_tipo FOREIGN KEY IF NOT EXISTS (tipo_exame_oftalmologico_id) REFERENCES tipo_exame_oftalmologico (id) ON DELETE RESTRICT;
ALTER TABLE exame_oftalmologico_valor ADD CONSTRAINT fk_exame_oftalmologico_valor_acuidade FOREIGN KEY IF NOT EXISTS (acuidade_visual_id) REFERENCES acuidade_visual (id) ON DELETE RESTRICT;
