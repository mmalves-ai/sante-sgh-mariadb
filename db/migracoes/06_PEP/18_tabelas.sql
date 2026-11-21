-- PEP, lote 18 (F4 conector, rodada 4: pedido 14 do saida/L6-05.json e pedido 6 do saida/L7-08.json). Convenções do
-- ADR 0002 (parte 2). Só para frente. Sem FOREIGN KEY aqui (18_chaves.sql).

-- L6-05 / L7-08: ficha do antimicrobiano migrada (origem = 'migracao'). A ficha da comissão de controle de infecção do
-- sistema anterior traz atendimento, paciente, tipo de tratamento, prescritor e convênio, mas não o item prescrito, a
-- origem da infecção nem a justificativa; o antimicrobiano e as datas vêm da liberação (e podem não existir: ficha
-- negada ou nunca dispensada). Esses campos aceitam nulo SÓ na ficha migrada: a ficha nova do sistema continua
-- obrigada a tudo (CHECK abaixo). Os CHECK de dias, datas e origem da infecção só valem com valor (nulo passa).
ALTER TABLE ficha_antimicrobiano
  MODIFY COLUMN prescricao_item_id BIGINT UNSIGNED NULL COMMENT 'Item prescrito que a ficha justifica (nulo só na ficha migrada)',
  MODIFY COLUMN antimicrobiano_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN prescritor_profissional_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN finalidade_terapeutica_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN origem_infeccao VARCHAR(25) NULL,
  MODIFY COLUMN justificativa VARCHAR(4000) NULL,
  MODIFY COLUMN data_inicio DATE NULL,
  MODIFY COLUMN dias_previstos SMALLINT UNSIGNED NULL,
  MODIFY COLUMN data_fim_prevista DATE NULL;
ALTER TABLE ficha_antimicrobiano ADD CONSTRAINT ck_ficha_antimicrobiano_completa CHECK (origem = 'migracao' OR (prescricao_item_id IS NOT NULL AND antimicrobiano_id IS NOT NULL AND prescritor_profissional_id IS NOT NULL AND finalidade_terapeutica_id IS NOT NULL AND origem_infeccao IS NOT NULL AND justificativa IS NOT NULL AND data_inicio IS NOT NULL AND dias_previstos IS NOT NULL AND data_fim_prevista IS NOT NULL));
