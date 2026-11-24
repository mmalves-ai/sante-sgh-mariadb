# Orçamento: f3-motores

estimativa_M: 24.7
teto_M: 32

- **Medido (24/11, 05h, inventário do orquestrador):** F3 sem nenhum marco aceito; das 247 funções da lista mínima
  (docs/analise/01..09, decisão F3), 192 feitas no código herdado, 30 parciais e 25 desligadas (indicador pela coluna
  de estado, não conferência função a função); 0 fichas funcionais; 0 revisões "sem cara de SPDATA"; nenhum E2E
  verde no MariaDB (docs/obra/ci-verde.md: "E2E @M00 vermelho", servidor não sobe em 240 s).
- **Motores F3.0, buracos de regra:** (1) nenhum código abre conta_hospitalar na admissão (adt, internação,
  atendimento) nem lança diárias e taxas automáticas; (2) a saída de estoque ao paciente (dispensação, consumo) não
  vira item da conta; (3) nada grava producao_repasse a partir do faturamento.
- **Rodada:** 4 famílias (conta-admissao, estoque-conta, repasse-producao, e2e-infra) em linha de produção
  (construtor → revisor adversarial → corretor) e 1 integrador.
- **Agentes:** 4 × 2,7 + 4 × 0,6 + 4 × 1,1 + 3 = 20,6 M × 1,2 = **24,7 M**; teto **32 M**.
