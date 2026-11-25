# Orçamento: f3-integrar

estimativa_M: 20
teto_M: 26

- **Por quê:** a rodada f3-fechar (24/11 21h10) parou às 23h40 pelo limite de uso do modelo em que os agentes
  rodavam: 204 chamadas recusadas, 8 dos 9 integradores entre elas. Ficaram 53 funções com resultado (25 prontas, só
  com o E2E por rodar) e 131 mudanças sem commit na árvore (cópia em `sante-sgh-dados/obra/pausa-20261125-limite/`).
- **Agentes:** 6 integradores (F3.1 para os 15 E2E vermelhos; F3.2, F3.5, F3.6, F3.8 e F3.9 para rodar os E2E das
  prontas, aplicar as situações na ficha e reconta) × 3 M + 1 conferidor das sobras sem commit fora desses marcos ×
  2 M ≈ 20 M; teto 26 M.
