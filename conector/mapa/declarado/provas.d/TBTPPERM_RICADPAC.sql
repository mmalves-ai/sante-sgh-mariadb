SELECT e.id, e.id AS codigo, e.rotulo FROM (
SELECT 1 AS id, 'Restrito' AS rotulo, 'restrito' AS dominio
UNION ALL SELECT 2 AS id, 'Consentido' AS rotulo, 'consentido' AS dominio
) e
WHERE EXISTS (SELECT 1 FROM information_schema.CHECK_CONSTRAINTS c
               WHERE c.CONSTRAINT_SCHEMA = DATABASE() AND c.TABLE_NAME = 'restricao_prontuario'
                 AND c.CONSTRAINT_NAME = 'ck_restricao_prontuario_modo'
                 AND LOCATE(CONCAT('''', e.dominio, ''''), c.CHECK_CLAUSE) > 0)
