-- Suprimentos, sobra da ordem de fracionamento e unitarização (C2-092, 05-SUP linha 11, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). O que a embalagem aberta rende além das doses e da perda não some do inventário
-- (RDC 67/2007): sem reaproveitamento pela regra do insumo, a sobra é descarte e entra na perda (o domínio recusa a
-- ordem sem destino); com reaproveitamento, fica registrada no item da ordem com a validade dela. Sem gatilho: a conta
-- é do domínio (unitarizacao-dose, sobraDaOrdem); a CHECK só garante que sobra registrada tem validade.
ALTER TABLE ordem_unitarizacao_item
  ADD COLUMN IF NOT EXISTS quantidade_sobra DECIMAL(15,4) NOT NULL DEFAULT 0 COMMENT 'Doses que sobram do que foi aberto, reaproveitadas pela regra' AFTER quantidade_perda,
  ADD COLUMN IF NOT EXISTS validade_sobra DATE NULL COMMENT 'Validade da sobra reaproveitada (a mesma conta da dose, RDC 67/2007)' AFTER quantidade_sobra;

ALTER TABLE ordem_unitarizacao_item
  DROP CONSTRAINT IF EXISTS ck_ordem_unitarizacao_item_sobra;

ALTER TABLE ordem_unitarizacao_item
  ADD CONSTRAINT ck_ordem_unitarizacao_item_sobra CHECK (quantidade_sobra >= 0 AND (quantidade_sobra = 0 OR validade_sobra IS NOT NULL));
