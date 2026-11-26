# Orçamento: integrar-4 (26/11 12h10)

E2E das 133 funções Parciais (docs/obra/pendencias-2026-11-26.md) rodados por script no commit 1b196ec7: 148 testes em
109 arquivos, 65 verdes e 75 vermelhos; 38 arquivos inteiros verdes e 71 com vermelho ou pulado. Erros extraídos em
sante-sgh-dados/obra/integrar-4/vermelhos-lote1.json e agrupados por ficha em grupos.json (18 grupos de até 6 arquivos).
Um corretor por grupo (erro já extraído, uma prova por grupo, no máximo 2 rodadas), 4 ao mesmo tempo; depois um agente
de fichas aplica verdes e cobertas, e o orquestrador relança o lote dos corrigidos por script.

estimativa_M: 17
teto_M: 22

Base: corretor de E2E com erro extraído mediu ~0,35 M por arquivo (lote 4 e 5 da integrar-3); grupo de até 6 arquivos
com uma prova só ≈ 0,9 M; 18 x 0,9 = 16 M + fichas 1 M.
