-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

-- Contrato do convênio (tela de preços): a UF do convênio e a UF da nota fiscal.
ALTER TABLE fonte_pagadora
  ADD COLUMN IF NOT EXISTS unidade_federativa_id BIGINT UNSIGNED NULL COMMENT 'UF do convênio (tabelas e regras por estado)' AFTER registro_ans,
  ADD COLUMN IF NOT EXISTS nota_fiscal_unidade_federativa_id BIGINT UNSIGNED NULL COMMENT 'UF da emissão da nota fiscal ao convênio' AFTER unidade_federativa_id,
  ADD KEY IF NOT EXISTS ix_fonte_pagadora_unidade_federativa_id (unidade_federativa_id),
  ADD KEY IF NOT EXISTS ix_fonte_pagadora_nota_fiscal_unidade_federativa_id (nota_fiscal_unidade_federativa_id);
