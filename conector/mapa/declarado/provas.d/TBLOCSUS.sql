SELECT DISTINCT CAST(codigo_sigtap AS SIGNED) AS cod, CAST(codigo_sigtap AS SIGNED) AS cod_valor
FROM dominio_sigtap
WHERE lista = 'modalidade' AND vigencia_fim IS NULL
-- prova de conciliação (ADR 0006, 4) de TBLOCSUS: a lista oficial de modalidade (tabela unificada) tem os mesmos
-- códigos da origem, código local ou antigo falta aqui e a prova falha (prova_nao_conferida, alta)
