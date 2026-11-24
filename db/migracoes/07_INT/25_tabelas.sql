-- Pré-internação sem data (F3.4, 04-INT linha 70): a data prevista ausente é NULA, nunca uma data sentinela nem o
-- instante da gravação. A fila de espera (situação em_espera) é exatamente a pré-internação sem data; a lista ordena
-- as sem data por último. Só para frente e idempotente (ADR 0002, parte 2). Origem: docs/fases/fichas/F3.4-internacao-cc.md.
ALTER TABLE agendamento_internacao
  MODIFY COLUMN previsto_para DATETIME(3) NULL COMMENT 'Data e hora previstas da internação; nula na fila de espera (sem data)';

-- Linhas anteriores: a fila de espera gravava o instante da gravação no lugar da data ausente.
UPDATE agendamento_internacao SET previsto_para = NULL WHERE situacao = 'em_espera' AND previsto_para IS NOT NULL;

-- Na fila de espera a data é nula; fora dela, a data existe enquanto o agendamento está pendente.
ALTER TABLE agendamento_internacao DROP CONSTRAINT IF EXISTS ck_agendamento_internacao_previsto;
ALTER TABLE agendamento_internacao
  ADD CONSTRAINT ck_agendamento_internacao_previsto CHECK (
    (situacao = 'em_espera' AND previsto_para IS NULL)
    OR (situacao IN ('solicitado','aguardando_autorizacao','autorizado','confirmado') AND previsto_para IS NOT NULL)
    OR situacao IN ('internado','cancelado','nao_compareceu'));
