-- Centro cirúrgico, gasto de sala do ato: o cirurgião cuja lista padrão valeu (F3.4, correção da fatia F3.4-5,
-- 24/11/2026). Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-cirurgia, gasto-sala: cirurgiaoDoGasto) e na operação.
--   - consumo_cirurgia.cirurgiao_profissional_id (nova): o cirurgião da equipe do ato escolhido na gravação; a tela, a
--     conferência e o débito usam o gravado, nunca o id que vem no pedido. Nulo: vale a lista do serviço.

ALTER TABLE consumo_cirurgia
  ADD COLUMN IF NOT EXISTS cirurgiao_profissional_id BIGINT UNSIGNED NULL COMMENT 'Cirurgião da equipe do ato cuja lista padrão valeu no gasto (nulo: lista do serviço)' AFTER local_estoque_id,
  ADD KEY IF NOT EXISTS ix_consumo_cirurgia_cirurgiao_profissional_id (cirurgiao_profissional_id);
