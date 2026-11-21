# Orçamento: f24-divida

estimativa_M: 97
teto_M: 126

- **Objetivo e critério de pronto:** zerar a dívida da migração, que é a F2.4 da fila da RETOMADA.
  - **Medida na largada (21/11, cerca de 12h20), em 574 arquivos:**
    - `modelo-pendente`: 79 arquivos;
    - vocabulário antigo (HHMM, S/N, `destino: 'legado'`): 85;
    - nome de tabela do sistema de origem no produto (regra 1): 436, sendo 1.045 linhas em comentário e 332 em
      código ou texto.
  - Também entram: os pedidos de DDL arquivados das ondas 1 a 4, a licitação e as sementes do "criar cliente".
  - **Pronto quando:**
    - `divida_f24.py --falhar-se-pendente` passa;
    - `conferir-lote-f24.sh --estrito` dá ok em todos os lotes;
    - tsc e vitest de api, worker, web, contratos e núcleo passam;
    - `validar_migracoes.py` dá 0;
    - o orquestrador faz o commit.
- **Escopo:**
  1. **Compartilhado, em sequência:**
     - `SGH_CLIENTE_TESTE` em todos os testes de integração, feito pelo orquestrador por script, sem agente;
     - agente 1: DDL pendente;
     - agente 2: auxiliares neutros de vocabulário e padrão dos códigos de permissão.
  2. **Refatiar:** um agente de esforço baixo roda o fatiador.
  3. **24 lotes por assunto,** com até cerca de 15 arquivos de código cada. A licitação entra no lote de suprimentos.
  4. **Sementes do "criar cliente":** um agente em paralelo aos lotes, só em `tools/db/` e `db/sementes`.
  5. **Conferidor:** até 2.
- **Agentes por papel:**

  | Papel | Agentes | Custo por agente | Total |
  |---|---|---|---|
  | Compartilhado | 2 | 4,5 M | 9 M |
  | Refatiar | 1 | 0,3 M | 0,3 M |
  | Construtor | 24 | 1,5 M | 36 M |
  | Revisor | 24 | 0,5 M | 12 M |
  | Corretor | cerca de 15 | 0,8 M | 12 M |
  | Sementes | 1 | 2,5 M | 2,5 M |
  | Conferidor | 2 | 3,5 M | 7 M |

- **Estimativa:** 78,8 × 1,2 ≈ 97 M equivalentes. Teto: 126 M. `LIMITE_AGENTES` = 75.
- **Economia:**
  - o brief vai colado no `PREFIXO`;
  - cada fatia já traz as linhas exatas de cada dívida;
  - os assuntos pequenos são empacotados (70 lotes viraram 24);
  - o revisor lê só o diff do lote e o corretor recebe só os achados;
  - os construtores rodam no máximo 6 ao mesmo tempo, por memória: a máquina tem 28 GB livres e cada tsc da API usa
    de 2 a 3 GB.
- **Isolamento (dono, 2026-11-21):** cada lote tem cliente de teste próprio (`f24_<lote>`), e a plataforma tem a trava
  `GET_LOCK`.
- **Fora do escopo:** a F2.4 da ficha (acesso próprio), que é a próxima, e o conector (trilha F4, em paralelo no
  worktree).
- **Riscos:**
  - DDL que a trilha F4 também aplica no worktree. O agente de DDL confere `git diff main...f4-conector -- db/` e não
    duplica; o orquestrador resolve no merge.
  - Um código de permissão renomeado quebra perfil gravado no banco. O agente do padrão define a migração dos dados
    do perfil.
