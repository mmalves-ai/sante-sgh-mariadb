-- Lote TISS por período (06-FAT linha 12, C2-035, decisão 58 do dono, 27/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). A conta com período fechado vai ao lote com uma guia por período fechado; a guia guarda o período dela para
-- reusar o número no lote refeito. Nula: a guia da conta inteira (ou a do que sobra fora dos períodos fechados). Sem
-- gatilho; a regra fica no domínio (@sgh/dominio-faturamento, conta/periodos-conta.ts, guiasPorPeriodoFechado).

ALTER TABLE guia_tiss
  ADD COLUMN IF NOT EXISTS conta_hospitalar_periodo_id BIGINT UNSIGNED NULL
    COMMENT 'Período fechado da conta que a guia apresenta; nulo: a conta inteira ou o que sobra' AFTER conta_hospitalar_id;

ALTER TABLE guia_tiss
  ADD KEY IF NOT EXISTS ix_guia_tiss_conta_hospitalar_periodo (conta_hospitalar_periodo_id);
