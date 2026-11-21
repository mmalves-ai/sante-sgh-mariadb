# Brief comum da F2.2/F2.3 (igual para todos os lotes; a parte variável é a fatia `<onda>-<lote>.md`)

**Objetivo do lote:** os arquivos da fatia sem nenhum `@sgh/legado`. As portas do módulo ganham um adaptador
**próprio** sobre o MariaDB, pelo `@sgh/nucleo`, nas tabelas do DDL da fatia. O módulo fica registrado em
`API_MODULOS` quando a fatia pedir. Leia só este brief e a sua fatia. De outra unidade, abra só o arquivo que a
fatia cita.

## 1. Adaptador próprio (padrão)

- **A porta continua, o tipo muda.** A interface `Porta*` em `porta.ts` fica.
  - Os tipos `*Lido`, `*Legado`, `*Sgh` e `*Gravado` do legado viram tipos de negócio do próprio módulo, ou do
    contrato em `packages/contratos`, quando a tela já usa esse contrato.
  - Use booleano, data ISO, id numérico e número de negócio. Nada de S/N, HHMM, sentinela (`0`, `' '`,
    `1899-12-30`), código do SPDATA ou do MV, nem nome de coluna antiga.
- **`porta-propria.ts` novo**, com `class Porta<X>Propria implements Porta<X>`. O construtor recebe o
  `NucleoProprio`, ou uma interface mínima dele, como a `NucleoLeitura` de `apps/api/src/sessao/fonte-propria.ts`,
  que é o modelo a seguir.
  - **Leitura:** `nucleo.lerSomente({ cliente, correlacao }, (l) => l.consultar(sql, params))`. Também servem
    `l.uma(...)` e `consultarParaAtualizar` dentro de uma escrita.
  - **Gravação:** sempre pelo `Executor` (`nucleo.criarExecutor()`), com
    `executor.executar(definirOperacao({ nome, tabelas, entrada: <zod>, ... }), cliente, entrada, contexto)`.
    A trilha, o outbox e a idempotência ficam na mesma transação. A operação declara as tabelas que grava.
  - **Trava otimista** pela coluna `versao`, com `travarEConferir`, `erroConflitoVersao` e `alterarAuditado`.
  - **Números de negócio** por `proximoNumero` ou `garantirSequencia`.
  - **Erros** por `ErroOperacao` e `problemaDaOperacao`. Uma violação de restrição vira mensagem de negócio
    (`restricaoViolada`).
- **Contexto.** `cliente`, `estabelecimento`, `usuario` e `correlacao` vêm do `ContextoNucleo` ou do
  `ContextoOperacao` da requisição. Nunca use um cliente fixo no código.
  - Toda leitura de tabela com `estabelecimento_id` filtra pelo estabelecimento da sessão. A exceção é o dado da
    rede inteira, com o motivo no comentário.
  - Toda leitura de tabela com `excluido_em` filtra `excluido_em IS NULL`.
- **Arquivos do legado:**
  - `porta-legado.ts`: apague.
  - `porta-memoria.ts` e os `*-memoria.ts`: ficam, para dev/ci e para os testes de unidade, com os tipos novos e
    sem legado.
  - `public-api.ts`: exporta a porta própria e a fábrica, nunca a de legado.
- **Regra de negócio** fica em `packages/dominio-*`, puro e testado, nunca no SQL nem em gatilho. Se a regra
  estava escondida na porta do legado, leve-a ao domínio.

## 2. Ligar o módulo (só no lote que a fatia marca "Registrar")

- Crie `apps/api/src/modulos/<m>/modulo.ts`, exportando `modulo(ctx: ContextoModulo): DynamicModule`.
  - O tipo `ContextoModulo` vem de `../registro.js`.
  - O módulo leva os controllers e os providers do `app.module.ts` antigo (procure só pelo nome do módulo, com
    `grep -n`).
  - A porta é a própria quando `ctx.nucleo` existe. A de memória fica só em dev/ci sem núcleo, a mesma regra do
    F2-L.
- Em `apps/api/src/modulos/registro.ts`, inclua `<m>: () => import('./<m>/modulo.js'),` em `REGISTRO_MODULOS`,
  em ordem alfabética. Não mexa no resto do arquivo.
- O `app.module.ts` não é editado: ele é desmontado na última onda.

## 3. Typecheck cumulativo: `apps/api/tsconfig.migrado.json`

- O primeiro lote que não o encontrar cria o arquivo como cópia do `apps/api/tsconfig.login.json`: `extends`,
  `noEmit`, `include: []` e os mesmos `files`.
- Cada lote **acrescenta** os seus arquivos, os novos também, com caminhos relativos a `apps/api`. Nunca tire os
  arquivos de outro lote. Comando:

  ```sh
  python3 -I -c "import json,sys;p='apps/api/tsconfig.migrado.json';d=json.load(open(p));d['files']=list(dict.fromkeys(d['files']+sys.argv[1:]));open(p,'w').write(json.dumps(d,indent=2)+'\n')" src/modulos/<m>/porta-propria.ts ...
  ```
- No worker, faça igual em `apps/worker/tsconfig.migrado.json`.
- No fim da F2.3, o `tsconfig.json` cheio substitui os dois, e o `project.json` volta a usá-lo.

## 4. ADR 0003 e regras de ouro

- **Não copie o comportamento do SPDATA:** nem as tabelas espelho, nem a "gravação como o sistema antigo", nem
  o código de convivência (`destino: 'legado'`, "unificado no legado", vigia de reconciliação, coexistência).
  Esse código é removido.
- **Melhore onde couber**, seguindo o MV e as boas práticas: restrições do banco, validação na entrada e
  auditoria. Registre cada melhoria numa linha do cabeçalho do arquivo (`Melhoria: ...`).
- **Nomes de negócio em português.** Nada de "SPDATA", "MV", "legado" ou "Firebird" em nome de tipo, função,
  rota ou tela. O verificador de nomes proibidos roda na esteira.
- **SQL sempre parametrizado (`?`)**, com nomes de tabela e coluna literais.
  - Um nome dinâmico (ordenação, filtro por campo) só passa por uma lista branca
    `const COLUNAS = { campo: 'coluna' } as const`, mais `conferirNome`.
  - Nunca concatene entrada do usuário.
- **Fronteiras:** `dominio-*` não importa banco. Só o `@sgh/nucleo` e as portas próprias falam com o MariaDB.
- **Dados:** nunca use dado real nem o cliente `demo`. Logs só com códigos e contagens. Nunca imprima o `.env`.

## 5. Testes

- Os specs de unidade do lote continuam verdes, sobre a memória ou sobre a porta própria com dublê.
- **Cada porta própria ganha `porta-propria.int.spec.ts` contra o MariaDB real**, com cliente de teste próprio
  do lote: `f22_<onda>_<lote>` (ex.: `f22_01_02`).
  - No `beforeAll`, crie o cliente se faltar, com
    `python3 -I tools/db/criar_cliente.py f22_01_02 "Teste F2.2 lote 01-02"`. O comando recusa cliente já
    existente: consulte antes com `--listar`.
  - Ainda no `beforeAll`, monte a massa sintética. No `afterAll`, limpe a massa.
  - Modelo: `apps/api/src/sessao/fonte-propria.int.spec.ts`.
- **Contrato de efeito:** cada gravação testa o que deixa no banco, ou seja, as linhas, a `versao`, a trilha e o
  outbox. Teste também a recusa (conflito de versão, entrada inválida, outro estabelecimento).
- **A mesma bateria em memória e no banco**, quando a porta tiver as duas implementações: um `describe.each`
  sobre as fábricas.

## 6. Fechamento do lote

1. Rode `tools/obra/conferir-lote-f22.sh <lote>` até sair "ok". Aviso de pendência de **outro** lote da mesma
   onda é aceito.
2. Não faça commit: o orquestrador faz. Não edite arquivo de outro lote. Se precisar, escreva o pedido na saída.
3. Grave `docs/obra/fatias/f22/saidas/<lote>.md`, com até 30 linhas:
   - arquivos criados e apagados;
   - portas e tabelas usadas;
   - melhorias;
   - pedidos ao orquestrador;
   - a última linha do conferidor.

   Devolva só um resumo de 5 linhas.
