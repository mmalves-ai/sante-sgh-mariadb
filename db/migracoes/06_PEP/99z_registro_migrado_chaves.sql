-- Recusas da carga (fase 2, K1): profissional que suspendeu o registro clínico. Idempotente.
ALTER TABLE registro_assistencial ADD CONSTRAINT fk_registro_assistencial_suspenso_por_profissional_id FOREIGN KEY IF NOT EXISTS (suspenso_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
