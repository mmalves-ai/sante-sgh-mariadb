-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE agendamento_cirurgico ADD CONSTRAINT fk_agendamento_cirurgico_conta_portal_profissional_externo_id FOREIGN KEY IF NOT EXISTS (conta_portal_profissional_externo_id) REFERENCES conta_portal_profissional_externo (id) ON DELETE RESTRICT;

ALTER TABLE agendamento_cirurgico_recurso ADD CONSTRAINT fk_agendamento_cirurgico_recurso_agendamento_cirurgico_id FOREIGN KEY IF NOT EXISTS (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;

