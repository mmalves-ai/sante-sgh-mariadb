SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'debito' AS valor_produto, 'Débito' AS rotulo
  UNION ALL SELECT 2 AS item, 'credito' AS valor_produto, 'Crédito' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de TBTIPOCARTAO: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (taxa_administradora.modalidade, modalidade do cartão). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_12.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
