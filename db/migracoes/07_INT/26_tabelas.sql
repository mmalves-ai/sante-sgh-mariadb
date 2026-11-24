-- Pré-internação ligada à cirurgia que a motiva (F3.4, 04-INT linha 70): o agendamento da internação guarda a
-- cirurgia agendada do mesmo paciente, além da clínica e do procedimento previsto que já tinha. Só para frente e
-- idempotente (ADR 0002, parte 2). Origem: docs/fases/fichas/F3.4-internacao-cc.md.
ALTER TABLE agendamento_internacao
  ADD COLUMN IF NOT EXISTS agendamento_cirurgico_id BIGINT UNSIGNED NULL COMMENT 'Cirurgia agendada que motiva a internação' AFTER cirurgia_prevista_em,
  ADD KEY IF NOT EXISTS ix_agendamento_internacao_agendamento_cirurgico_id (agendamento_cirurgico_id);
