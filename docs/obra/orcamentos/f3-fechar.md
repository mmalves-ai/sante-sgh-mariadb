# Orçamento: f3-fechar

estimativa_M: 255
teto_M: 331

- **Por quê:** as rodadas f3-provas e f78-construir (24/11) renderam cerca de 14 M por função coberta: fatias de 3
  funções estouravam o teto G6 (35 de 64 agentes) e o E2E, exclusivo e com montagem da árvore a cada execução, virou
  fila. Restam na F3 144 funções Parciais ou em falta (recontagem das fichas, 24/11 21h).
- **Desenho novo:** 1 função por fatia (144 fatias, `sante-sgh-dados/obra/f3-fechar/fatiar.py`); o construtor prova
  domínio e contrato de efeito (integração por `tools/obra/vaga-teste.sh`, 3 vagas), escreve o E2E e NÃO o roda, não
  edita a ficha (devolve a situação); revisão adversarial só do que o construtor deu como pronto; corretor só com
  achado; um integrador por marco roda todos os E2E do marco numa execução do `e2e-vm.sh`, aplica as situações na
  ficha por script e reconta. Três marcos por vez (cerca de 5 agentes por módulo).
- **Agentes:** 144 construtores × 1,2 M + cerca de 100 revisores × 0,35 M + cerca de 50 corretores × 0,8 M + 9
  integradores × 2,5 M ≈ 255 M; teto 331 M (+30%).
- **Portão de rendimento:** medir no primeiro relatório; se passar de 5 M por função pronta, parar e redesenhar.
- **Depois:** o mesmo desenho para a F7 e a F8 (orçamento próprio), se o rendimento se confirmar.
