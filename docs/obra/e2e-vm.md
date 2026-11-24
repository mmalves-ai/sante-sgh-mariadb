# E2E de um marco na VM

Comando único (2026-11-24):

```bash
tools/obra/e2e-vm.sh --grep @M00                              # um marco
tools/obra/e2e-vm.sh prontuario.spec.ts -g "médico: Ctrl.K"   # um spec (PEP: abrir o paciente)
tools/obra/e2e-vm.sh --commit <ref> --portas 5393:3393 --grep @M20
```

Não rode sob `flock` por fora: o script já pega o `sante-sgh-dados/obra/pesado.lock` e espera `MIN_GB` livres
(padrão 10) antes de subir. Durante a rodada, um vigia encerra o E2E (o grupo de processos dele, nunca a carga) se o
livre cair abaixo de `PARAR_GB` (padrão 5): o vigia da carga real derruba a carga abaixo de 2,5 GB, e o E2E sai antes.
Encerrado assim, a saída é 3 e a última linha diz `VERMELHO (encerrado por memória...; nada provado)`. Cada processo
Node da árvore tem o teto de heap `NODE_HEAP_MB` (padrão 2048).

Só entra o que está commitado, como no CI. A saída é o código do Playwright. O log fica em
`sante-sgh-dados/obra/e2e-vm/ultimo.log` e a última linha diz `resultado VERDE` ou `VERMELHO`.

## O que ele faz

1. Monta uma árvore própria do commit em `sante-sgh-dados/obra/e2e-vm/arvore` com `git worktree`, sem `.env` e
   sem arquivo não versionado. A árvore é reaproveitada entre rodadas, e `--remover` a apaga no fim.
2. Reinstala pelo lockfile usando a store da pasta de trabalho (hardlinks, sem baixar nada).
3. Escolhe o primeiro par de portas livre entre `5391:3391` e `5398:3398`, ou usa o que `--portas` pedir. Nunca
   usa 3300/5300 (dev) nem 3310/5310 (painel).
4. Roda o Playwright com o ambiente mínimo do job do `ci.yml` (`AMBIENTE=ci`, `SGH_NUCLEO_SEM_BANCO=1`, sem nada
   herdado da sessão), mais o que só a VM precisa: `E2E_PORTAS` e `E2E_WORKER=completo`.

O `playwright.config.ts` então sobe a API e a web dessa árvore nas portas de teste e, à parte, o worker **completo**
(todos os serviços, com o mesmo ambiente da API), como o `pnpm dev` do `ci.yml`. As filas levam o prefixo próprio
`sgh-e2e<porta>` sobre o Valkey (63718) e o Mailpit (1325) de loopback, então nenhum worker do dono as consome. A única
diferença de topologia para o GitHub é o worker rodar como outro processo, e não dentro do mesmo `nx run-many`.

Sem `E2E_WORKER=completo` (um worktree com o dev do dono no ar, M34), o worker é o reduzido: só `relatorio-envio,email`.
Nesse modo, um spec que dependa de outra fila não prova o que o CI prova.

### Valores padrão do ambiente

A API e o worker recebem `AMBIENTE=ci`, `REDE_PADRAO=rede-e2e`, `ESTABELECIMENTOS=pc,hs` e `API_MODULOS=todos` **só
quando a chave falta no processo e no arquivo de ambiente** (`SGH_ARQUIVO_AMBIENTE` ou o `.env` da raiz), pela mesma
regra do núcleo (`ambienteEfetivo`: o processo sobre o arquivo). Com um `.env` que traga a chave, vale o `.env`.

- Sem `ESTABELECIMENTOS`, a tela de entrada mostra só "Nenhum estabelecimento disponível".
- Sem `API_MODULOS`, a API sobe só a base (sessão, autorização, sistema). Toda rota de módulo responde 404, e a tela
  mostra "Não encontrado". Era a causa do PEP do @M15 vermelho na árvore limpa (2026-11-24).

## Causa do "E2E @M00 vermelho" (22/11)

- **Causa medida.** O log `sante-sgh-dados/obra/ci2/e1/05-e2e.log` mostra que a API do E2E saía na partida com
  `AMBIENTE ausente ou desconhecido`. A árvore limpa não tem `.env`. O web ficava no ar e o Playwright esperava 240 s
  por um `/api/saude` que nunca respondia (`ECONNREFUSED 127.0.0.1:3391`). A porta não estava ocupada, e o build da
  API levava 1,3 s.
- **Correção no config.** Foi feita em `a36d5e7c`: o webServer passa `AMBIENTE=ci` e `REDE_PADRAO` sintética quando
  faltam.
- **Por que não rodar na pasta de trabalho.** O `api:serve` depende do `api:build`, que esvazia e regrava
  `apps/api/dist`. É desse dist que a API do painel (3310) carrega os módulos sob demanda. Além disso, o `.env` da
  pasta seria lido pela API do E2E. Daí a árvore própria.

## Fonte dos dados

O E2E roda sobre a fonte sintética, como no GitHub: portas em memória e sessão sintética. Ele não lê nem grava o
banco `plataforma` nem um cliente da VM. Os `.int.spec` cobrem o caminho contra o MariaDB, em clientes de teste.
