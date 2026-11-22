SELECT d.id, d.id, d.rotulo FROM (
  SELECT 1 AS id, 'Atendimento' AS rotulo, 'atendimento' AS valor_produto
  UNION ALL SELECT 2 AS id, 'Marcação' AS rotulo, 'marcacao' AS valor_produto
) d
-- prova de não copiar (ADR 0006, 1) de TBMOTCANCTP (L6-01): lista fixa do sistema de origem, conferida linha a linha por
-- código E rótulo contra a lista conhecida, cada item tem o valor equivalente no domínio fixo do produto:
-- operação do escopo do motivo de cancelamento (motivo_cancelamento_operacao_escopo.operacao) (CHECK ck_motivo_cancelamento_operacao_escopo_operacao, a pertinência ao CHECK está nos testes da fatia). Rótulos: melhor estimativa pelo
-- significado (ADR 0007, 18), a 1.ª carga real confirma: item novo, faltando ou rótulo diferente na origem =
-- prova_nao_conferida (alta), visível, e o SQL é corrigido com a tradução certa.
