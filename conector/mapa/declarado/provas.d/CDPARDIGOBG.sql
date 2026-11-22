SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'todos' AS valor_produto, 'Todos' AS rotulo
  UNION ALL SELECT 2 AS item, 'nenhum' AS valor_produto, 'Nenhum' AS rotulo
  UNION ALL SELECT 3 AS item, 'so_titular' AS valor_produto, 'Só titular' AS rotulo
  UNION ALL SELECT 4 AS item, 'so_dependente' AS valor_produto, 'Só dependente' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de CDPARDIGOBG: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (documento_emitido_operadora.exigencia_campos, obrigatoriedade de campo). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_13.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
