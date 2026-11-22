SELECT d.item, d.item FROM (
  SELECT 1 AS item, 'comercial' AS valor_produto
  UNION ALL SELECT 2 AS item, 'plantao_24h' AS valor_produto
) d
-- prova de não copiar (ADR 0006, 1) de TBDISPON: cada item da lista fixa de disponibilidade do fornecedor tem o valor
-- equivalente no domínio do produto (empresa_fornecedora.disponibilidade, CHECK comercial/plantao_24h/sob_demanda).
-- A conferência do domínio contra o CHECK do modelo está em conector/testes/test_l7_06.py. Item novo ou removido na
-- origem: prova_nao_conferida (alta), visível.
