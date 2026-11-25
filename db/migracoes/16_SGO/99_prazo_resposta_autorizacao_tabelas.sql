-- Operadora, prazos regulatórios da resposta ao pedido de autorização (F7, 08-SGO linha 103, C2-122, 25/11/2026): só
-- para frente e idempotente (ADR 0002, parte 2). O prazo que o domínio dava por parâmetro no código passa a ser lido de
-- prazo_atendimento_regulatorio (linha vigente pelo código): estas linhas são as unidades de prazo do cálculo, as normas
-- da ANS que fixam os prazos (RN 395, resposta ao pedido; RN 566, garantia de atendimento) e os prazos de cada uma. A
-- operadora ajusta encerrando a vigência e incluindo outra linha. Sem gatilho; nenhuma coluna nova.
INSERT INTO unidade_prazo (codigo, descricao, unidade_base, quantidade_base, aplica_contrato, ativo, criado_em)
SELECT x.codigo, x.descricao, x.base, 1, TRUE, TRUE, NOW(3)
  FROM (SELECT 'hora' AS codigo, 'Horas' AS descricao, 'hora' AS base
        UNION ALL SELECT 'dia', 'Dias corridos', 'dia'
        UNION ALL SELECT 'dia_util', 'Dias úteis', 'dia_util') x
 WHERE NOT EXISTS (SELECT 1 FROM unidade_prazo u WHERE u.codigo = x.codigo);

INSERT INTO norma_regulatoria (codigo, descricao, ativo, tipo_norma, numero, criado_em)
SELECT x.codigo, x.descricao, TRUE, 'resolucao_normativa', x.numero, NOW(3)
  FROM (SELECT 'rn_395' AS codigo, 'Atendimento ao beneficiário: protocolo, resposta e negativa de cobertura' AS descricao, 'RN 395' AS numero
        UNION ALL SELECT 'rn_566', 'Garantia de atendimento: prazos máximos', 'RN 566') x
 WHERE NOT EXISTS (SELECT 1 FROM norma_regulatoria n WHERE n.codigo = x.codigo)
   AND NOT EXISTS (SELECT 1 FROM norma_regulatoria n WHERE n.tipo_norma = 'resolucao_normativa' AND n.numero = x.numero);

INSERT INTO prazo_atendimento_regulatorio
       (codigo, descricao, tipo_pedido, carater, norma_regulatoria_id, prazo, unidade_prazo_id, padrao, vigencia_inicio, ativo, criado_em)
SELECT x.codigo, x.descricao, x.tipo, 'eletivo', n.id, x.prazo, u.id, x.padrao, '2016-01-01', TRUE, NOW(3)
  FROM (SELECT 'resposta_padrao' AS codigo, 'Resposta ao pedido eletivo' AS descricao, 'resposta_conclusiva' AS tipo, 5 AS prazo, 'dia_util' AS unidade, 'RN 395' AS norma, TRUE AS padrao
        UNION ALL SELECT 'resposta_complexa', 'Resposta ao pedido de alta complexidade ou internação eletiva', 'resposta_conclusiva', 10, 'dia_util', 'RN 395', FALSE
        UNION ALL SELECT 'consulta_basica', 'Consulta básica (pediatria, clínica médica, cirurgia geral, ginecologia e obstetrícia)', 'consulta_basica', 7, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'consulta_especializada', 'Consulta nas demais especialidades', 'consulta_especializada', 14, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'sessao_terapia', 'Sessão com fonoaudiólogo, nutricionista, psicólogo, terapeuta ocupacional ou fisioterapeuta', 'sessao_terapia', 10, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'sadt_laboratorio', 'Serviço de diagnóstico por laboratório de análises clínicas em regime ambulatorial', 'sadt_ambulatorial', 3, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'sadt_demais', 'Demais serviços de diagnóstico e terapia em regime ambulatorial', 'sadt_ambulatorial', 10, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'alta_complexidade', 'Procedimento de alta complexidade', 'alta_complexidade', 21, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'internacao_eletiva', 'Internação eletiva', 'internacao_eletiva', 21, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'hospital_dia', 'Atendimento em regime de hospital-dia', 'hospital_dia', 10, 'dia_util', 'RN 566', FALSE
        UNION ALL SELECT 'resposta_reembolso', 'Reembolso nos limites do contrato', 'reembolso', 30, 'dia', 'RN 566', FALSE) x
  JOIN unidade_prazo u ON u.codigo = x.unidade
  JOIN norma_regulatoria n ON n.tipo_norma = 'resolucao_normativa' AND n.numero = x.norma
 WHERE NOT EXISTS (SELECT 1 FROM prazo_atendimento_regulatorio p WHERE p.codigo = x.codigo);
