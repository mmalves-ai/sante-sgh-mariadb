-- Autorização prévia da cirurgia eletiva junto à operadora, por etapas (04-CC linha 102, F7, 25/11/2026).
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: as gravações e a trava da confirmação são do domínio
-- (@sgh/dominio-cirurgia, autorizacao-convenio.ts) e das portas próprias (tiss/autorizacao-previa-propria.ts e
-- cirurgia/operacoes.ts).
--   - solicitacao_autorizacao.agendamento_cirurgico_id: a guia de solicitação ligada à cirurgia agendada; as etapas da
--     autorização são as situações da guia (rascunho, pronta_envio, enviada, em_analise, autorizada...), sem tabela de
--     etapas à parte; a senha da resposta autorizada vai ao agendamento que ainda não tem senha;
--   - agendamento_cirurgico.autorizacao_posterior_*: a exceção de urgência registrada (justificativa, instante e
--     usuário) quando a cirurgia de urgência é confirmada sem a senha, para a comunicação posterior à operadora.

ALTER TABLE solicitacao_autorizacao
  ADD COLUMN IF NOT EXISTS agendamento_cirurgico_id BIGINT UNSIGNED NULL COMMENT 'Cirurgia agendada que a guia autoriza' AFTER conta_hospitalar_id;
ALTER TABLE solicitacao_autorizacao
  ADD KEY IF NOT EXISTS ix_solicitacao_autorizacao_agendamento_cirurgico_id (agendamento_cirurgico_id);

ALTER TABLE agendamento_cirurgico
  ADD COLUMN IF NOT EXISTS autorizacao_posterior_justificativa VARCHAR(500) NULL COMMENT 'Urgência confirmada sem senha: por que a guia é comunicada depois' AFTER senha_autorizacao,
  ADD COLUMN IF NOT EXISTS autorizacao_posterior_em DATETIME(3) NULL AFTER autorizacao_posterior_justificativa,
  ADD COLUMN IF NOT EXISTS autorizacao_posterior_por BIGINT UNSIGNED NULL AFTER autorizacao_posterior_em;
ALTER TABLE agendamento_cirurgico DROP CONSTRAINT IF EXISTS ck_agendamento_cirurgico_autorizacao_posterior;
ALTER TABLE agendamento_cirurgico
  ADD CONSTRAINT ck_agendamento_cirurgico_autorizacao_posterior CHECK ((autorizacao_posterior_justificativa IS NULL) = (autorizacao_posterior_em IS NULL));
ALTER TABLE agendamento_cirurgico
  ADD KEY IF NOT EXISTS ix_agendamento_cirurgico_autorizacao_posterior_por (autorizacao_posterior_por);
