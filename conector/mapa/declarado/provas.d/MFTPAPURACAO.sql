SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'por_pagamento' AS valor_produto, 'Pagamento' AS rotulo
  UNION ALL SELECT 2 AS item, 'por_operacao' AS valor_produto, 'Emissão' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de MFTPAPURACAO: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (tributo.forma_apuracao, forma de apuração). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_10.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
