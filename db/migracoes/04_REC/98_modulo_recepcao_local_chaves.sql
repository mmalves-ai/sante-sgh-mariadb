-- Chave do módulo de recepção do local de atendimento (F3.1, 02-CAD linha 2). Idempotente.
ALTER TABLE local_atendimento
  ADD CONSTRAINT fk_local_atendimento_modulo_recepcao_id FOREIGN KEY IF NOT EXISTS (modulo_recepcao_id) REFERENCES modulo_recepcao (id) ON DELETE RESTRICT;
