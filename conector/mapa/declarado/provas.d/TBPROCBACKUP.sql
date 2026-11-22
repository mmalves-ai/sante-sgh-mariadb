SELECT id, id AS codigo, rotulo FROM (
SELECT 1 AS id, 'Cópia' AS rotulo
UNION ALL SELECT 2 AS id, 'Restauração' AS rotulo
) equivalencia
