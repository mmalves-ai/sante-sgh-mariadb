# Orçamento: deadlock-paralelo

estimativa_M: 4
teto_M: 5.2

- **Achado (23/11, 2h10):** a execução 8 parou na onda 49 de 208. Um gravador caiu com deadlock 1213 (UPDATE de
  `lancamento_repasse` por id, preenchimento posterior de chave) e o coordenador esperou para sempre os outros, que
  não morrem com SIGTERM (corrigido para SIGKILL no 914f3f15, worktree velocidade). Continuação na execução 9 com 1
  gravador enquanto a causa é corrigida.
- **Agentes:** 1 corretor em worktree isolado (3 M) e 1 revisor só do diff (0,5 M). Soma 3,5 M × 1,15 = **4 M**;
  teto **5,2 M**.
