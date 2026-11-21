SELECT e.id, e.id AS codigo, e.rotulo FROM (
SELECT 1 AS id, 'Política' AS rotulo, 'politica' AS dominio
UNION ALL SELECT 2 AS id, 'CPF' AS rotulo, 'cpf' AS dominio
UNION ALL SELECT 3 AS id, 'CNPJ' AS rotulo, 'cnpj' AS dominio
UNION ALL SELECT 4 AS id, 'Nome' AS rotulo, 'nome' AS dominio
UNION ALL SELECT 5 AS id, 'Data de nascimento' AS rotulo, 'data_nascimento' AS dominio
UNION ALL SELECT 6 AS id, 'Título de eleitor' AS rotulo, 'titulo_eleitor' AS dominio
UNION ALL SELECT 7 AS id, 'Registro no conselho' AS rotulo, 'registro_conselho' AS dominio
UNION ALL SELECT 8 AS id, 'UF do conselho' AS rotulo, 'uf_conselho' AS dominio
UNION ALL SELECT 9 AS id, 'Especialidade' AS rotulo, 'especialidade' AS dominio
UNION ALL SELECT 10 AS id, 'CNES' AS rotulo, 'cnes' AS dominio
) e
WHERE EXISTS (SELECT 1 FROM information_schema.CHECK_CONSTRAINTS c
               WHERE c.CONSTRAINT_SCHEMA = DATABASE() AND c.TABLE_NAME = 'oid_icp'
                 AND c.CONSTRAINT_NAME = 'ck_oid_icp_tipo'
                 AND LOCATE(CONCAT('''', e.dominio, ''''), c.CHECK_CLAUSE) > 0)
