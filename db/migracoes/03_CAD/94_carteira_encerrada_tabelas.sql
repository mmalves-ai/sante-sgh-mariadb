-- Cadastro, carteira encerrada não bloqueia o mesmo número (F3.1, 02-CAD linha 9, prova de 24/11/2026): só para frente
-- e idempotente (ADR 0002, parte 2). Sem gatilho.
-- A chave única da carteira (paciente, fonte pagadora, número) valia também para a carteira encerrada, e a volta do
-- paciente ao mesmo plano (nova vigência, carteira nova com o mesmo número) era recusada pelo banco, embora a regra da
-- operação só recuse a carteira repetida não encerrada. A unicidade passa a valer só para a carteira viva: a coluna
-- gerada repete o número enquanto a carteira não está cancelada nem excluída e fica nula depois, e o índice único é
-- sobre ela. O histórico das carteiras encerradas continua no banco, sem apagar nada.
ALTER TABLE cobertura_paciente
  ADD COLUMN IF NOT EXISTS numero_carteira_vivo VARCHAR(30)
    AS (IF(situacao <> 'cancelada' AND excluido_em IS NULL, numero_carteira, NULL)) PERSISTENT
    COMMENT 'Número da carteira enquanto viva (não cancelada nem excluída); nulo depois, para a unicidade';
ALTER TABLE cobertura_paciente
  ADD UNIQUE KEY IF NOT EXISTS uq_cobertura_paciente_carteira_viva (paciente_id, fonte_pagadora_id, numero_carteira_vivo);
ALTER TABLE cobertura_paciente DROP INDEX IF EXISTS uq_cobertura_paciente_carteira;
