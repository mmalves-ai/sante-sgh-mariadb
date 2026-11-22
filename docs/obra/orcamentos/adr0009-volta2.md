# Orçamento: adr0009-volta2

estimativa_M: 17
teto_M: 23

- **Objetivo:** fechar as 10 pendências da conferência do ADR 0009
  (`docs/obra/fatias/adr0009/saida/conferencia.md`) antes da carga da ProntoCardio. Três delas são críticas:
  - preço particular por médico da origem não carregado;
  - vigência das regras extraídas na data da carga (fere a decisão 16);
  - repasse integral não carregado.
- **Agentes por papel:**
  - compartilhado (DDL do alvo de exame e nomes nos contratos): 1 × 2,5 M;
  - construtores de conector, domínio e API, e telas: 3 × 2 M;
  - revisores: 3 × 0,35 M;
  - corretores: até 3 × 1 M;
  - conferidor: 1 × 2 M.
  - Soma 14,5 M × 1,2 = **17 M**; teto 30% acima = **23 M**.

## Andamento
- **22/11, 3h40 a 5h10:** uma queda de rede derrubou 3 agentes: o construtor do conector, o corretor do domínio e o
  conferidor. O trabalho parcial ficou no disco, sem commit, em 19 arquivos.
  - Gasto até a queda: cerca de 8,5 M.
  - A sobra vai para um script novo (`adr0009-volta2-fim`, com este mesmo orçamento): continuar o conector e o
    domínio a partir do parcial, revisão dos dois, corretor e conferidor. Agente sem resultado por falha de API é
    repetido uma vez.
