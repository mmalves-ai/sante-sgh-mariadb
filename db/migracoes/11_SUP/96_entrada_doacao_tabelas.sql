-- Suprimentos, entrada de produtos recebidos em doação (C1-126, 09-AREA linha 79, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- 1) A doação entra como recebimento (nota_entrada com doacao = TRUE), sem pedido de compra e sem título a pagar. O
--    doador é uma empresa do cadastro (o emitente, empresa_fornecedora_id) ou uma pessoa do cadastro
--    (doador_pessoa_fisica_id): o emitente passa a ser opcional só na doação de pessoa. O número do termo de doação vai
--    em numero_documento.
-- 2) Cada item guarda o critério do custo de referência (valor justo do termo ou último preço de compra, NBC TG 07).
-- 3) O tipo de entrada "doacao" e o tipo de movimento "entrada_doacao" entram no catálogo do estoque (nativos).
-- A regra é do domínio (conferirEntradaDoacao, custoDaDoacao, quantidadeDoadaApos); o banco só guarda.
ALTER TABLE nota_entrada
  MODIFY COLUMN empresa_fornecedora_id BIGINT UNSIGNED NULL COMMENT 'Emitente da nota; na doação, a empresa doadora (nulo só na doação de pessoa)',
  ADD COLUMN IF NOT EXISTS doador_pessoa_fisica_id BIGINT UNSIGNED NULL
    COMMENT 'Doação: a pessoa do cadastro que doou (nulo quando o doador é empresa)' AFTER doacao;
ALTER TABLE nota_entrada
  ADD CONSTRAINT IF NOT EXISTS ck_nota_entrada_emitente
    CHECK (empresa_fornecedora_id IS NOT NULL OR (doacao = TRUE AND doador_pessoa_fisica_id IS NOT NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_nota_entrada_doador
    CHECK (doador_pessoa_fisica_id IS NULL OR (doacao = TRUE AND empresa_fornecedora_id IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_nota_entrada_doacao_sem_pedido
    CHECK (doacao = FALSE OR pedido_compra_id IS NULL);
CREATE INDEX IF NOT EXISTS ix_nota_entrada_doador_pessoa_fisica ON nota_entrada (doador_pessoa_fisica_id);

ALTER TABLE nota_entrada_item
  ADD COLUMN IF NOT EXISTS criterio_custo_doacao VARCHAR(20) NULL
    COMMENT 'Doação: critério do custo de referência (valor_justo do termo ou ultimo_preco de compra)';
ALTER TABLE nota_entrada_item
  ADD CONSTRAINT IF NOT EXISTS ck_nota_entrada_item_criterio_doacao
    CHECK (criterio_custo_doacao IS NULL OR criterio_custo_doacao IN ('valor_justo','ultimo_preco'));

INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES
  ('entrada_doacao', 'Entrada de produto recebido em doação', 'entrada', 'entrada', TRUE, TRUE, TRUE, TRUE, UTC_TIMESTAMP(3));
INSERT IGNORE INTO tipo_entrada_estoque (codigo, descricao, natureza, tipo_movimento_estoque_id, exige_documento_fiscal,
    atualiza_custo_medio, atualiza_ultimo_preco, gera_conta_pagar, retem_imposto, exige_fornecedor, exige_pedido_compra, ativo, criado_em)
  SELECT 'doacao', 'Doação recebida', 'doacao', tm.id, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, UTC_TIMESTAMP(3)
    FROM tipo_movimento_estoque tm WHERE tm.codigo = 'entrada_doacao';
