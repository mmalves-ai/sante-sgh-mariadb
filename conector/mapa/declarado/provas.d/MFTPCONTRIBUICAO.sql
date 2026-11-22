SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'contribuicao_sindical' AS valor_produto, 'Contribuição sindical compulsória' AS rotulo
  UNION ALL SELECT 2 AS item, 'contribuicao_sindical' AS valor_produto, 'Contribuição associativa' AS rotulo
  UNION ALL SELECT 3 AS item, 'contribuicao_sindical' AS valor_produto, 'Contribuição assistencial' AS rotulo
  UNION ALL SELECT 4 AS item, 'contribuicao_sindical' AS valor_produto, 'Contribuição confederativa' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de MFTPCONTRIBUICAO: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (tributo_folha.tipo, tributo contribuicao_sindical, o TIPO da contribuição é o do eSocial S-1300 tpContribSind 1 a 4, comparado pelo rótulo, domínio próprio pedido r5-6). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_10.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
