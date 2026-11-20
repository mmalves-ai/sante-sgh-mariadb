# Passagem: plano da F2 (núcleo e persistência), medido em 2026-11-20

**Uso de `@sgh/legado` no modelo base:** 986 arquivos.

| Onde | Arquivos |
|---|---:|
| `apps/api` | 697 |
| `packages/testes` | 145 |
| `apps/worker` | 58 |
| `tools` | 39 |

**Símbolos:** 4.465 distintos. Divisão:

1. **Infraestrutura (cerca de 40 símbolos, a maior parte do uso).** Vai para o `packages/nucleo` (F2.1). Os mais
   usados:
   - `NucleoLegado` 183 e `ErroOperacao` 157;
   - `Leitor` 152 e `Escritor` 147;
   - `operacao` 126 e `somenteSgh` 116;
   - `LinhaTrilha` 107 e `gravarTrilha` 94;
   - `ContextoOperacao` 70;
   - `ChaveGravada` 68 e `PrerequisitoGravado` 64;
   - `lerConfiguracaoNucleo` 62 e `Executor` 53;
   - `criarDriverNativo` 64, que é o driver do Firebird e sai;
   - `FonteCatalogo` 54;
   - de configuração e ambiente: `lerCodigos`, `caminhoArquivoAmbiente`, `ambienteEfetivo`, `recusa`, `MetricasExecutor`, `escritasDaTransacao`.

   Fonte: `referencias/legado-nucleo/`.
2. **Persistência por operação (a cauda longa, milhares de funções e tipos `*Lido`/`*Gravado`).** Cada uma
   vira um adaptador **"próprio"** em `packages/persistencia/<modulo>`, gravando nas tabelas do DDL (F1.3). Isso
   depende do DDL validado.

**Ordem para a próxima sessão:**

1. Conferir a validação do DDL (`python3 -I tools/db/validar_migracoes.py`).
2. **F2.1:** criar o `packages/nucleo` a partir de `referencias/legado-nucleo/`, sem nada de Firebird, com
   `Leitor` e `Escritor` sobre o driver do MariaDB (`mariadb` do npm, versão fixada). Trocar os imports de
   infraestrutura.
3. **F2.2 e F2.3:** um workflow por módulo. Cada agente recebe a fatia: portas do módulo (`apps/api/src/<modulo>/porta*.ts`), as tabelas
   do módulo no DDL e as funções do legado que a porta chamava. Ele escreve o adaptador "próprio" e o teste
   no MariaDB.
4. `./pnpm install` só quando a F2.1 estiver compilando.

## Destino de cada arquivo do núcleo (`referencias/legado-nucleo/`, cerca de 6.300 linhas)

| Arquivo | Linhas | Destino no `packages/nucleo` |
|---|---:|---|
| `executor.ts` | 733 | **Mantém**: protocolo da operação (trava, trilha, idempotência, outbox na mesma transação). Tira os passos de "gravar como o SPDATA" e a prova pós-escrita por gatilho |
| `operacao.ts`, `erros.ts`, `erros-operacao.ts`, `contexto.ts`, `identificacao.ts`, `telemetria.ts`, `configuracao.ts`, `estabelecimentos.ts` | cerca de 1.300 | **Mantém**, em vocabulário neutro |
| `transacao.ts` (`Leitor`, `Escritor`) | 380 | **Reescreve** sobre o driver `mariadb` (pool, transação, `SELECT ... FOR UPDATE`) |
| `pool.ts`, `driver.ts`, `driver-nativo.ts` | 855 | **Substitui** pelo pool do MariaDB, um pool por banco de cliente, resolvido pela plataforma |
| `trava-saidas.ts` | 426 | **Mantém o conceito**: neutralização fora de produção (AGENTS, regra 6) |
| `legado.ts` (`NucleoLegado`) | 875 | **Vira `NucleoProprio`**, a mesma fachada sem o legado |
| `codec*`, `cp1252.ts`, `colunas-utf8.ts`, `schema/` (catálogo `RDB$`), `como.ts`, `catalogo-operacoes.ts`, `gravador.ts`, `vigia/` | — | **Sai**: é específico do Firebird e do SPDATA (o conector tem o seu próprio) |
| `consulta/`, `crud/`, `gravacao/`, `sgh/` | — | **Avalia na F2.1**: o CRUD genérico serve; as receitas de gravação no SPDATA saem |

**Disco:** o `./pnpm install` ocupa cerca de 6,4 GB (medido no `node_modules` do `new-sgh`). Confira o espaço antes.
