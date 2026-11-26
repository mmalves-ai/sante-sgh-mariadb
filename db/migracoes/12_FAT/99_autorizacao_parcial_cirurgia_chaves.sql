-- Chaves da conferência da autorização parcial da cirurgia (04-CC linha 102, F7, 25/11/2026): só para frente e idempotente.

ALTER TABLE agendamento_cirurgico
  ADD CONSTRAINT fk_agendamento_cirurgico_autorizacao_parcial_conferida_por FOREIGN KEY IF NOT EXISTS (autorizacao_parcial_conferida_por) REFERENCES usuario (id) ON DELETE RESTRICT;
