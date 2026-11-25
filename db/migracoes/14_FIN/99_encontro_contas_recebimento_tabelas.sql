-- Recebimento pelo encontro de contas (07-FIN linha 69, F8, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-financeiro, encontro-contas.ts) e na operação
-- (apps/api/src/modulos/financeiro/compensacao-previsao-propria.ts). A efetivação do encontro baixa a parcela a
-- receber com um recebimento de meio de baixa próprio, "encontro_contas", sem conta bancária nem caixa (não entra
-- dinheiro: o valor se compensa com o que se paga ao mesmo parceiro), na forma de recebimento "encontro_contas"
-- (meio "compensacao"). Assim o recebimento por compensação aparece nos relatórios de recebimento por forma. O item do
-- encontro guarda o recebimento gerado, e o estorno do encontro estorna esse recebimento (nada se apaga).
-- Roda depois de 99_cessao_lancamentos (ordem do nome), que também redefine ck_recebimento_meio_baixa.

-- O meio de baixa do encontro de contas no recebimento (a lista anterior continua toda aceita).
ALTER TABLE recebimento DROP CONSTRAINT IF EXISTS ck_recebimento_meio_baixa;
ALTER TABLE recebimento
  ADD CONSTRAINT IF NOT EXISTS ck_recebimento_meio_baixa CHECK (meio_baixa IN ('manual','retorno_bancario','pix','cartao','demonstrativo','conciliacao','cessao','encontro_contas'));

-- Conta ou caixa de entrada continua obrigatória, salvo no encontro de contas (sem dinheiro).
ALTER TABLE recebimento DROP CONSTRAINT IF EXISTS ck_recebimento_destino;
ALTER TABLE recebimento
  ADD CONSTRAINT IF NOT EXISTS ck_recebimento_destino CHECK (conta_bancaria_id IS NOT NULL OR caixa_id IS NOT NULL OR meio_baixa = 'encontro_contas');

-- O item a receber do encontro guarda o recebimento gerado na efetivação.
ALTER TABLE encontro_contas_item
  ADD COLUMN IF NOT EXISTS recebimento_id BIGINT UNSIGNED NULL COMMENT 'Recebimento gerado na efetivação (item a receber)' AFTER baixa_titulo_id;
ALTER TABLE encontro_contas_item
  ADD KEY IF NOT EXISTS ix_encontro_contas_item_recebimento (recebimento_id);

-- Forma de recebimento padrão de produto (não do hospital): INSERT IGNORE pelo código, sem reescrever o ajuste local.
INSERT IGNORE INTO forma_recebimento (codigo, descricao, meio, uso, criado_em) VALUES
  ('encontro_contas', 'Baixa por encontro de contas com o mesmo parceiro', 'compensacao', 'recebimento', NOW(3));

-- O devedor do lado a receber também pode ser a fonte pagadora (convênio ou operadora) com o mesmo CNPJ do fornecedor
-- (correção da revisão, 25/11): o encontro guarda a fonte, como já guarda o cliente financeiro.
ALTER TABLE encontro_contas
  ADD COLUMN IF NOT EXISTS fonte_pagadora_id BIGINT UNSIGNED NULL COMMENT 'Parceiro como fonte pagadora devedora (lado a receber)' AFTER cliente_financeiro_id;
ALTER TABLE encontro_contas
  ADD KEY IF NOT EXISTS ix_encontro_contas_fonte_pagadora (fonte_pagadora_id);
