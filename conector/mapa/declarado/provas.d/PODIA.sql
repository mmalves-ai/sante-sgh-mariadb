SELECT d.id, d.id, d.rotulo FROM (
  SELECT 1 AS id, 'Domingo' AS rotulo, 'domingo' AS valor_produto
  UNION ALL SELECT 2 AS id, 'Segunda' AS rotulo, 'segunda' AS valor_produto
  UNION ALL SELECT 3 AS id, 'Terça' AS rotulo, 'terca' AS valor_produto
  UNION ALL SELECT 4 AS id, 'Quarta' AS rotulo, 'quarta' AS valor_produto
  UNION ALL SELECT 5 AS id, 'Quinta' AS rotulo, 'quinta' AS valor_produto
  UNION ALL SELECT 6 AS id, 'Sexta' AS rotulo, 'sexta' AS valor_produto
  UNION ALL SELECT 7 AS id, 'Sábado' AS rotulo, 'sabado' AS valor_produto
  UNION ALL SELECT 8 AS id, 'Feriado' AS rotulo, 'feriado' AS valor_produto
) d
-- prova de não copiar (ADR 0006, 1) de PODIA (L5-11): lista fixa do sistema de origem, conferida linha a linha por
-- código E rótulo contra a lista conhecida, cada item tem o valor equivalente no domínio fixo do produto:
-- dia da jornada (horario_jornada.dia) (CHECK ck_horario_jornada_dia, a pertinência ao CHECK está nos testes da fatia). Rótulos: melhor estimativa pelo
-- significado (ADR 0007, 18), a 1.ª carga real confirma: item novo, faltando ou rótulo diferente na origem =
-- prova_nao_conferida (alta), visível, e o SQL é corrigido com a tradução certa.
