# Orçamento: liberacao-prontocardio

estimativa_M: 30
teto_M: 39

- **Contexto (22/11, 15h20):** a VM caiu por falta de memória às cerca de 15h. Três medições pesadas rodavam ao mesmo
  tempo na cópia real (divisão por faixa, pré-carga de todas as áreas e diagnóstico da cadeia), cada uma com vários
  gravadores. Nenhum agente devolveu resultado. Sobraram:
  - a divisão por faixa no commit 6d24b1c, branch velocidade-carga, sem prova nem revisão;
  - o diagnóstico da cadeia parcial, sem commit (`diag_cadeia.py`, `recorte-nucleo.tsv`, `cli.py`);
  - o script da pré-carga, commitado.
  - A VM agora tem 50 GB.
- **Regra nova (orquestrador):** toda execução pesada (medir-carga, pré-carga, conferir-fatia em lote, suíte do
  conector) passa por `flock sante-sgh-dados/obra/pesado.lock`, uma de cada vez, com no máximo 4 gravadores nas
  medições. Um vigia de memória para os containers do conector abaixo de 6 GB livres.
- **Escopo:** cadeia principal (diagnóstico, correção e prova), divisão por faixa (revisão, correção e prova de
  equivalência) e junção, pré-carga de todas as áreas e correção por área, e conferidor. Depois, a carga real.
- **Agentes por papel:**
  - diagnóstico: 1 × 2,5 M;
  - correções da cadeia: até 2 × 2 M;
  - recusa em massa: 1 × 1,5 M;
  - revisão da faixa: 1 × 0,7 M;
  - correção e prova da faixa: 1 × 2,5 M;
  - pré-carga: 1 × 1,5 M;
  - correções por área: até 4 × 1,3 M;
  - revisões adversariais: 2 × 0,7 M;
  - conferidor: 1 × 2,5 M.
  - Soma 24,8 M × 1,2 = **30 M**; teto 30% acima = **39 M**.
- Os orçamentos carga-nucleo, pre-carga-areas e faixa-carga ficam encerrados nesta rodada; o gasto deles até a
  queda está em `consumo.md`.
