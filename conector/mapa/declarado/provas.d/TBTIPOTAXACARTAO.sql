SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'percentual' AS valor_produto, 'Percentual' AS rotulo
  UNION ALL SELECT 2 AS item, 'valor_fixo' AS valor_produto, 'Valor fixo' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de TBTIPOTAXACARTAO: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (taxa_administradora.tipo_taxa, tipo da taxa). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_12.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
