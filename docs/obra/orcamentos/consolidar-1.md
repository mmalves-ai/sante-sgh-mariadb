# Orçamento: consolidar-1

estimativa_M: 3
teto_M: 3.9

- **Por quê:** as rodadas pep-gravacao (1e94a99e, 8dad3220; PEP 108 → 2 métodos pendentes) e modulos-proprios-1
  (c7e8a298; 167 → 106) deixaram sobras compartilhadas que nenhum agente de família podia fechar: anexos de
  implantação e privilégios regenerados sem commit (privilegios-papel.sql, scripts-sgh.md), validacao-ddl.json/.md
  sem rodar o validador, a linha de catálogo de sugestao_notificacao_resolvida (docs/analise/rodada2/final/
  catalogo.tsv), migrações novas aplicadas só em alguns clientes de teste (06_PEP/93..99, 17_INTG/91, 18_QUA/94 e 95),
  qualidade/agravo.int.spec.ts falhando no f22_o4 (preparo supõe CID sintética, o cliente tem a CID-10 oficial),
  specs novos fora da SUITE_BASE/tsconfig.migrado.json.
- **Agente:** 1 conferidor sequencial × 2,5 M × 1,2 = **3 M**; teto **3,9 M**.
