-- F7, 07-FIN linha 115 (C3-023): a forma mensal por estimativa do lucro real guarda a base escolhida (receita bruta
-- com os percentuais de presunção, ou balancete de suspensão ou redução com o lucro acumulado desde janeiro) e os
-- tributos devidos nos meses anteriores do ano. Idempotente e válida em qualquer ordem (ADR 0002).

ALTER TABLE apuracao_irpj_csll
  ADD COLUMN IF NOT EXISTS base_estimativa VARCHAR(20) NULL COMMENT 'Estimativa mensal: receita_bruta ou balancete' AFTER forma_apuracao,
  ADD COLUMN IF NOT EXISTS receita_bruta DECIMAL(15,2) NULL COMMENT 'Receita bruta do mês (estimativa pela receita bruta)' AFTER lucro_antes_tributos,
  ADD COLUMN IF NOT EXISTS percentual_presuncao_irpj DECIMAL(7,4) NULL COMMENT 'Presunção do IRPJ sobre a receita bruta' AFTER receita_bruta,
  ADD COLUMN IF NOT EXISTS percentual_presuncao_csll DECIMAL(7,4) NULL COMMENT 'Presunção da CSLL sobre a receita bruta' AFTER percentual_presuncao_irpj,
  ADD COLUMN IF NOT EXISTS estimativas_anteriores_irpj DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Balancete: IRPJ devido nos meses anteriores do ano' AFTER deducoes_csll,
  ADD COLUMN IF NOT EXISTS estimativas_anteriores_csll DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Balancete: CSLL devida nos meses anteriores do ano' AFTER estimativas_anteriores_irpj,
  DROP CONSTRAINT IF EXISTS ck_apuracao_irpj_csll_base_estimativa;
ALTER TABLE apuracao_irpj_csll
  ADD CONSTRAINT ck_apuracao_irpj_csll_base_estimativa CHECK ((base_estimativa IS NULL OR base_estimativa IN ('receita_bruta','balancete')) AND (percentual_presuncao_irpj IS NULL OR percentual_presuncao_irpj BETWEEN 0 AND 100) AND (percentual_presuncao_csll IS NULL OR percentual_presuncao_csll BETWEEN 0 AND 100) AND estimativas_anteriores_irpj >= 0 AND estimativas_anteriores_csll >= 0);
