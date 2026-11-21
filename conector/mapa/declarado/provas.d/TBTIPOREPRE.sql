SELECT e.id, e.id AS codigo, e.rotulo FROM (
SELECT 1 AS id, 'Titular' AS rotulo, 'paciente' AS dominio
UNION ALL SELECT 2 AS id, 'Representante legal' AS rotulo, 'representante_legal' AS dominio
) e
WHERE EXISTS (SELECT 1 FROM information_schema.CHECK_CONSTRAINTS c
               WHERE c.CONSTRAINT_SCHEMA = DATABASE() AND c.TABLE_NAME = 'consentimento_titular'
                 AND c.CONSTRAINT_NAME = 'ck_consentimento_titular_tipo_signatario'
                 AND LOCATE(CONCAT('''', e.dominio, ''''), c.CHECK_CLAUSE) > 0)
