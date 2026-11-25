-- SUP, lote 97 (05-SUP linha 7, construir-2 C2-009): a grade de horários padrão é UMA só, a do aprazamento
-- (horario_padrao_dose: por grade de horário da unidade, nula = o estabelecimento, e por número de doses ao dia). A
-- farmácia passa a gravar nela; horario_padrao_medicacao deixa de ser lida e gravada e fica só como histórico (nada se
-- apaga). Só para frente e idempotente. Sem gatilho e sem regra no banco.
--
-- Copia para a grade do estabelecimento (grade_horario_unidade_id nulo) as grades ativas de horario_padrao_medicacao
-- que ainda não têm a correspondente, quando a frequência dá o número de doses ao dia (o declarado ou o intervalo que
-- fecha o dia) e a grade está completa (um horário por dose). Duas frequências com o mesmo número de doses no mesmo
-- estabelecimento: vale a de menor id.
--
-- NÃO copia, e abre uma pendência de migração (tabela pendencia, tipo 'migracao', uma por grade antiga) para a
-- farmácia revisar em /farmacia/parametros:
--   * a grade de um SETOR: o aprazamento escolhe a grade pelo bloco, pela unidade ou pela do estabelecimento, nunca só
--     pelo setor; copiada para uma grade só de setor ela ficaria sem efeito, e copiada para a do estabelecimento
--     mudaria o horário dos outros setores;
--   * a grade com algum horário restrito a dias da semana: a grade unificada é diária (o recorte por dia fica com a
--     frequência); copiá-la como diária mudaria o sentido do horário.

CREATE TEMPORARY TABLE tmp_grade_padrao_unificada AS
SELECT h.estabelecimento_id, h.frequencia_administracao_id, h.setor_funcional_id,
       COALESCE(NULLIF(MIN(f.doses_por_dia), 0),
                CASE WHEN MIN(f.intervalo_minutos) > 0 AND MOD(1440, MIN(f.intervalo_minutos)) = 0
                     THEN 1440 DIV MIN(f.intervalo_minutos) END) AS doses,
       COUNT(*) AS n, MAX(h.ordem_dose) AS maior, MIN(h.id) AS primeiro,
       SUM(h.dias_semana IS NOT NULL AND TRIM(h.dias_semana) <> '') AS restritos
  FROM horario_padrao_medicacao h
  JOIN frequencia_administracao f ON f.id = h.frequencia_administracao_id
 WHERE h.ativo
 GROUP BY h.estabelecimento_id, h.frequencia_administracao_id, h.setor_funcional_id;

-- As grades que não têm como entrar sem mudar de sentido ficam como pendência (uma vez só por grade antiga).
INSERT INTO pendencia (estabelecimento_id, tipo, entidade, entidade_id, descricao, situacao, critica, criado_em,
                       criado_por, versao)
SELECT t.estabelecimento_id, 'migracao', 'horario_padrao_medicacao', t.primeiro,
       CASE WHEN t.setor_funcional_id IS NOT NULL
            THEN 'Grade de horário padrão de um setor não migrada: o aprazamento usa a grade da unidade ou do bloco. Grave-a na grade da unidade em Farmácia > Parâmetros.'
            ELSE 'Grade de horário padrão com horários restritos a dias da semana não migrada: a grade padrão é diária. Revise-a em Farmácia > Parâmetros.'
       END,
       'aberta', FALSE, NOW(3), NULL, 1
  FROM tmp_grade_padrao_unificada t
 WHERE (t.setor_funcional_id IS NOT NULL OR t.restritos > 0)
   AND NOT EXISTS (SELECT 1 FROM pendencia p
                    WHERE p.tipo = 'migracao' AND p.entidade = 'horario_padrao_medicacao'
                      AND p.entidade_id = t.primeiro);

DELETE FROM tmp_grade_padrao_unificada
 WHERE setor_funcional_id IS NOT NULL OR restritos > 0
    OR doses IS NULL OR doses NOT BETWEEN 1 AND 48 OR n <> doses OR maior <> doses;

-- Uma frequência por estabelecimento e número de doses (a de menor id).
CREATE TEMPORARY TABLE tmp_grade_padrao_unificada_escolha AS
SELECT estabelecimento_id, doses, MIN(frequencia_administracao_id) AS frequencia_administracao_id
  FROM tmp_grade_padrao_unificada
 GROUP BY estabelecimento_id, doses;

INSERT INTO horario_padrao_dose
       (estabelecimento_id, grade_horario_unidade_id, doses_por_dia, ordem_dose, horario, ativo, criado_em, criado_por,
        versao)
SELECT h.estabelecimento_id, NULL, t.doses, h.ordem_dose, h.horario, TRUE, NOW(3), NULL, 1
  FROM tmp_grade_padrao_unificada t
  JOIN tmp_grade_padrao_unificada_escolha e
    ON e.estabelecimento_id = t.estabelecimento_id AND e.doses = t.doses
   AND e.frequencia_administracao_id = t.frequencia_administracao_id
  JOIN horario_padrao_medicacao h
    ON h.estabelecimento_id = t.estabelecimento_id AND h.frequencia_administracao_id = t.frequencia_administracao_id
   AND h.setor_funcional_id IS NULL AND h.ativo
 WHERE NOT EXISTS (SELECT 1 FROM horario_padrao_dose d
                    WHERE d.estabelecimento_id = t.estabelecimento_id AND d.grade_horario_unidade_id IS NULL
                      AND d.doses_por_dia = t.doses);

DROP TEMPORARY TABLE tmp_grade_padrao_unificada_escolha;
DROP TEMPORARY TABLE tmp_grade_padrao_unificada;

ALTER TABLE horario_padrao_medicacao
  COMMENT = 'Histórico: horários padrão por frequência gravados até a grade unificada (05-SUP linha 7); a grade lida e gravada é horario_padrao_dose';
