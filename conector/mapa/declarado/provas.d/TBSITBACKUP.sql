SELECT id, id AS codigo, rotulo FROM (
SELECT 1 AS id, 'Concluído' AS rotulo
UNION ALL SELECT 2 AS id, 'Falhou' AS rotulo
UNION ALL SELECT 3 AS id, 'Em andamento' AS rotulo
UNION ALL SELECT 4 AS id, 'Cancelada' AS rotulo
) equivalencia
