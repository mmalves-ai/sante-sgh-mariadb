-- Equipe do item da conta (06-FAT linha 15, F3.7, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, conta/movimentos.ts) e na operação
-- (apps/api/src/modulos/faturamento/conta-movimentos-propria.ts).
--   - conta_hospitalar_item_participante.percentual_cobranca: o percentual do honorário do item usado no valor do ato
--     do participante (o informado ou o da função na hora). Guardado para refazer o valor quando o honorário muda
--     (transferência para outra conta, outra tabela) sem perder o percentual que o faturista escolheu.
--   - conta_hospitalar_item_participante.transferencia_conta_id: a transferência que encerrou o participante no item de
--     origem (a cópia segue no item de destino); a linha de origem fica marcada, nunca apagada.

ALTER TABLE conta_hospitalar_item_participante
  ADD COLUMN IF NOT EXISTS percentual_cobranca DECIMAL(7,4) NULL COMMENT 'Percentual do honorário do item usado no valor do ato' AFTER forma_pagamento,
  ADD COLUMN IF NOT EXISTS transferencia_conta_id BIGINT UNSIGNED NULL COMMENT 'Transferência que encerrou o participante no item de origem' AFTER guia_tiss_id,
  ADD KEY IF NOT EXISTS ix_conta_hospitalar_item_participante_transferencia (transferencia_conta_id);

ALTER TABLE conta_hospitalar_item_participante
  ADD CONSTRAINT IF NOT EXISTS ck_conta_hospitalar_item_participante_percentual CHECK (percentual_cobranca IS NULL OR percentual_cobranca BETWEEN 0 AND 100);
