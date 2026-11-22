SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, '1' AS valor_produto, 'Linha 1' AS rotulo
  UNION ALL SELECT 2 AS item, '2' AS valor_produto, 'Linha 2' AS rotulo
  UNION ALL SELECT 3 AS item, '3' AS valor_produto, 'Linha 3' AS rotulo
  UNION ALL SELECT 4 AS item, '4' AS valor_produto, 'Linha 4' AS rotulo
  UNION ALL SELECT 5 AS item, '5' AS valor_produto, 'Linha 5' AS rotulo
  UNION ALL SELECT 6 AS item, '6' AS valor_produto, 'Linha 6' AS rotulo
  UNION ALL SELECT 7 AS item, '7' AS valor_produto, 'Linha 7' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de CDMSGLINHA: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (mensagem_cobranca.numero_linha, posição = número da linha da mensagem, 1 a 7). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_13.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
