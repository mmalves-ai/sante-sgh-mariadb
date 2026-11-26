# Orçamento: consolidar-5 (25/11 23h55)

Consolidação para o push (GitHub parado em 495e9985 desde a manhã): a esteira simulada de d1f70510 falhou em
verificar-tudo, 14 tarefas (log em sante-sgh-dados/obra/logs/ci-sim-d1f70510.log). Quatro agentes por área, sem
sobreposição de arquivos: (1) geradores e verificadores (privilegios:gerar, imutabilidade:gerar, permissões, variáveis do
ambiente); (2) pacotes (dominio-pep, dominio-cirurgia, contabil-ferramentas, contratos); (3) api (typecheck, lint, build,
test); (4) web (typecheck, test). Depois, ci-sim de novo pelo orquestrador e push.

estimativa_M: 12
teto_M: 16

Base: corretor de consolidação ~2,5 M (consolidar-3/4) x 4 + margem.
