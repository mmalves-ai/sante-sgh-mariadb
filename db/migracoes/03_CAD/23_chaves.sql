-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE fonte_pagadora ADD CONSTRAINT fk_fonte_pagadora_nota_fiscal_pessoa_juridica FOREIGN KEY IF NOT EXISTS (nota_fiscal_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE contato_fonte_pagadora ADD CONSTRAINT fk_contato_fonte_pagadora_fonte FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
