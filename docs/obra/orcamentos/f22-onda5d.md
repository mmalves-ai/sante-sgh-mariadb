# Orçamento: f22-onda5d

estimativa_M: 5
teto_M: 7

- **Objetivo e critério de pronto:** integrar a onda 5d da F2.2 (lotes 05-12, 05-15 e 05-17: worker contábil,
  raiz e relatórios), preservada no branch `f22-onda5d-wip`. Pronto quando:
  - o conferidor estrito dá ok nos 3 lotes;
  - o tsc e o vitest da API, do worker e do núcleo passam;
  - `contar-legado` = 0;
  - o commit está no `main`.
- **Escopo:** merge do branch e 1 agente integrador. O revisor do lote 05-15 entra só se houver achado alto em
  aberto (estava em correção quando a obra parou).
- **Agentes por papel:** integrador 1 e corretor até 1.
- **Estimativa:** (1 × 3,5 + 1 × 0,8) × 1,2 ≈ 5 M equivalentes. Teto: 7 M.
- **Fora do escopo:** a dívida da F2.4 e o conector.
- **Riscos:** conflito do merge com o `main`, que o orquestrador resolve antes de lançar.
