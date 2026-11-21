SELECT e.id, e.id AS codigo, e.rotulo FROM (
SELECT 1 AS id, 'Não' AS rotulo, 'oculto' AS dominio
UNION ALL SELECT 2 AS id, 'Sim' AS rotulo, 'opcional' AS dominio
UNION ALL SELECT 3 AS id, 'Obrigatório' AS rotulo, 'obrigatorio' AS dominio
UNION ALL SELECT 4 AS id, 'Obrig.atend.SUS' AS rotulo, 'obrigatorio' AS dominio
) e
WHERE EXISTS (SELECT 1 FROM information_schema.CHECK_CONSTRAINTS c
               WHERE c.CONSTRAINT_SCHEMA = DATABASE() AND c.TABLE_NAME = 'regra_campo_cadastro'
                 AND c.CONSTRAINT_NAME = 'ck_regra_campo_cadastro_exigencia'
                 AND LOCATE(CONCAT('''', e.dominio, ''''), c.CHECK_CLAUSE) > 0)
  AND (e.id IN (1, 2, 3)
       OR NOT EXISTS (SELECT 1 FROM regra_campo_cadastro r
                       JOIN {ctl}.conector_origem co ON co.entidade_destino = 'regra_campo_cadastro'
                        AND co.id_destino = r.id AND co.tabela_origem = 'ATPARAMGERAL' AND co.excluido_em IS NULL
                      WHERE r.campo = 'cns'))
