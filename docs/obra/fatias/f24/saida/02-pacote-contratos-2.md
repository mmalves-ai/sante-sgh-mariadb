# F2.4 lote 02-pacote-contratos-2 (2ª volta)

## O que mudou
- Toda a dívida restante do lote estava em `packages/contratos/dist/*.d.ts`: declarações geradas, que o git ignora
  (`.gitignore: dist/`) e que estavam desatualizadas. Os `src/*.ts` correspondentes já estavam limpos desde a 1ª volta.
- `dist/` foi regenerado com `tsc -p packages/contratos/tsconfig.lib.json`, sem editar nenhum `.d.ts` à mão e sem
  apagar a pasta (outros lotes usam o mesmo pacote).

## Decisões pela melhor prática
- Arquivo gerado não se corrige à mão: a correção mora no `src`, e o `dist` se regenera.

## Pedidos (fora do lote)
- `tools/obra/divida_f24.py`: ignorar `**/dist/**` (artefato de build e fora do git), ou regenerar o `dist` antes de
  medir. Sem isso, qualquer `dist` velho volta a contar dívida.
- Órfão em `dist`: `packages/contratos/dist/permissoes/catalogo-legado.d.ts` não tem mais `src`; um build limpo
  (apagar `dist` antes do `tsc`) o elimina. Não apaguei por haver lotes em paralelo.

## Prova
- `divida_f24.py --modulo packages/contratos/dist`: 0 arquivos. No total global, nenhum arquivo do lote aparece (56
  restantes, todos de outros módulos).
- `conferir-lote-f24.sh 02-pacote-contratos-2` saiu com rc=1 só por 6 erros de tsc em
  `apps/api/src/modulos/patrimonio/{ajustes,patrimonio}.int.spec.ts` (TS2554, arquivos modificados por outra trilha e
  fora deste lote). Nenhum erro do lote.
