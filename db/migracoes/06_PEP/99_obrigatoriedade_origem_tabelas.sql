-- PEP, documento exigido: estabelecimento de origem da regra de todos os estabelecimentos (F7, 03-PEP L132, C2-028,
-- 25/11/2026). Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio e na porta.
-- A regra de todos os estabelecimentos (estabelecimento_id nulo) passa a guardar quem a criou: só esse estabelecimento
-- a altera ou desativa. A regra de todos os estabelecimentos não tem setor, que é de um estabelecimento só.
ALTER TABLE regra_obrigatoriedade_documento
  ADD COLUMN IF NOT EXISTS estabelecimento_origem_id BIGINT UNSIGNED NULL
    COMMENT 'Estabelecimento que criou a regra; a regra de todos os estabelecimentos só é alterada por ele'
    AFTER estabelecimento_id;
UPDATE regra_obrigatoriedade_documento SET estabelecimento_origem_id = estabelecimento_id
 WHERE estabelecimento_origem_id IS NULL AND estabelecimento_id IS NOT NULL;
ALTER TABLE regra_obrigatoriedade_documento
  ADD CONSTRAINT IF NOT EXISTS ck_regra_obrigatoriedade_documento_setor_global
    CHECK (estabelecimento_id IS NOT NULL OR setor_funcional_id IS NULL);
