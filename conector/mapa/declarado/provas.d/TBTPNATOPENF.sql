SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'outra' AS valor_produto, 'Nenhum' AS rotulo
  UNION ALL SELECT 2 AS item, 'simples_remessa' AS valor_produto, 'Simples remessa' AS rotulo
  UNION ALL SELECT 3 AS item, 'venda' AS valor_produto, 'Venda' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de TBTPNATOPENF: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (natureza_operacao.finalidade, mesmo de-para da consumidora TBNATOPE.ID_TBTPNATOPENF, valores.d/L8-12.tsv). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_12.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
