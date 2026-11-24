-- Repasse, glosa revertida depois do desconto (família repasse-glosa, fecho-1, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-repasse, producao-conta.ts) e na porta
-- (@sgh/persistencia, repasse-producao).
--   - lancamento_repasse.producao_repasse_id: o crédito ao profissional da glosa revertida depois que o débito já foi
--     descontado numa apuração conferida é um lançamento de ajuste ligado à produção que ele devolve (o já estornado da
--     produção é líquido desses créditos: a sincronização repetida não lança de novo). Só o ajuste liga a produção.
--     Nenhum valor gravado muda; histórico nunca é apagado.

ALTER TABLE lancamento_repasse
  ADD COLUMN IF NOT EXISTS producao_repasse_id BIGINT UNSIGNED NULL COMMENT 'Produção devolvida pelo crédito da glosa revertida (só no ajuste)' AFTER estornado_lancamento_repasse_id,
  ADD KEY IF NOT EXISTS ix_lancamento_repasse_producao_repasse (producao_repasse_id);

ALTER TABLE lancamento_repasse
  ADD CONSTRAINT IF NOT EXISTS ck_lancamento_repasse_producao CHECK (producao_repasse_id IS NULL OR (tipo_lancamento = 'ajuste' AND valor > 0));
