SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'cumulativo' AS valor_produto, 'Cumulativo' AS rotulo
  UNION ALL SELECT 2 AS item, 'nao_cumulativo' AS valor_produto, 'Não cumulativo' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de SDNATRECEITA: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (apuracao_pis_cofins.regime, regime do PIS/COFINS). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_10.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
