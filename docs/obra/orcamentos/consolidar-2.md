# Orçamento: consolidar-2

estimativa_M: 38
teto_M: 49

- **Por quê:** a rodada f3-funcoes (24/11) fechou sem provas (a carga ocupava a memória e o vigia derrubava os testes).
  Com a carga parada (14h16) e a memória livre, `verificar:tudo` mediu o real: 123 erros de tipagem (cerca de 30
  arquivos, quase todos telas novas), 25 de stylelint (cor fixa), 52 arquivos de teste vermelhos, 195 `<select>` crus
  (combos), 50 rotas de gravação sem auditoria declarada, 6 achados de permissão e 3 de convivência (ADR 0003).
- **Fatias:** 12, geradas por `sante-sgh-dados/obra/consolidar2/fatiar.py` a partir dos logs; cada arquivo tem um dono só.
- **Agentes:** 12 corretores × 2,5 M + 12 revisores × 0,4 M + até 6 segundos corretores × 1 M + 1 integrador × 3 M
  (roda `verificar:tudo` e fecha o que sobrar entre fatias) ≈ 38 M; teto 49 M (+30%).
- **Fechamento:** `verificar:tudo` VERDE, depois `ci-sim` VERDE e push.
