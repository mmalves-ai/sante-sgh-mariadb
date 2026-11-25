-- Suprimentos, produção interna (C1-124, 05-SUP linha 12, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- O fechamento da ordem de manipulação e a montagem do kit gravam o lote produzido (lote_produzido e
-- lote_produzido_custo, já no modelo) e movimentam o estoque com dois tipos nativos do catálogo: a entrada do produto
-- (custo médio pelo custo do lote) e o consumo dos componentes do kit. A regra é do domínio (producao-interna); o
-- banco só guarda.
INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES
  ('producao_entrada', 'Entrada do lote produzido (manipulação ou kit montado)', 'producao', 'entrada', TRUE, TRUE, TRUE, TRUE, UTC_TIMESTAMP(3)),
  ('producao_consumo', 'Consumo de componente na produção interna', 'producao', 'saida', TRUE, FALSE, TRUE, TRUE, UTC_TIMESTAMP(3));
