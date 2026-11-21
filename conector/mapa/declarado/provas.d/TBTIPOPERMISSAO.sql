SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, 'sempre' AS valor_produto, 'Sempre' AS rotulo
  UNION ALL SELECT 2 AS item, 'so_bloqueio' AS valor_produto, 'Só no bloqueio' AS rotulo
  UNION ALL SELECT 3 AS item, 'so_desbloqueio' AS valor_produto, 'Só no desbloqueio' AS rotulo
  UNION ALL SELECT 4 AS item, 'nunca' AS valor_produto, 'Nunca' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de TBTIPOPERMISSAO: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (regra_bloqueio_periodo_contabil.exigencia_senha, permissão em período fechado). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_12.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
