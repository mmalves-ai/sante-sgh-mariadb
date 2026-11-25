-- Chaves da autorização prévia da cirurgia eletiva (04-CC linha 102, F7, 25/11/2026): só para frente e idempotente.

ALTER TABLE solicitacao_autorizacao
  ADD CONSTRAINT fk_solicitacao_autorizacao_agendamento_cirurgico_id FOREIGN KEY IF NOT EXISTS (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_cirurgico
  ADD CONSTRAINT fk_agendamento_cirurgico_autorizacao_posterior_por FOREIGN KEY IF NOT EXISTS (autorizacao_posterior_por) REFERENCES usuario (id) ON DELETE RESTRICT;
