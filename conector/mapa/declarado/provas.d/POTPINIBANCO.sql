SELECT d.id, d.id, d.rotulo FROM (
  SELECT 1 AS id, 'Admissão' AS rotulo, 'admissao' AS valor_produto
  UNION ALL SELECT 2 AS id, 'Data fixa' AS rotulo, 'data_fixa' AS valor_produto
  UNION ALL SELECT 3 AS id, 'Competência' AS rotulo, 'competencia' AS valor_produto
  UNION ALL SELECT 4 AS id, 'Adesão' AS rotulo, 'adesao' AS valor_produto
) d
-- prova de não copiar (ADR 0006, 1) de POTPINIBANCO (L5-11): lista fixa do sistema de origem, conferida linha a linha por
-- código E rótulo contra a lista conhecida, cada item tem o valor equivalente no domínio fixo do produto:
-- critério de início do banco de horas (regra_banco_horas.criterio_inicio) (CHECK ck_regra_banco_horas_criterio, a pertinência ao CHECK está nos testes da fatia). Rótulos: melhor estimativa pelo
-- significado (ADR 0007, 18), a 1.ª carga real confirma: item novo, faltando ou rótulo diferente na origem =
-- prova_nao_conferida (alta), visível, e o SQL é corrigido com a tradução certa.
