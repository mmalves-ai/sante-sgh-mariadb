# RETOMADA: pausa pedida pelo dono (2026-11-21, 10h50)

**Motivo da pausa:** consumo de tokens alto por falha de orquestração. Foram cerca de 1,4 bilhão equivalentes
desde a retomada, dos quais cerca de 600 a 700 M eram evitáveis. Análise abaixo e em `docs/obra/consumo.md`.

Leia este arquivo primeiro. Depois o `docs/ESTADO.md`, o `AGENTS.md` e o protocolo de tokens (regras 1 a 24).

## Regra nova do dono para retomar

**Nada é lançado sem orçamento aprovado.**
- Todo workflow com estimativa acima de **50 M equivalentes** vai antes ao dono, com a estimativa e o porquê.
- Ordem obrigatória:
  1. mudança compartilhada (motor ou modelo) primeiro, num agente sequencial;
  2. fatias uma vez só, com o verificador de completude ativo;
  3. conferência.
- Lotes de cerca de 15 arquivos, com roteiro fixo de turnos.
- O revisor lê só o diff, e o corretor recebe só os achados.
- Teto: se o gasto passar 30% acima da estimativa, o workflow para e o orquestrador reporta.

## Estado

| Trilha | Onde parou | Onde está o trabalho |
|---|---|---|
| F2.2/F2.3 | Ondas 1 a 5c integradas em `main`. **Onda 5d não integrada**: lotes 05-12, 05-15 e 05-17 (worker contábil, raiz e relatórios) | Branch **`f22-onda5d-wip`** (`6bc9831`, também no GitHub). Em `main` restam 32 arquivos com o legado, que são exatamente os da 5d |
| F4 conector | Rodada 4: primeiro agente (pedidos de motor) com commit. Faltam os pedidos de modelo, as fatias restantes, a conferência, o L9 (Sincronizar) e o L10 (conciliação) | Branch **`f4-conector`** (`b521a64`, no GitHub; worktree `../sante-sgh-wt/f4`). Cobertura: **836 carregam, 285 descarte, 64 bloqueadas** de 1.185 |
| Painel | No ar com o conector da rodada 2 (`main`, `ff19cc8`) | Web 5310 e API 3310; o worker do conector segue rodando |

## Primeiro passo da próxima sessão

1. **Fechar a F2.2:**
   - mescle `f22-onda5d-wip` no `main`;
   - rode a integração da 5d com um agente só: conferidor estrito dos 3 lotes, tsc, vitest, `contar-legado` = 0
     e commit;
   - estimativa: 3 a 5 M.
2. **Trazer ao dono os planos com orçamento,** antes de lançar:
   - **F4 restante:** modelo, 64 bloqueadas, L9 e L10;
   - **F2.4,** a dívida: 360 pedidos, cerca de 77 arquivos com 501 ou "modelo-pendente", contratos no vocabulário
     antigo, licitação e sementes do `criar_cliente`;
   - a lista curta de decisões de modelo para o dono aprovar.

## Pendências do dono

- Segundo fator no login do administrador da plataforma (recomendado: sim).
- Revisar `docs/obra/passagens/F4-decisoes-destino.md` (no branch `f4-conector`).
- Criar a ProntoCardio no painel e importar, quando quiser.

## Ambiente

- MariaDB `127.0.0.1:3410`.
- Web `https://192.168.0.104:5310`.
- API `127.0.0.1:3310`: `API_MODULOS=todos tools/dev/subir-login.sh`.
- Worker do conector: `conector/conector.sh worker`.
- Disco: cerca de 231 GB livres.
- O vigia de disco e o temporizador de relatório foram parados na pausa.
