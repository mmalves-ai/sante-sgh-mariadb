-- FAT, lote 13 (F4 conector, rodada 4, conferidor): pedidos de modelo L8-03 #16, L8-04 #25 e L8-05 #22, decididos em
-- docs/obra/passagens/F4-decisoes-destino.md. Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (13_chaves.sql).

-- L8-03 (16): equivalência do item de mat/med à referência UNIFICADA (sem fonte pagadora: vale para os locais de
-- cobrança que usam a referência unificada), com a classificação e o código alfanumérico da referência
ALTER TABLE equivalencia_matmed_fonte_pagadora
  MODIFY COLUMN fonte_pagadora_id BIGINT UNSIGNED NULL COMMENT 'Nulo: equivalência da referência unificada, vale para os locais de cobrança que a usam',
  ADD COLUMN classificacao_na_fonte SMALLINT NULL COMMENT 'Classificação do item na referência',
  ADD COLUMN codigo_alfa_na_fonte VARCHAR(10) NULL COMMENT 'Código alfanumérico complementar do item na referência';

-- L8-04 (25): exceção de preço base pelo item de referência de mat/med (o preço base é atributo dele)
ALTER TABLE referencia_emissao_matmed_excecao
  ADD COLUMN item_referencia_matmed_id BIGINT UNSIGNED NULL COMMENT 'Item de referência de mat/med da exceção' AFTER item_faturavel_id,
  MODIFY COLUMN item_faturavel_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_referencia_emissao_matmed_excecao_alvo CHECK (item_faturavel_id IS NOT NULL OR item_referencia_matmed_id IS NOT NULL),
  ADD UNIQUE KEY uq_referencia_emissao_matmed_excecao_referencia (fonte_pagadora_id, item_referencia_matmed_id);

-- L8-05 (22): preço negociado de mat/med pelo item de referência (o item da tabela do hospital, sem insumo na origem)
ALTER TABLE preco_negociado_matmed
  ADD COLUMN item_referencia_matmed_id BIGINT UNSIGNED NULL COMMENT 'Item de referência de mat/med negociado' AFTER item_faturavel_id,
  MODIFY COLUMN item_faturavel_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_preco_negociado_matmed_alvo CHECK (item_faturavel_id IS NOT NULL OR item_referencia_matmed_id IS NOT NULL),
  ADD UNIQUE KEY uq_preco_negociado_matmed_referencia (fonte_pagadora_id, plano_fonte_pagadora_id, item_referencia_matmed_id, tipo_conta_id, vigencia_inicio),
  ADD KEY ix_preco_negociado_matmed_item_referencia_matmed_id (item_referencia_matmed_id);
