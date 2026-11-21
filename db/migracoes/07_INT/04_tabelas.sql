-- INT, lote 04 (F2.2 onda 1): uma ocupação de observação aberta por atendimento (defesa no banco; a recusa de negócio
-- 'ja-em-observacao' continua no domínio do atendimento). Sem FOREIGN KEY nova.

ALTER TABLE ocupacao_leito_observacao
  ADD COLUMN atendimento_vigente_id BIGINT UNSIGNED AS (IF(situacao = 'ativa' AND data_hora_saida IS NULL, atendimento_id, NULL)) PERSISTENT COMMENT 'Garante uma única ocupação aberta por atendimento',
  ADD UNIQUE KEY uq_ocupacao_leito_observacao_atendimento_vigente (atendimento_vigente_id);
