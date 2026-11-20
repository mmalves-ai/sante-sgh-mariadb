# tools/verificadores

Verificadores da esteira local (M00). Executados direto pelo Node 24 (TypeScript com remoção de tipos),
sem build.

| Arquivo | Comando | O que faz |
|---|---|---|
| `src/verificar.ts` | `pnpm verificar`, `pnpm verificar:tudo` | portões em sequência e resumo, com os marcadores PENDENTE listados |
| `src/segredos.ts` | `pnpm verificadores:segredos` | valor em `DB_*`, `FB_*_SENHA`, `*_SENHA`, `*_SEGREDO` em arquivo versionado; `.env` da raiz × `env-raiz.json` |
| `src/env-raiz.ts` | (usado pelo anterior) | só `stat` do `.env` (permissão, tamanho, data); o conteúdo nunca é lido |
| `src/pendentes.ts`, `src/pendente.ts` | marcadores `PENDENTE: Mnn` | comandos de marcos futuros; saem com 0 e nunca contam como verde |
| `src/provar-fronteiras.ts` | `pnpm fronteiras:provar` | com `fixtures/web-importa-legado.ts.txt`, `nx lint` precisa falhar; sem ela, verde |
| `src/e2e.ts` | `pnpm e2e -- --grep @Mnn` | Playwright + axe-core no Google Chrome da VM |
| `src/instalar-gancho.ts` | `prepare` do `pnpm install` | `core.hooksPath=.githooks` (gitleaks + ESLint no pre-commit) |
| `seguranca/verificar.sh` | `pnpm seguranca:verificar` | gitleaks, Semgrep, OSV-Scanner, Trivy e Syft por Docker (tags fixas), repositório só leitura, `.env*` mascarados |

`env-raiz.json` guarda só os três metadados do `.env` registrados no início do M00
(`stat -c '%a %s %Y' .env`).
