# Orçamento: f3-provas

estimativa_M: 184
teto_M: 239

- **Por quê:** a rodada f3-funcoes (24/11) construiu 163 funções, mas a carga ocupava a memória e quase nenhuma prova
  rodou: as fichas ficaram com 92 cobertas, 153 parciais e 1 faltando (recontagem por script, 24/11 17h50). Com a carga
  parada e a verificação completa verde (65a1c3c9), esta 2ª volta prova e fecha as parciais.
- **Fatias:** 54, de até 3 funções, por `sante-sgh-dados/obra/f3-provas/fatiar.py` (linhas Parcial e Falta das fichas).
- **Agentes:** 54 construtores × 2,0 M (lição da consolidar-2: com memória livre o agente gasta cerca da metade) + 54
  revisores × 0,4 M + cerca de 40 corretores × 1,2 M (só onde a revisão achou algo ou a fatia não fechou) + 3
  integradores × 2,0 M ≈ 184 M; teto 239 M (+30%).
- **Pendências herdadas nos integradores:** 8 .int.spec antigos vermelhos, E2E f36:76, f37-ajustes:127,
  f37-complementos:145 e a tela da exceção por item da farmácia (f36:22).
