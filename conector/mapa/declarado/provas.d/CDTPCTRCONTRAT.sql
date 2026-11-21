SELECT d.item, d.item, d.rotulo FROM (
  SELECT 1 AS item, '1' AS valor_produto, 'Com patrocínio' AS rotulo
  UNION ALL SELECT 2 AS item, '0' AS valor_produto, 'Sem patrocínio' AS rotulo
) d
-- prova de não copiar (ADR 0006, 1) de CDTPCTRCONTRAT: cada item da lista fixa da origem, por código E rótulo (NOME), tem o valor
-- equivalente no domínio do produto (tipo_contrato_plano.patrocinado, com ou sem patrocínio). A conferência do domínio contra o CHECK do modelo está em
-- conector/testes/test_l8_13.py. Item novo ou removido, ou rótulo trocado no mesmo código: prova_nao_conferida (alta), visível.
