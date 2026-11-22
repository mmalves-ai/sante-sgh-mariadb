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
