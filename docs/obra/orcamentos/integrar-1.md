# Orçamento: integrar-1

estimativa_M: 25
teto_M: 33

- **Por quê:** a construir-1 deixou 92 funções prontas (domínio e contrato de efeito verdes) com 143 arquivos de E2E
  escritos e não rodados, em 18 fichas (F3 e F78). Mesmo desenho da f3-integrar (~1 M por função coberta).
- **Agentes:** 3 lotes de E2E (um por grupo de fichas, em sequência, pela pesado.lock) × 0,8 M + corretores dos
  vermelhos por ficha (~12 × 1,5 M) + 3 lotes de reteste × 0,6 M + 3 aplicadores de ficha por script × 0,8 M ≈ 25 M;
  teto 33 M.
