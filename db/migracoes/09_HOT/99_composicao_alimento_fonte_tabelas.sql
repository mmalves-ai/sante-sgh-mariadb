-- Composição nutricional dos alimentos (F8, 04-HOT linha 142, 26/11/2026; decisão C3-018): o padrão da base é a TACO
-- 4ª edição (NEPA/Unicamp, de livre uso com citação), carregada como catálogo público versionado (regra 7,
-- catalogos/carregadores/taco.py); a TBCA (USP/FoRC) só entra como espelho licenciado (ADR 0006) quando houver licença.
-- O alimento passa a guardar a fonte e o código nela (o código da TACO não é o da TBCA): a chave única é a fonte mais o
-- código, e a edição fica em versao_fonte. Itens próprios do hospital usam a fonte 'propria'. Só para frente e
-- idempotente (ADR 0002, parte 2); sem gatilho.
ALTER TABLE alimento_referencia
  CHANGE COLUMN IF EXISTS codigo_tbca codigo_fonte VARCHAR(20) NOT NULL COMMENT 'Código do alimento na tabela de composição de origem (fonte_composicao)';

ALTER TABLE alimento_referencia
  ADD COLUMN IF NOT EXISTS fonte_composicao VARCHAR(10) NOT NULL DEFAULT 'taco' COMMENT 'Tabela de composição de origem: taco (pública), tbca (licenciada) ou propria (do hospital)' AFTER id;

ALTER TABLE alimento_referencia
  DROP INDEX IF EXISTS uq_alimento_referencia_codigo_tbca,
  DROP CONSTRAINT IF EXISTS ck_alimento_referencia_fonte_composicao;

ALTER TABLE alimento_referencia
  ADD UNIQUE KEY IF NOT EXISTS uq_alimento_referencia_fonte_codigo (fonte_composicao, codigo_fonte),
  ADD CONSTRAINT ck_alimento_referencia_fonte_composicao CHECK (fonte_composicao IN ('taco','tbca','propria'));
