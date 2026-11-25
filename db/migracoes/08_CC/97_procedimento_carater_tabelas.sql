-- Centro cirúrgico, cadastro do procedimento cirúrgico: caráter sugerido (F3.4, 04-CC linha 91, C1-089, 25/11/2026).
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-cirurgia, procedimento-cirurgico: validarProcedimentoCirurgico).
--   - procedimento_cirurgico.carater_cirurgia_id (nova): o caráter com que o procedimento costuma ser marcado
--     (eletiva, urgência...), sugerido no agendamento como a anestesia; vazio: sem sugestão. O caráter de cada cirurgia
--     continua no agendamento e no ato.

ALTER TABLE procedimento_cirurgico
  ADD COLUMN IF NOT EXISTS carater_cirurgia_id BIGINT UNSIGNED NULL COMMENT 'Caráter sugerido no agendamento' AFTER especialidade_medica_id,
  ADD KEY IF NOT EXISTS ix_procedimento_cirurgico_carater_cirurgia (carater_cirurgia_id);
