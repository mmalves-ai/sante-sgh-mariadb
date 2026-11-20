# infra/firebird

- **Cópia de dev**: compartilhada com a `sante-api`, fica **fora do repositório**, em `../banco-dev`
  (container `redesante-fb-pc`, Firebird 3.0.14, `127.0.0.1:3351`; ver o `README.md` de lá). Desvio do
  M01 de 2026-10-19: no lugar de uma imagem `infra/firebird` com `gbak -c` de um `.fbk`, a cópia é a frio,
  conferida por hash. O projeto usa a cópia por `pnpm copia:restaurar`, `pnpm copia:neutralizar`,
  `pnpm ambiente:verificar` e `pnpm testes:integracao`, que recusam qualquer container que não seja
  `redesante-fb-<código>` de `ESTABELECIMENTOS` (nunca o `sante-firebird`).
- **Biblioteca `vlr_med`**: ausente na cópia (e no `sante-firebird`); vem da TI. Até lá, `VLR_MED` falha e
  a prova dos triggers a marca como esperado-falhar.
- **Banco do CI**: o esqueleto, descrito em [`esqueleto.md`](esqueleto.md) (entrega futura).
