# CI verde: adaptação da esteira do modelo base ao sante-sgh (etapa 1)

Orçamento `ci-verde`, 2026-11-21. A CI (`.github/workflows/ci.yml`) falhava em todo push desde o primeiro commit porque
veio do `new-sgh` sem adaptação. Decisões: **(a)** vale aqui e foi corrigido de verdade; **(b)** é do modelo base sobre o
Firebird e saiu do `verificar:tudo` (o arquivo do verificador fica, fora da esteira); **(e2)** vale, mas o vermelho
restante está em `apps/` ou `packages/` (trilha F2.4), lista em `/tmp/claude-1000/ci-etapa2.txt`. Nenhum verificador
válido foi afrouxado.

## Itens do `pnpm verificar:tudo`

| Item | Decisão | Motivo e correção | Estado |
|---|---|---|---|
| nx run-many (grafo) | a | `packages/testes/project.json` apontava `implicitDependencies` para `legado`, que não existe. Tirado. | grafo ok |
| nx lint (fronteiras) | a | `eslint.config.js`: a tag `tipo:legado` virou `tipo:infra` (o `@sgh/nucleo`, F2.1); o driver do MariaDB (`mariadb`, `mysql2`) só no `tipo:infra`; o do Firebird proibido em todo TypeScript (só o `conector/`, Python, lê a origem). | ver etapa 2 |
| nx lint/typecheck/test/build | e2 | Erros em `apps/` e `packages/`. | etapa 2 |
| prettier --check | a / e2 | 46 arquivos fora de `apps/` e `packages/` formatados (só os versionados e não editados por outra trilha). Restam os de `apps/`, `packages/`, as sementes não versionadas de `db/sementes/` e `tools/verificadores/src/permissoes.ts` (em edição por outra trilha). | etapa 2 |
| verificadores:segredos | a / e2 | Raiz registrada do `.env` passou a ser a deste repositório (`tools/verificadores/env-raiz.json`, só stat). Em código TS/JS, valor que é só identificador (`X_SENHA: CONSTANTE`) é referência, não segredo; literal entre aspas e `.env`/YAML/JSON continuam achado (teste novo). Resta `packages/nucleo/src/configuracao.spec.ts:27` (`'x'` literal: trocar por marcador `<senha-de-teste>`). | etapa 2 |
| verificadores:sem-pessoal | a | A lista de colunas pessoais só é lida quando há captura versionada (hoje 0 arquivos); com captura e sem lista, falha. O teste usa a lista como fixture (`__fixtures__/sem-pessoal/`). | verde |
| treino:sem-dado-real | a | Sem mudança. | verde |
| guardas:legado | b | SQL do legado, prefixo `SGH_`, `packages/legado`: tudo coexistência no Firebird. `guardas-legado.ts`, `guardas.spec.ts` e as fixtures apagados (ficam no histórico); a guarda de coluna de credencial segue em `guardas:colunas-credencial`. **Lacuna:** não há verificador de gatilho no MariaDB (regra 2 do AGENTS.md); fica para decisão. | retirado |
| conector:mapa | a | Sem mudança. | verde |
| sem-coexistencia | a | No `conector/`, "sistema antigo" descreve a origem no mapa (regra 1): não conta lá; os demais padrões valem. `apps/api/src/modulos/cirurgia/tipos.ts` (2) e `tools/instalacao/src/liberacao-propria.ts` (1) entraram na linha de base como **pendência da F2.4**. | verde |
| instalacao:gerar --conferir | a | Regerado (`deploy/ubuntu/sante.env.modelo` sem as variáveis do Firebird; `docs/implantacao/anexos/variaveis.md`). Volta a ficar desatualizado se a F2.4 mudar variável lida pelo código: regerar no commit dela. | verde |
| conferencia:verificar, pentest:verificar | b | `tools/assinatura` do legado (registro de conferência e pentest da coexistência) não veio. | retirado |
| datamart:verificar, textos-de-produto, combos | a | Sem mudança. | verde |
| implantacao:listas --conferir | a | Regerado (28 migrações faltavam no anexo). | verde |
| implantacao:manual --conferir | b | O manual de implantação do legado (Firebird, ondas) não veio; o do produto próprio volta à esteira quando for escrito. | retirado |
| sbis:verificar --executar | e2 | Vale (certificação SBIS). 49 evidências e 13 testes da matriz apontam para `packages/legado` e testes que não vieram; a troca por testes do produto (ou criação deles) é em `apps/`/`packages/`. | etapa 2 |
| permissoes:verificar (retrato) | e2 | Vale. 4 achados `acao-sem-auditoria` em `apps/api` (onboarding e domínios); `permissoes.ts` está em edição por outra trilha. | etapa 2 |
| matriz:verificar | b | Matriz de cobertura das 1.503 tabelas do legado (`tools/matriz`, não veio); a cobertura da origem é do `conector:mapa`. | retirado |
| POL-4 (nada fora do repositório, logs do npm) | a | Sem mudança. | verde no CI anterior |

## Testes dos projetos de `tools/` (nx test)

| Teste | Decisão | Estado |
|---|---|---|
| `fatiar-dominios.spec.ts` | b: testava `planejamento/crud/ferramentas/fatiar-catalogo.mjs` do legado, que não veio; apagado | retirado |
| `sem-pessoal.spec.ts`, `treino.spec.ts` | a: lista de colunas pessoais como fixture | verde |
| `imutabilidade.spec.ts` (lista gerada em dia) | a: pulado sem a matriz de cobertura do legado, como o próprio `imutabilidade:gerar` já faz | verde; o caso de DELETE clínico é e2 |
| `manual.spec.ts` (manual do repositório) | a: pulado enquanto o manual não existir; as regras seguem provadas pelo manual mínimo | verde |
| `permissoes.spec.ts`, `privilegios.spec.ts` (dois projetos), `sbis-ngs.spec.ts` | e2: o vermelho vem do código de `apps/`/`packages/` (ação sem auditoria, DELETE em tabela clínica na recepção, evidências que não vieram) | etapa 2 |
| `instalacao:lint` | e2: `liberacao-ligar-tudo.ts` importa `apps/api` por caminho; o catálogo de operações tem de ir para um pacote | etapa 2 |

Os scripts de `package.json` que apontam para `tools/assinatura`, `tools/matriz` e `tools/schema-check` (inexistentes) não
estão na esteira; a limpeza deles fica para quando o dono decidir o que do legado volta.

## Passos seguintes do `ci.yml`

| Passo | Decisão | Estado |
|---|---|---|
| fronteiras:provar | a | Fixtures trocadas: `web-importa-nucleo` (web não importa a infraestrutura) e `api-importa-driver-banco` (api não importa o driver do MariaDB). A prova "sem fixture" depende do `nx lint` de `apps/web` e `apps/api` (etapa 2). |
| ambiente:verificar | a | verde (local). |
| e2e @M00 | a | Chrome há na VM; a API e o worker não compilam (`esquemaHhmm` não exportado por `packages/contratos/src/agenda/entradas.ts`, trilha F2.4): etapa 2. |
| seguranca:verificar | a / decisão | gitleaks do histórico verde. Na árvore local, `dump/` (dados reais) e `certs/` passam a entrar vazios (ignorados pelo git, regra 5); resta 1 achado em `docs/obra/fatias/f24/saida/04-pep-1.json` (não versionado, de outra trilha). Vermelhos: Semgrep 9 altos (6 em apps/packages; 3 em tools são falso positivo de `node_password` por `PASSO` e um regex em teste), OSV/Trivy com dependências a atualizar (vue-i18n e @intlify 11.4.12 → 11.4.14, fast-uri, fastify 5.12.5, glob, minimatch) e Dockerfiles sem `USER` (`conector/`, `deploy/ubuntu/ensaio/`). Atualizar o lockfile ou aprovar exceção (`excecoes.json` exige o dono) é decisão do orquestrador. |
