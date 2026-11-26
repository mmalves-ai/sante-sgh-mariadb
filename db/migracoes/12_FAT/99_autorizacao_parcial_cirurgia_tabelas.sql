-- Conferência da autorização parcial da cirurgia (04-CC linha 102, F7, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho: a trava da confirmação é do domínio (@sgh/dominio-cirurgia, autorizacao-convenio.ts)
-- e das portas próprias (tiss/autorizacao-previa-propria.ts e cirurgia/operacoes.ts).
--   - agendamento_cirurgico.autorizacao_parcial_*: quando a operadora autoriza só parte da guia ligada, a cirurgia só é
--     confirmada e só entra no bloco depois que alguém registra a conferência (o que segue autorizado e o que foi
--     retirado ou complementado), com o instante e o usuário.

ALTER TABLE agendamento_cirurgico
  ADD COLUMN IF NOT EXISTS autorizacao_parcial_conferencia VARCHAR(500) NULL COMMENT 'Autorização parcial: o que segue autorizado e o que foi retirado ou complementado' AFTER autorizacao_posterior_por,
  ADD COLUMN IF NOT EXISTS autorizacao_parcial_conferida_em DATETIME(3) NULL AFTER autorizacao_parcial_conferencia,
  ADD COLUMN IF NOT EXISTS autorizacao_parcial_conferida_por BIGINT UNSIGNED NULL AFTER autorizacao_parcial_conferida_em;
ALTER TABLE agendamento_cirurgico DROP CONSTRAINT IF EXISTS ck_agendamento_cirurgico_autorizacao_parcial;
ALTER TABLE agendamento_cirurgico
  ADD CONSTRAINT ck_agendamento_cirurgico_autorizacao_parcial CHECK ((autorizacao_parcial_conferencia IS NULL) = (autorizacao_parcial_conferida_em IS NULL) AND (autorizacao_parcial_conferencia IS NULL) = (autorizacao_parcial_conferida_por IS NULL));
ALTER TABLE agendamento_cirurgico
  ADD KEY IF NOT EXISTS ix_agendamento_cirurgico_autorizacao_parcial_conferida_por (autorizacao_parcial_conferida_por);
