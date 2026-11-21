SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'possui' AS valor_produto, 'Beneficiário com NIF' AS rotulo
  UNION ALL SELECT 2 AS item, 'dispensado' AS valor_produto, 'Beneficiário dispensado do NIF' AS rotulo
  UNION ALL SELECT 3 AS item, 'pais_nao_exige' AS valor_produto, 'País não exige NIF' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de TBINDNIF: cada item da lista fixa da origem, por código E rótulo (DESCRICAO), tem o valor
-- equivalente no domínio do produto (beneficiario_exterior.indicador_nif, indicador do NIF no exterior, tabela indNIF da EFD-Reinf). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_11.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
