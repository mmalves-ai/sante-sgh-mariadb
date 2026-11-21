# RETOMADA (2026-11-21, troca de conta da LLM; obra pausada a pedido do dono)

**Ao ouvir "retomar", siga esta ordem, sem pular etapas:**

1. Leia este arquivo, o `AGENTS.md` (em especial "Orquestração com orçamento") e
   `docs/obra/plano-orquestracao.md`.
2. Confira que o guardião está instalado: `.claude/settings.json` tem o gancho de `Workflow|Agent` apontando
   para `tools/obra/guardiao.py`.
   - O arquivo é local e fica fora do git.
   - Se faltar, avise o dono.
3. Avise o dono: "Rodando sob o protocolo de otimização de tokens e reports periódicos". Ligue o vigia de disco
   (`tools/obra/vigia-disco.sh 130`, em segundo plano) e o relatório de 50 minutos (com a seção Economia, os termos
   da saúde explicados e as 4 seções).
4. Comece pelo **passo 1 da fila** abaixo.

## Regras que o dono reforçou (não esquecer)

- **O orçamento é meu.** O dono **não aprova** orçamento de tokens. Eu estimo, gravo em
  `docs/obra/orcamentos/<id>.md` (`estimativa_M` e `teto_M`), executo, meço com `tools/obra/medir_consumo.py`,
  otimizo quando passar do teto e presto contas no relatório.
- Toda orquestração passa pelo guardião, regras G1 a G5:
  - `// ORCAMENTO: <id>`;
  - `PREFIXO` idêntico em todas as chamadas;
  - `LIMITE_AGENTES` com o invólucro `chamar(...)`;
  - brief ou regras de economia no prefixo;
  - `ORCAMENTO:` no prompt de subagente avulso.
- Ordem de cada rodada:
  1. mudança compartilhada primeiro, num agente só;
  2. fatias uma vez só, com o verificador de completude;
  3. conferência enxuta.

  Lotes de até cerca de 15 arquivos. O revisor lê só o diff; o corretor recebe só os achados.
- Não parar até completar o sistema. O fluxo do dono é sempre por painel. Produto, não projeto.

## Estado exato na pausa

| Trilha | Estado | Onde |
|---|---|---|
| F2.2/F2.3 (API sobre o MariaDB) | Ondas 1 a 5c integradas. **Onda 5d não integrada** (lotes 05-12, 05-15 e 05-17: worker contábil, raiz e relatórios) | `main`, e o branch **`f22-onda5d-wip`** (`6bc9831`, no GitHub). Em `main` restam 32 arquivos com o legado, exatamente os da 5d |
| F4 (conector) | Rodadas 1 a 3 feitas e o 1º agente da rodada 4 (pedidos de motor) com commit. **Cobertura: 836 carregam, 285 descarte, 64 bloqueadas** de 1.185. Faltam: pedidos de modelo (DDL), fatias com bloqueio, conferência, **L9 Sincronizar** e **L10 conciliação** | Branch **`f4-conector`** (`b521a64`, no GitHub), worktree `../sante-sgh-wt/f4`. `main` tem a rodada 2 (`ff19cc8`) |
| Painel | No ar, com o conector da rodada 2 | Web `https://192.168.0.104:5310`, API `127.0.0.1:3310` (`API_MODULOS=todos tools/dev/subir-login.sh`). Worker: `conector/conector.sh worker` (rodando em segundo plano na sessão antiga; ao retomar, confira com `docker ps`) |

## Fila (em ordem)

1. **Fechar a F2.2.** Orçamento pronto em `docs/obra/orcamentos/f22-onda5d.md` (5 M, teto de 7 M).
   - Mescle `f22-onda5d-wip` no `main`.
   - Lance **um** agente integrador, com o conferidor estrito dos 3 lotes, tsc e vitest da API, do worker e do
     núcleo, e `contar-legado` = 0.
   - Faça o commit.
2. **F4, rodada 4 restante** (escreva o orçamento antes):
   1. pedidos de modelo, num agente sequencial;
   2. as fatias ainda bloqueadas, com `python3 -I tools/obra/cobertura_conector.py` no worktree;
   3. o conferidor;
   4. **L9 Sincronizar**, em que a origem vence e a edição do destino fica guardada e visível;
   5. **L10 relatório de conciliação**;
   6. merge no `main`.
3. **F2.4, a dívida da migração:**
   - os pedidos de DDL não aplicados (arquivados em `docs/obra/fatias/f22/arquivo-ondas-1a4/` e `saida/`);
   - os cerca de 77 arquivos com 501 ou "modelo-pendente";
   - os contratos em vocabulário antigo (HHMM, S/N, `destino: 'legado'`);
   - a licitação;
   - as sementes do `criar_cliente` (domínios básicos).

   Prova: um verificador que conta 501 e "modelo-pendente" até chegar a 0.
4. Lista curta de decisões de produto ou de modelo para o dono (as de F2.4 e as de `F4-decisoes-destino.md`).
5. Depois: F3 (cobertura melhorada), F5 (ferramentas de homologação e virada), F7 (vários hospitais) e F8
   (recursos novos).

## Pendências do dono (decisões de produto, não de orçamento)

- Segundo fator no login do administrador da plataforma (recomendado: sim).
- Revisar `F4-decisoes-destino.md` (no branch `f4-conector`).
- Criar a ProntoCardio no painel e importar, quando quiser.

## Consumo

1,4 bilhão equivalente até a pausa. A análise está em `docs/obra/consumo.md` e as lições, nas regras 20 a 24 e no
plano.
