# Orçamento: f24-portas2

estimativa_M: 32
teto_M: 42

- **Objetivo:** zerar os 24 arquivos que ainda recusam com "aguardando modelo" depois das portas, que fecharam verdes
  em `f4bea06`.
- **O que bloqueia:** cerca de 31 pedidos de DDL e um punhado de contratos e códigos compartilhados, todos em
  `docs/obra/fatias/f24/saida/p-*.json`. Exemplos:
  - a chave do documento de estoque virar id;
  - a etapa coordenada do SADT;
  - o gravador do repasse;
  - as sementes.
- **Ordem:**
  1. Compartilhado 1: DDL e sementes.
  2. Compartilhado 2: contratos e código comum.
  3. 5 lotes de 2 módulos:
     - qualidade;
     - pessoas;
     - suprimentos e farmácia;
     - operadora e preços;
     - SADT, SUS, manutenção, especialidades, nutrição e enfermagem.
  4. Conferidor com commit.
- **Economia (lições de 21/11):** teto de 60 turnos com troca de agente, saída de teste resumida e leitura só das
  linhas necessárias. Lotes de 2 módulos.
- **Agentes por papel:**

  | Papel | Agentes | Custo por agente | Total |
  |---|---|---|---|
  | Compartilhado | 2 | 4,5 M | 9 M |
  | Construtor | 5 | 2,0 M | 10 M |
  | Revisor | 5 | 0,3 M | 1,5 M |
  | Corretor | 5 | 0,5 M | 2,5 M |
  | Conferidor | 1 | 3,5 M | 3,5 M |

- **Estimativa:** 26,5 × 1,2 ≈ 32 M. Teto: 42 M. `LIMITE_AGENTES` = 20 (sem retomada: se faltar, sai script novo só
  com o resto).
