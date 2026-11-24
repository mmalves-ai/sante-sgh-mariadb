-- SADT, limites do pedido de exame (F8, 05-SADT linha 6; 24/11/2026). Só para frente e idempotente (ADR 0002, parte 2).
-- O bloqueio pelo último resultado passa a ter o estabelecimento que o cadastrou, como a cota e o intervalo: a regra
-- de uma unidade não trava nem é desativada por outra, e a trilha diz de onde veio. Nulo = vale no cliente todo
-- (só o administrador cadastra ou desativa a regra de alcance global).
ALTER TABLE bloqueio_exame_resultado
  ADD COLUMN IF NOT EXISTS estabelecimento_id BIGINT UNSIGNED NULL
    COMMENT 'Estabelecimento da regra; nulo = vale em todos os estabelecimentos do cliente' AFTER id,
  ADD KEY IF NOT EXISTS ix_bloqueio_exame_resultado_estabelecimento_id (estabelecimento_id);
