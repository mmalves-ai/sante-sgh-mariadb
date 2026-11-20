# infra/firebird/fase7

Os ensaios da Fase 7 (M58: Firebird 5 e UTF-8, por hospital). Tudo aqui roda **só na cópia de dev e em servidores
descartáveis de ensaio**: nada conecta à produção. A execução em produção é da TI do hospital, na janela autorizada pelo
dono, pelo roteiro da M58-F5.

- **Regra 4 da Fase 7 (exceção nominal).** É a única pasta onde podem entrar scripts que mexem no banco inteiro (motor,
  charset). A F2 não tem DDL: o banco é copiado por backup e restauração, sem mudar tabela, gatilho, procedure nem
  generator. A F3 (UTF-8) também não tem script de DDL versionado: o convertido nasce da extração do próprio motor
  (`isql -x` da base) com os ajustes de `packages/legado/src/copia/ddl-utf8.ts` (ADR 0032), num arquivo novo do
  servidor de ensaio; a base não muda.
- **`ensaio-firebird5/`** (M58-F2): o servidor Firebird 5.0.3 do ensaio (`sgh-ensaio-fb5-pc`, `127.0.0.1:3355`, volume
  `sgh-ensaio-fb5-pc-dados`) e o `ensaiar.sh` (passos `subir`, `backup`, `restaurar`, `volta`, `estado`, `descer`,
  `limpar`). Sempre sob `obra-sgh/travas/com-copia.sh`. Os tempos ficam em `.ensaio/<h>/tempos.env` (fora do git) e
  o relatório sai de `pnpm ensaio:firebird5 -- --hospital=pc [--contagens]` para `docs/marcos/M58/pc/firebird5.{json,md}`.
- **`ensaio-utf8/`** (M58-F3): o `converter.sh` (passos `extrair`, `preparar`, `criar`, `ajustar`, `bombear`,
  `completar`, `verificar`, `completo`, `estado`, `apagar`) cria ao lado da restaurada da F2 (`pc.fdb`, NONE, intocada)
  o banco convertido `pc-utf8.fdb` (UTF8) no mesmo servidor de ensaio e copia os dados (cópia no motor por `EXECUTE
  STATEMENT ... ON EXTERNAL`, ou pelo processo do Sante na tabela com byte indefinido; ADR 0032). Trava própria
  (`.ensaio/<h>/trava/utf8.lock`); não toca as cópias de dev. Estado e tempos em `.ensaio/<h>/utf8/` (fora do git); o
  relatório sai de `pnpm ensaio:utf8 -- --hospital=pc [--equivalencia]` para `docs/marcos/M58/pc/utf8.{json,md}`.
- **Funções externas.** O Firebird 4 em diante vem com `UdfAccess = None` e a imagem 5 não traz a `ib_udf`. O servidor
  de ensaio usa `UdfAccess = Restrict UDF` e recebe, só leitura, a `ib_udf.so` da imagem 3.0.14 (com a `libncurses.so.5`
  e a `libtinfo.so.5` de que ela depende). A `vlr_med` do fornecedor não está na cópia e continua ausente (vem da TI).
- **Espaço.** O `.fbk` e a restaurada ocupam perto do dobro do banco. `ensaiar.sh limpar` apaga o `.fbk`; `docker
  compose -f ensaio-firebird5/docker-compose.yml down -v` apaga o servidor e o volume (com `FB_PC_SENHA` e
  `ENSAIO_UDF_DIR` no ambiente, como o `ensaiar.sh` faz).
