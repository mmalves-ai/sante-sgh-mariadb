# Inventário do modelo base trazido do new-sgh (F0.2)

- **Commit de partida:** `d3f8b5d` (`fase0` = `main` do repositório `mmalves-ai/sante-sgh`, conferido em 2026-11-20).
- **Forma da cópia:** `git archive d3f8b5d`, só leitura no new-sgh, extraído numa pasta isolada e copiado para cá
  em 2026-11-20.
- **Volume trazido:**
  - TypeScript fora de teste: 644202 linhas;
  - 1693 arquivos de teste.

## O que veio

| Caminho | Conteúdo |
|---|---|
| `apps/api`, `apps/web`, `apps/worker` | API NestJS, telas Vue 3 e worker |
| `packages/dominio-*` (30), `contratos`, `ui`, `testes` | Domínios, contratos Zod, componentes e massa de teste |
| `tools/` (verificadores, fachada, formularios, implantacao, instalacao, contabil) | Ferramentas da esteira e da implantação |
| `infra/`, `deploy/`, `patches/`, `pnpm/`, `.githooks`, `.github` | Infraestrutura, deploy, wrapper do pnpm e ganchos |
| Raiz | Nx, pnpm, TypeScript, ESLint, Prettier, Vitest, `.env.example` |
| `referencias/legado-nucleo/` | Núcleo de infraestrutura do antigo `packages/legado`, **fora da compilação**. É a fonte da F2.1 |
| `referencias/assinaturas-legado/` | Capturas de assinatura das operações, base dos contratos de efeito. **Fora do git:** são regeneráveis |
| `referencias/AGENTS-new-sgh.md` | Regras do new-sgh, só para consulta. **Não valem aqui** |

## O que ficou de fora

- `packages/legado` (36,9 MB): adaptador do SPDATA. Aqui, só o conector fala com o SPDATA.
- `treinamento/`, `marketing/`, `planejamento/`, `docs/`, `entrevistas/`, `respostas/`.
- `tools/assinatura`, `tools/matriz`, `tools/schema-check`: ferramentas que só fazem sentido sobre o
  Firebird.

## Estado

- **986 arquivos ainda importam `@sgh/legado`.** A troca por `packages/nucleo` e pelas portas neutras é a
  F2.1 e a F2.2. Até lá, a esteira não compila.
- **Dependências ainda não instaladas** (`./pnpm install`). A instalação fica para a F2.1, quando houver o
  que compilar.
- `infra/firebird/` e partes de `tools/verificadores` são da coexistência. Serão removidas na F2.2.
