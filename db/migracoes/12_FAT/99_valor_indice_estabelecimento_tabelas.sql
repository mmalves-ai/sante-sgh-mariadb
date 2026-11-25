-- Valor do índice e do porte do acordo por estabelecimento (06-FAT linha 5, F3.7, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a regra de leitura fica em apps/api/src/modulos/precos/indices-propria.ts.
--   - valor_indice.estabelecimento_id e valor_porte_medico.estabelecimento_id: o estabelecimento em que o valor do
--     acordo (fonte pagadora, sem tabela) vale. A gravação pela tela sempre o preenche com o estabelecimento da sessão,
--     e o valor gravado num estabelecimento nunca muda a cobrança de outro. Nulo: valor do acordo que vale em todo
--     estabelecimento com acordo vigente com a fonte (o que já existia antes desta coluna). O do estabelecimento vence
--     o da rede na mesma data. Na linha da tabela de preço fica nulo (a tabela já é de um estabelecimento).

ALTER TABLE valor_indice
  ADD COLUMN IF NOT EXISTS estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Estabelecimento em que vale o valor do acordo; nulo: todos com acordo com a fonte' AFTER tabela_preco_id;

ALTER TABLE valor_indice
  ADD INDEX IF NOT EXISTS ix_valor_indice_estabelecimento_id (estabelecimento_id, fonte_pagadora_id, vigencia_inicio);

ALTER TABLE valor_porte_medico
  ADD COLUMN IF NOT EXISTS estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Estabelecimento em que vale o valor do acordo; nulo: todos com acordo com a fonte' AFTER tabela_preco_id;

ALTER TABLE valor_porte_medico
  ADD INDEX IF NOT EXISTS ix_valor_porte_medico_estabelecimento_id (estabelecimento_id, fonte_pagadora_id, vigencia_inicio);
