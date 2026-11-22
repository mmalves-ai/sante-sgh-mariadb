SELECT d.item, d.item FROM (
  SELECT 1 AS item, 'saldo_estoque' AS estrutura_produto
  UNION ALL SELECT 2 AS item, 'saldo_consignado' AS estrutura_produto
  UNION ALL SELECT 3 AS item, 'saldo_estoque' AS estrutura_produto
) d
-- prova de não copiar (ADR 0006, 1) de GETPSALDO: cada item da lista fixa do tipo de saldo da origem tem a estrutura
-- equivalente no produto (1 próprio = saldo_estoque, 2 consignado = saldo_consignado, 3 = saldo próprio por estimativa,
-- ADR 0007, 18: a origem guarda 3 itens e o produto separa só próprio e consignado). Item novo ou removido na origem:
-- prova_nao_conferida (alta), visível. Teste: conector/testes/test_l7_06.py.
