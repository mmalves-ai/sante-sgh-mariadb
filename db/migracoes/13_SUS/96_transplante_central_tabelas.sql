-- Transplante para a central estadual (C2-014, 06-SUS linha 65, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; as regras ficam no domínio (dominio-faturamento, sus/transplante.ts).
-- O hospital inscreve o receptor antes de a central devolver o número da inscrição: o número passa a ser opcional e é
-- digitado quando a central o devolve (a chave única por estabelecimento, órgão e número continua valendo para os
-- números preenchidos).
-- Os órgãos e tecidos da lista do Sistema Nacional de Transplantes entram no cadastro comum quando ainda não existem
-- (pelo código); o cliente pode desativar o que não usa.
ALTER TABLE inscricao_transplante
  MODIFY COLUMN numero_inscricao_central VARCHAR(30) NULL COMMENT 'Registro na central estadual de transplantes, digitado quando a central devolve';

INSERT INTO orgao_transplante (codigo, descricao, sigla, tipo, criado_em)
SELECT s.codigo, s.descricao, s.sigla, s.tipo, NOW(3)
  FROM (
    SELECT 'rim' AS codigo, 'Rim' AS descricao, 'RIM' AS sigla, 'orgao' AS tipo
    UNION ALL SELECT 'figado', 'Fígado', 'FIG', 'orgao'
    UNION ALL SELECT 'coracao', 'Coração', 'COR', 'orgao'
    UNION ALL SELECT 'pulmao', 'Pulmão', 'PUL', 'orgao'
    UNION ALL SELECT 'pancreas', 'Pâncreas', 'PAN', 'orgao'
    UNION ALL SELECT 'intestino', 'Intestino', 'INT', 'orgao'
    UNION ALL SELECT 'cornea', 'Córnea', 'CRN', 'tecido'
    UNION ALL SELECT 'pele', 'Pele', 'PEL', 'tecido'
    UNION ALL SELECT 'osso', 'Tecido ósseo', 'OSS', 'tecido'
    UNION ALL SELECT 'valvula_cardiaca', 'Válvula cardíaca', 'VAL', 'tecido'
  ) s
 WHERE NOT EXISTS (SELECT 1 FROM orgao_transplante o WHERE o.codigo = s.codigo);
