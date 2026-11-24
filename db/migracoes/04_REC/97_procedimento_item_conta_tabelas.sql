-- Recepção, procedimento extra da ficha ligado ao item da conta (F3.2, 02-REC linha 30, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - conta_hospitalar_item_id: o procedimento extra lançado pela recepção aponta o item que ele gerou na conta do
--     atendimento; a correção (quantidade, data) e o estorno mudam os dois na mesma transação, e a ficha mostra o
--     extra pela sua própria sequência (estável), nunca pela posição na conta.
ALTER TABLE atendimento_procedimento
  ADD COLUMN IF NOT EXISTS conta_hospitalar_item_id BIGINT UNSIGNED NULL COMMENT 'Item da conta gerado pelo procedimento extra',
  ADD KEY IF NOT EXISTS ix_atendimento_procedimento_conta_hospitalar_item_id (conta_hospitalar_item_id);
