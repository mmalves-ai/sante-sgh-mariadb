-- Repasse, saldo devedor do profissional (família repasse-glosa, fecho-1, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-repasse, producao-conta.ts,
-- debitosNaApuracao) e a gravação na apuração (apps/api, repasse/porta-propria.ts, gravarApuracao).
--   - estorno_repasse.origem_estorno_repasse_id: o débito que não coube no bruto do profissional na apuração (sem
--     produção no período, ou bruto menor que o débito) é levado ao período seguinte como débito novo, 'pendente',
--     ligado ao de origem. O de origem continua 'aplicado' com o valor cheio (histórico intacto); o descontado na
--     apuração é o valor dele menos o levado adiante. Nenhum valor gravado muda; histórico nunca é apagado.

ALTER TABLE estorno_repasse
  ADD COLUMN IF NOT EXISTS origem_estorno_repasse_id BIGINT UNSIGNED NULL COMMENT 'Débito de origem do saldo devedor levado ao período seguinte' AFTER apuracao_repasse_id,
  ADD KEY IF NOT EXISTS ix_estorno_repasse_origem_estorno_repasse_id (origem_estorno_repasse_id);
