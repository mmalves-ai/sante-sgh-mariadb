# tools/formularios

`./pnpm formularios:converter -- --hospital=<código>` (M09): lê na cópia de dev, em transação somente
leitura e um modelo por vez, a definição dos modelos de formulário do PEP (`PREVOLUCAO`, `PRPADEVOL`,
`PRPERGUNTA`, `PRRESPOSTA`, `PRCADRESP`, `PRFORMULCOMP`, `HTCABECFORMULCOMP`, `HTFORMULCOMP`), converte cada
um pelo parser de `@sgh/dominio-pep` e grava `docs/marcos/M09/dfm/<codigo>.json` e
`docs/marcos/M09/dfm/relatorio.md`. Nenhuma resposta de paciente é lida. Saída do terminal: só contagens.
