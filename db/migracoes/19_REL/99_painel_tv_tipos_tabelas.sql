-- Painéis de TV operacionais (01-REL L116): só para frente e idempotente (ADR 0002, parte 2).
-- Semeia o catálogo de tipos de painel de TV com as quatro fontes operacionais e a chamada. O componente é a fonte de
-- dados que os blocos do painel leem (painel-tv-propria.ts); a tela da TV mostra só iniciais, número ou senha (LGPD).
INSERT INTO tipo_painel_tv (codigo, descricao, categoria, componente, atualizacao_padrao_segundos, ativo, criado_em)
SELECT n.codigo, n.descricao, n.categoria, n.componente, n.atualizacao, TRUE, NOW(3)
  FROM (
    SELECT 'uti' AS codigo, 'Ocupação da terapia intensiva' AS descricao, 'ocupacao_leitos' AS categoria, 'uti' AS componente, 60 AS atualizacao
    UNION ALL SELECT 'farmacia', 'Fila da farmácia (dispensações a separar e entregar)', 'farmacia', 'farmacia', 30
    UNION ALL SELECT 'mapa_cirurgico', 'Mapa cirúrgico do dia', 'mapa_cirurgico', 'mapa_cirurgico', 60
    UNION ALL SELECT 'laboratorio', 'Laboratório: pedidos em aberto e atrasos', 'laboratorio', 'laboratorio', 60
    UNION ALL SELECT 'chamada', 'Chamada de pacientes por senha', 'chamada', 'chamada', 10
  ) n
 WHERE NOT EXISTS (SELECT 1 FROM tipo_painel_tv t WHERE t.codigo = n.codigo);
