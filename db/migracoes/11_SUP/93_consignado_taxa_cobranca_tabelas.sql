-- Suprimentos, a taxa de comercialização do consignado na cobrança (C1-014, 05-SUP linha 24, 25/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2).
-- 1) O faturamento do consumo consignado guarda o valor do material (custo da nota de compra × quantidade) e as
--    parcelas da taxa pela faixa vigente no dia (faixa, origem, percentual, taxa bruta, teto e taxa): a conferência da
--    cobrança fecha com o que foi gravado, e a tabela usada em cobrança não se troca mais.
-- 2) A tabela de faixas que ainda não foi usada em cobrança pode ser substituída no mesmo dia ou antes de começar: a
--    substituída fica inativa (nunca apagada). A unicidade da faixa passa a valer só entre as ativas.
-- A regra é do domínio (calcularTaxaConsignacao e planejarTabelaTaxaConsignacao); o banco só guarda.
ALTER TABLE reposicao_consignada
  ADD COLUMN IF NOT EXISTS valor_material DECIMAL(15,2) NULL
    COMMENT 'Faturamento: custo unitário do item na nota de compra × quantidade' AFTER nota_entrada_id,
  ADD COLUMN IF NOT EXISTS taxa_faixa_id BIGINT UNSIGNED NULL
    COMMENT 'Faturamento: a faixa da taxa de comercialização usada (nula sem tabela vigente)' AFTER valor_material,
  ADD COLUMN IF NOT EXISTS taxa_origem VARCHAR(12) NULL
    COMMENT 'Faturamento: tabela do fornecedor, geral ou sem tabela' AFTER taxa_faixa_id,
  ADD COLUMN IF NOT EXISTS taxa_percentual DECIMAL(7,4) NULL COMMENT 'Faturamento: percentual da faixa' AFTER taxa_origem,
  ADD COLUMN IF NOT EXISTS taxa_bruta DECIMAL(15,2) NULL COMMENT 'Faturamento: taxa antes do teto' AFTER taxa_percentual,
  ADD COLUMN IF NOT EXISTS taxa_teto DECIMAL(15,2) NULL COMMENT 'Faturamento: teto da faixa (nulo sem teto)' AFTER taxa_bruta,
  ADD COLUMN IF NOT EXISTS taxa_valor DECIMAL(15,2) NULL COMMENT 'Faturamento: taxa cobrada (bruta limitada ao teto)' AFTER taxa_teto;
ALTER TABLE reposicao_consignada
  ADD CONSTRAINT IF NOT EXISTS ck_reposicao_consignada_taxa_tipo
    CHECK (tipo = 'faturamento' OR (valor_material IS NULL AND taxa_valor IS NULL AND taxa_faixa_id IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_reposicao_consignada_taxa_origem
    CHECK (taxa_origem IS NULL OR taxa_origem IN ('fornecedor','geral','sem-tabela')),
  ADD CONSTRAINT IF NOT EXISTS ck_reposicao_consignada_taxa_valores
    CHECK (taxa_valor IS NULL OR (valor_material >= 0 AND taxa_percentual >= 0 AND taxa_bruta >= taxa_valor AND taxa_valor >= 0
      AND (taxa_teto IS NULL OR taxa_valor <= taxa_teto)));
CREATE INDEX IF NOT EXISTS ix_reposicao_consignada_taxa_faixa ON reposicao_consignada (taxa_faixa_id);

ALTER TABLE faixa_taxa_consignacao
  ADD COLUMN IF NOT EXISTS ativa_chave TINYINT UNSIGNED AS (IF(ativo, 1, NULL)) PERSISTENT
    COMMENT 'Auxiliar da unicidade: 1 na faixa ativa, nula na substituída' AFTER ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_faixa_taxa_consignacao_faixa_ativa
  ON faixa_taxa_consignacao (estabelecimento_id, empresa_fornecedora_id, fonte_pagadora_id, item_faturavel_id,
    valor_inicial, vigencia_inicio, ativa_chave);
DROP INDEX IF EXISTS uq_faixa_taxa_consignacao_faixa ON faixa_taxa_consignacao;
