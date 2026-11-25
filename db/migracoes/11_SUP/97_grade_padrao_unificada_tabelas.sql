-- SUP, lote 97 (05-SUP linha 7, construir-2 C2-009): a grade de horários padrão é UMA só, a do aprazamento
-- (horario_padrao_dose: por grade de horário da unidade, nula = o estabelecimento, e por número de doses ao dia). A
-- farmácia passa a gravar nela; horario_padrao_medicacao deixa de ser lida e gravada e fica só como histórico (nada se
-- apaga). Só para frente e idempotente: copia as grades ativas de horario_padrao_medicacao que ainda não têm a grade
-- correspondente, quando a frequência dá o número de doses ao dia (o declarado ou o intervalo que fecha o dia), a
-- grade está completa (um horário por dose) e, com setor, existe a grade de horário do setor (sem unidade nem bloco).
-- Duas frequências com o mesmo número de doses no mesmo escopo: vale a de menor id. Sem gatilho e sem regra no banco.

CREATE TEMPORARY TABLE tmp_grade_padrao_unificada AS
SELECT x.estabelecimento_id, x.frequencia_administracao_id, x.setor_funcional_id, x.doses, x.n, x.maior,
       (SELECT MIN(gu.id) FROM grade_horario_unidade gu
         WHERE gu.estabelecimento_id = x.estabelecimento_id AND gu.setor_funcional_id = x.setor_funcional_id
           AND gu.unidade_internacao_id IS NULL AND gu.bloco_internacao_id IS NULL AND gu.ativo) AS grade
  FROM (SELECT h.estabelecimento_id, h.frequencia_administracao_id, h.setor_funcional_id,
               COALESCE(NULLIF(MIN(f.doses_por_dia), 0),
                        CASE WHEN MIN(f.intervalo_minutos) > 0 AND MOD(1440, MIN(f.intervalo_minutos)) = 0
                             THEN 1440 DIV MIN(f.intervalo_minutos) END) AS doses,
               COUNT(*) AS n, MAX(h.ordem_dose) AS maior
          FROM horario_padrao_medicacao h
          JOIN frequencia_administracao f ON f.id = h.frequencia_administracao_id
         WHERE h.ativo
         GROUP BY h.estabelecimento_id, h.frequencia_administracao_id, h.setor_funcional_id) x;

DELETE FROM tmp_grade_padrao_unificada
 WHERE doses IS NULL OR doses NOT BETWEEN 1 AND 48 OR n <> doses OR maior <> doses
    OR (setor_funcional_id IS NOT NULL AND grade IS NULL);

-- Uma frequência por escopo e número de doses (a de menor id).
CREATE TEMPORARY TABLE tmp_grade_padrao_unificada_escolha AS
SELECT estabelecimento_id, grade, doses, MIN(frequencia_administracao_id) AS frequencia_administracao_id
  FROM tmp_grade_padrao_unificada
 GROUP BY estabelecimento_id, grade, doses;

INSERT INTO horario_padrao_dose
       (estabelecimento_id, grade_horario_unidade_id, doses_por_dia, ordem_dose, horario, ativo, criado_em, criado_por,
        versao)
SELECT h.estabelecimento_id, t.grade, t.doses, h.ordem_dose, h.horario, TRUE, NOW(3), NULL, 1
  FROM tmp_grade_padrao_unificada t
  JOIN tmp_grade_padrao_unificada_escolha e
    ON e.estabelecimento_id = t.estabelecimento_id AND e.grade <=> t.grade AND e.doses = t.doses
   AND e.frequencia_administracao_id = t.frequencia_administracao_id
  JOIN horario_padrao_medicacao h
    ON h.estabelecimento_id = t.estabelecimento_id AND h.frequencia_administracao_id = t.frequencia_administracao_id
   AND h.setor_funcional_id <=> t.setor_funcional_id AND h.ativo
 WHERE NOT EXISTS (SELECT 1 FROM horario_padrao_dose d
                    WHERE d.estabelecimento_id = t.estabelecimento_id AND d.grade_horario_unidade_id <=> t.grade
                      AND d.doses_por_dia = t.doses);

DROP TEMPORARY TABLE tmp_grade_padrao_unificada_escolha;
DROP TEMPORARY TABLE tmp_grade_padrao_unificada;

ALTER TABLE horario_padrao_medicacao
  COMMENT = 'Histórico: horários padrão por frequência gravados até a grade unificada (05-SUP linha 7); a grade lida e gravada é horario_padrao_dose';
