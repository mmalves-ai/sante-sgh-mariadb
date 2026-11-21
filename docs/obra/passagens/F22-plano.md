# Passagem: plano executável da F2.2/F2.3, medido em 2026-11-20

**Meta:**
- `@sgh/legado` = 0 (`tools/obra/contar-legado.sh --exigir-zero`);
- `API_MODULOS=todos` com os 51 módulos registrados;
- `app.module.ts` removido.

**Como se gera:**
- `python3 -I tools/obra/fatiar_f22.py` é determinístico, roda em menos de 1 s e só lê código e DDL.
- `--so-medir` dá só as contagens; `--pontes` mostra o que puxa o legado entre os módulos.
- As saídas ficam em `docs/obra/fatias/f22/`:
  - `brief.md`, o brief comum;
  - `<onda>-<lote>.md`, a fatia;
  - `<onda>-<lote>.lista`;
  - `unidades.tsv`;
  - `indice.tsv`, com onda, passo, dependências entre lotes e registro.

## Medição

- **Legado:** 920 arquivos importam `@sgh/legado`, o mesmo número do `contar-legado.sh`, com 1.040 imports.
- **Unidades:** 67 unidades somam 1.481 arquivos, todos os arquivos das unidades, specs inclusive:
  - os 51 módulos de `apps/api/src/modulos`;
  - `api-raiz`: `trilha-legado`, `porta-pin-legado` e `telemetria`;
  - `api-desmontagem`, que é o `app.module.ts`;
  - 6 do worker: 81 arquivos, 59 com legado;
  - 3 de `packages/testes`, só os arquivos com legado (145);
  - 5 de `tools`, só os arquivos com legado (39).
- **O fecho do login** (F2-L) é a base: está fora das unidades e já tem 0 de legado.
- **Os maiores:**
  - `pessoas`: 180 arquivos, 121 com legado;
  - `acesso`: 77 arquivos, 44 com legado, sem contar o fecho do login;
  - `enfermagem`: 76 e 47;
  - `operadora`: 63 e 54;
  - `pep`: 49 e 28.
- **Acoplamento.** O grafo por módulo fecha quase tudo num ciclo só. Os `public-api.ts` reexportam as portas do
  legado, e os specs puxam `*.spec-util`.
- **Por isso, a ordem é por arquivo.** A onda 1 é o fecho de imports das sementes: 155 arquivos, 87 com legado.
  As demais ondas saem das camadas do grafo de módulos sobre o que sobra. A dependência só conta como dura quando o
  símbolo importado (seguindo os barris) alcança o legado.

## Ondas e lotes: 8 ondas, 55 lotes, de 11 a 41 arquivos cada

| Onda | Lotes | Arquivos (legado) | Conteúdo |
|---|---:|---:|---|
| 1 Portão | 6 | 155 (87) | recepção, cadastro e atendimento, agenda, mais as **pontes**: só os arquivos de config, pep, exames, internação, documento, acesso, rede e suporte que o fluxo importa |
| 2 | 14 | 355 (210) | assinatura, catálogos, config (resto), consultas, contratualização, custos, enfermagem (2), documento, especialidades, exames, farmácia, financeiro, faturamento, implantação, operadora (2), internação, orçamento, patrimônio, portaria, preços, rede, rouparia, sessões, suporte |
| 3 | 5 | 108 (55) | ADT, `api-raiz` e digitalização, manutenção, nutrição e repasse, SUS |
| 4 | 4 | 103 (50) | integração, pep (resto), qualidade, relatório (em 2 passos: 04-04 antes de 04-01) |
| 5 | 5 | 167 (83) | acesso (2), administração, coexistência, SADT e carga |
| 6 | 9 | 294 (173) | cirurgia, pessoas (5), portal do paciente, suprimentos, telemedicina e TISS |
| 7 | 1 | 33 (18) | contábil e portal médico |
| 8 Desmontagem | 11 | 266 (244) | `packages/testes` (5), `tools` (2 lotes; o 08-06 leva também o `app.module.ts`), worker (4) |

- **Primeiro lote: 01-01, recepção.** São 35 arquivos, 20 com legado, e ele registra `recepcao`.
- **Os outros lotes da onda 1:**
  - 01-02, cadastro e atendimento, que registra os dois;
  - 01-03, pontes de config;
  - 01-04, agenda, que registra, mais as pontes de acesso e documento;
  - 01-05, pontes de exames e internação;
  - 01-06, pontes de pep, rede e suporte.

## Ordem de execução

1. **Uma onda por vez.** Dentro da onda, os lotes do mesmo passo andam em paralelo, um agente por lote. Cada
   prompt é o `brief.md` colado igual no início, seguido de "sua fatia: `docs/obra/fatias/f22/<id>.md`".
2. **Lotes em ciclo andam juntos.** São os casos da onda 1 inteira e das unidades divididas: enfermagem, operadora,
   pessoas, acesso e o worker. O conferidor trata como aviso a pendência de outro lote da mesma onda.
3. **Fim da onda:**
   - `tools/obra/conferir-lote-f22.sh <id> --estrito` para cada lote, mais `contar-legado.sh`;
   - revisão adversarial da onda;
   - correção só dos lotes afetados;
   - commit.
4. **Portão da F2, depois da onda 1:**
   - os E2E do fluxo paciente → atendimento no MariaDB, pelas telas;
   - a mesma bateria em memória e no banco;
   - o relatório das portas cobertas.

   Só então segue a onda 2.
5. **Onda 8:**
   - o worker, os testes e as tools;
   - a remoção do `app.module.ts`, do `tsconfig.login.json` e do `tsconfig.migrado.json`;
   - o `tsconfig.json` cheio;
   - `project.json`: `typecheck` cheio e `test` sem a `pendente`;
   - os 31 scripts do `package.json` que citam o legado;
   - `contar-legado.sh --exigir-zero`.

## Infraestrutura criada para os lotes (sem código de produção)

- `tools/obra/conferir-lote-f22.sh <id> [--sem-testes|--estrito]`: um comando que devolve "ok" ou a lista de
  erros. Confere:
  - o legado nos arquivos do lote e nos novos;
  - o fecho de imports;
  - a presença dos arquivos no `tsconfig.migrado.json`;
  - o `tsc`, com os erros filtrados ao lote;
  - o vitest dos specs do lote, de unidade e de integração;
  - o registro no `registro.ts`.

  Ensaio em 01-02, antes de qualquer migração: aponta os 13 arquivos com legado e os arquivos fora do tsconfig.
  O teste rodou em 8 s, sem os testes.
- `tools/obra/vitest-lote.config.ts`: roda exatamente os specs de `LOTE_SPECS`. Provado com 2 specs da base: 8
  testes verdes.
- `apps/api/tsconfig.migrado.json` é **proposto**, não criado: o primeiro lote o cria como cópia do
  `tsconfig.login.json` (brief, item 3), e cada lote acrescenta os seus arquivos.

## Riscos

1. **Onda 1 em ciclo.** Os 6 lotes só ficam verdes no `--estrito` juntos. Combine os tipos das pontes cedo:
   01-03 (config) e 01-06 (pep) definem tipos que 01-01 e 01-02 usam. Se travar, rode 01-03, 01-05 e 01-06 antes
   de 01-01 e 01-02.
2. **Barris (`public-api.ts`) reexportam o legado.** Quem importa um barril herda o fecho dele. Nos lotes, prefira
   importar o arquivo específico, ou limpe o barril no lote do módulo.
3. **Tabelas-alvo por casamento de nome:** são uma heurística. As sementes têm a lista fixa (`FIXAS` no script).
   - "convênio" é `fonte_pagadora`, e "médico" é `profissional`.
   - Lotes de testes, tools e worker recebem tabelas pouco úteis: lá o trabalho é trocar imports.
4. **Coexistência, carga e implantação** existem para conviver com o SPDATA. Pelo ADR 0001 e pelo ADR 0003, o
   destino pode ser **remover, e não migrar**. Decisão do dono antes da onda 5 (lote 05-04, 32 arquivos).
5. **`acesso/gestao.spec.ts` importa `emNomeDePadrao` do `app.module.ts`.** É preciso movê-lo antes da desmontagem
   (o aviso está na fatia 05-01).
6. **Multicliente.** O `ServicoAutorizacao` atende um cliente por instância, e as tentativas de login ficam em
   memória. Isso fica pendente da F2.2: resolva no lote 05-01 ou 05-02 (acesso) ou num lote à parte, antes da
   onda 5.
7. **Integração.** Cada lote cria o cliente `f22_<onda>_<lote>`, o que dá até 55 bancos de teste. Medir o disco
   (o vigia está a 130 GB) e apagar os clientes de teste ao fim de cada onda.
8. **DDL incompleto para algum módulo:** a porta pede uma tabela que não existe. O lote registra o pedido, e a
   correção vai para `db/migracoes`, com o validador. A porta nunca contorna isso com uma tabela improvisada.

## Decisão do dono (2026-11-21, ADR 0003, itens 5 e 6)

- **Lote 05-04 (`coexistencia`):** **remover**, não migrar. O módulo sai do código e dos registros, o que ele
  importar fica limpo, e o verificador confirma que não há mais referência a ele.
- **Lote 05-05 (`carga` e `sadt`):** o `sadt` é migrado normalmente. O `carga` **não é migrado como módulo da
  API.** Ele vai para o conector (F4):
  - o que tiver valor (de-para, ordem de carga) vira insumo do `conector/`;
  - o disparo passa a ser um comando do administrador da plataforma: apontar a base Firebird, carga inicial e
    diferencial;
  - nenhum código da API lê o Firebird.

## Sem migração parcial (dono, 2026-11-21)

Com banco separado, não existe convivência por setor, liberação em lote nem parcela das operações feita "aqui".
Cada hospital passa inteiro, quando decidir, pelo Importar e o Sincronizar do painel (ADR 0003, itens 5 a 8).
Lote de **limpeza da coexistência**, na onda 5, junto com o 05-04:

- remover os módulos **`coexistencia`** e **`onda0`**, na API, no web (rotas, menu, i18n) e nos testes;
- no **`implantacao`**, tirar só a verificação de convivência com o sistema antigo do teste de fumaça
  (`aplicacao/fumaca.ts`) e os textos ligados a ela;
- criar o verificador `tools/obra/sem-coexistencia.sh`, que falha se aparecer qualquer um destes:
  - rota, módulo ou texto de convivência ("coexist", "onda0", "sistema antigo", "no outro sistema", liberação
    por setor);
  - `dist/` versionado;
- registrar a remoção no `ESTADO.md`.
