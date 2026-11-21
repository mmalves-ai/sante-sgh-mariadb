-- FAT, lote 11 (F4 conector, rodada 3 de cobertura, grupo 3: pedido de modelo da fatia L8-05, registrado para a
-- trilha F2.2 em docs/obra/passagens/F4-decisoes-destino.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (11_chaves.sql).

-- L8-05: a diária por plano e local vale para a FONTE pagadora (obrigatória), com o acordo opcional (nulo: qualquer
-- acordo da fonte), e o tipo de plano pode ser a categoria de acomodação ou o plano da fonte (um dos dois). A fonte
-- das linhas que já existem vem do acordo delas. Índice próprio do acordo antes de trocar a chave única (a FK do
-- acordo usava o índice da chave).
ALTER TABLE diaria_por_plano_local
  ADD COLUMN fonte_pagadora_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN plano_fonte_pagadora_id BIGINT UNSIGNED NULL COMMENT 'Plano da fonte (tipo de plano próprio da fonte); nulo quando vale a categoria de acomodação' AFTER categoria_acomodacao_id,
  ADD KEY ix_diaria_por_plano_local_contrato_fonte_pagadora_id (contrato_fonte_pagadora_id),
  ADD KEY ix_diaria_por_plano_local_plano_fonte_pagadora_id (plano_fonte_pagadora_id);
UPDATE diaria_por_plano_local d JOIN contrato_fonte_pagadora c ON c.id = d.contrato_fonte_pagadora_id
  SET d.fonte_pagadora_id = c.fonte_pagadora_id WHERE d.fonte_pagadora_id IS NULL;
ALTER TABLE diaria_por_plano_local
  MODIFY COLUMN fonte_pagadora_id BIGINT UNSIGNED NOT NULL,
  MODIFY COLUMN contrato_fonte_pagadora_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para qualquer acordo da fonte',
  MODIFY COLUMN categoria_acomodacao_id BIGINT UNSIGNED NULL COMMENT 'Tipo de plano: apartamento, enfermaria; nulo quando vale o plano da fonte',
  ADD CONSTRAINT ck_diaria_por_plano_local_tipo_plano CHECK (categoria_acomodacao_id IS NOT NULL OR plano_fonte_pagadora_id IS NOT NULL),
  DROP INDEX uq_diaria_por_plano_local_regra,
  ADD UNIQUE KEY uq_diaria_por_plano_local_regra (fonte_pagadora_id, contrato_fonte_pagadora_id, categoria_acomodacao_id, plano_fonte_pagadora_id, local_cobranca_id, vigencia_inicio);
