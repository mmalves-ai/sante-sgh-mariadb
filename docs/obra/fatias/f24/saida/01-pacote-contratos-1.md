# F2.4, 2ª volta, lote 01-pacote-contratos-1

## O que mudou
- Os 54 arquivos do lote são **saída de build** (`packages/contratos/dist/*.d.ts`), fora do git e não consumidos
  (os paths de `tsconfig.base.json` apontam para `src/`). A dívida deles era cópia velha (build de 12:56) de fontes
  já corrigidas na 1ª volta.
- `dist/` foi regenerado a partir do `src/` atual (`tsc -p packages/contratos/tsconfig.lib.json`, 0 erros), numa pasta
  temporária e copiado com `rsync --delete`. Saíram 4 órfãos: `permissoes/catalogo-legado.{json,js,js.map,d.ts}`
  (a fonte não existe mais).
- Resultado: 53 de 54 arquivos zerados. Resta `dist/formatacao/hora-legada.d.ts` (vocab-antigo, linhas 3,7,9,25),
  que espelha `src/formatacao/hora-legada.ts`, do lote 08-misto-assinatura.

## Decisões pela melhor prática
- Não se edita saída gerada à mão: corrige-se a fonte e regenera-se.

## Pedidos (`01-pacote-contratos-1.json`)
1. Regenerar `packages/contratos/dist` depois do lote 08 (mesmo comando).
2. `divida_f24.py` ignorar `packages/*/dist/` (build fora do git), também para os `dominio-*/dist`.
