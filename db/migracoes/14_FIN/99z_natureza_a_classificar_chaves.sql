-- Recusas da carga (fase 2, K2, C9): natureza financeira nativa 'a classificar', para o título migrado sem rateio na
-- origem (títulos a pagar e a receber migrados sem rateio) entrar vivo, com pendência visível, em vez de ser recusado pelo NOT NULL. O
-- hospital reclassifica depois. 'a_classificar' é de despesa (título a pagar) e 'a_classificar_receita' de receita
-- (título a receber), cada uma no seu subgrupo, sob o grupo 'a_classificar'. Fora do custo e do REINF.
-- Semente idempotente e válida em qualquer ordem (ADR 0002): só inclui o que falta.
INSERT INTO grupo_natureza_financeira (codigo, nome, tipo, classificacao, compoe_custo, ordem_exibicao, ativo, origem, criado_em)
  SELECT 'a_classificar', 'A classificar', 'ambos', 'operacional', FALSE, 999, TRUE, 'sistema', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM grupo_natureza_financeira WHERE codigo = 'a_classificar');
INSERT INTO subgrupo_natureza_financeira (grupo_natureza_financeira_id, codigo, descricao, classificacao, compoe_custo, ativo, origem, criado_em)
  SELECT g.id, x.codigo, x.descricao, x.classificacao, FALSE, TRUE, 'sistema', UTC_TIMESTAMP(3)
  FROM grupo_natureza_financeira g
  JOIN (SELECT 'a_classificar_despesa' AS codigo, 'Despesa a classificar' AS descricao, 'despesa' AS classificacao
        UNION ALL SELECT 'a_classificar_receita', 'Receita a classificar', 'receita') x
  WHERE g.codigo = 'a_classificar'
    AND NOT EXISTS (SELECT 1 FROM subgrupo_natureza_financeira s WHERE s.grupo_natureza_financeira_id = g.id AND s.codigo = x.codigo);
INSERT INTO natureza_financeira (codigo, descricao, descricao_relatorio, subgrupo_natureza_financeira_id, tipo, receita_operacional,
  informa_reinf, integra_custo, provisiona, ativo, origem, criado_em)
  SELECT x.codigo, x.descricao, 'A classificar', s.id, x.tipo, TRUE, FALSE, FALSE, FALSE, TRUE, 'sistema', UTC_TIMESTAMP(3)
  FROM (SELECT 'a_classificar' AS codigo, 'Despesa a classificar (título migrado sem natureza na origem)' AS descricao,
               'despesa' AS tipo, 'a_classificar_despesa' AS subgrupo
        UNION ALL SELECT 'a_classificar_receita', 'Receita a classificar (título migrado sem natureza na origem)', 'receita',
               'a_classificar_receita') x
  JOIN grupo_natureza_financeira g ON g.codigo = 'a_classificar'
  JOIN subgrupo_natureza_financeira s ON s.grupo_natureza_financeira_id = g.id AND s.codigo = x.subgrupo
  WHERE NOT EXISTS (SELECT 1 FROM natureza_financeira n WHERE n.codigo = x.codigo);
