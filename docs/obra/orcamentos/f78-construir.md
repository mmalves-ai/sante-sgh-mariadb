# Orçamento: f78-construir

estimativa_M: 198
teto_M: 257

- **Por quê:** o inventário f78-fichas (24/11 19h) mediu no código: F7 (exigido para vender) 109 funções, 29 cobertas,
  57 parciais, 23 faltam; F8 (recursos novos) 104, 12 cobertas, 28 parciais, 64 faltam. Fichas em
  `docs/fases/fichas/F78-0N-*.md`.
- **Fatias:** 60, de até 3 funções, por `sante-sgh-dados/obra/f78/fatiar.py`.
- **Agentes:** 60 construtores × 2,2 M + 60 revisores × 0,4 M + cerca de 45 corretores × 1,0 M (só onde a revisão
  achou algo ou a fatia não fechou) + 3 integradores × 2,0 M ≈ 198 M; teto 257 M (+30%).
- **Concorrência:** lotes de 7 fatias (roda junto com a f3-provas na mesma árvore). Testes de integração por
  `tools/obra/vaga-teste.sh` (3 vagas); E2E pela pesado.lock (o e2e-vm.sh pega sozinho).
