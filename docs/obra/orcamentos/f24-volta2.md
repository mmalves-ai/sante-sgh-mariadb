# Orçamento: f24-volta2

estimativa_M: 52
teto_M: 68

- **Por que existe (análise do estouro da 1ª volta, `f24-divida`):**
  - A 1ª volta gastou 100,6 M, contra 97 M estimados e teto de 126 M.
  - Parou no `LIMITE_AGENTES` (75) antes do conferidor, com a dívida em 186 arquivos (eram 574).
  - **Causa:** os lotes descobriram estrutura de banco que faltava depois da etapa compartilhada. Eles pediram por
    escrito, corretamente, porque é mudança compartilhada. As permissões dependiam da etapa final prevista no padrão
    aprovado (ADR 0007, item 8).
  - Com isso, 23 dos 24 corretores rodaram tentando zerar o que só a etapa compartilhada resolve.
  - Somando as duas voltas, a F2.4 fica em cerca de 150 M, uns 20% acima do teto original.
- **Otimização aplicada:**
  1. Toda mudança compartilhada vai primeiro, em sequência: lint e testes, DDL pedido e etapa das permissões.
  2. Os lotes recebem a lista exata do DDL aplicado e tocam só os arquivos que ainda têm dívida (reprocessar só o que
     mudou).
  3. O corretor só roda com achado alto ou médio. Lote "não ok" só por dívida declarada vai direto para o conferidor.
- **Objetivo e critério de pronto:**
  - `divida_f24.py --falhar-se-pendente` passa;
  - tsc, lint dos arquivos alterados e vitest de api, worker, web, contratos e núcleo passam;
  - `validar_migracoes.py` dá 0 erros;
  - commit feito.
- **Agentes por papel:**

  | Papel | Agentes | Custo por agente | Total |
  |---|---|---|---|
  | Compartilhado (lint e testes, DDL, permissões) | 3 | 4,5 M | 13,5 M |
  | Refatiar | 1 | 0,1 M | 0,1 M |
  | Construtor | cerca de 8 | 1,8 M | 14,4 M |
  | Revisor | cerca de 8 | 0,5 M | 4 M |
  | Corretor | cerca de 5 | 0,8 M | 4 M |
  | Conferidor | 2 | 3,5 M | 7 M |

- **Estimativa:** 43 × 1,2 ≈ 52 M. Teto: 68 M. `LIMITE_AGENTES` = 30.
- **Fora do escopo:** a CI etapa 2 (formatação geral, dependências, verificador de gatilhos), que vem logo depois.
