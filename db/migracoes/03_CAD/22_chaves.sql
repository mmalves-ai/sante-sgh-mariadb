-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

ALTER TABLE fonte_pagadora ADD CONSTRAINT fk_fonte_pagadora_unidade_federativa_id FOREIGN KEY IF NOT EXISTS (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE fonte_pagadora ADD CONSTRAINT fk_fonte_pagadora_nota_fiscal_unidade_federativa_id FOREIGN KEY IF NOT EXISTS (nota_fiscal_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
