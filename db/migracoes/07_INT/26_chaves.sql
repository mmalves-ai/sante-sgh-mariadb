-- Pré-internação ligada à cirurgia (26_tabelas.sql). Só para frente e idempotente.

ALTER TABLE agendamento_internacao ADD CONSTRAINT fk_agendamento_internacao_agendamento_cirurgico_id FOREIGN KEY IF NOT EXISTS (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
