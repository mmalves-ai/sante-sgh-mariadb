# Consumo de tokens por orquestração

Registro exigido pelo protocolo de tokens (regra 14). Os números vêm do relatório de uso de cada workflow.

| Data | Tarefa | Agentes | Tokens de subagentes | Duração | Por agente | Protocolo |
|---|---|---:|---:|---:|---:|---|
| 2026-11-20 | Avaliação do `new-sgh` para o banco próprio | 6 | 408 mil | 4 min | 68 mil | Antes do protocolo |
| 2026-11-20 | Revisão adversarial do ADR 0001 (3 lentes) | 3 | 147 mil | 2,5 min | 49 mil | Antes do protocolo |
| 2026-11-20 | Análise cruzada, rodada 1 (8 grupos e crítico) | 9 | 2,26 milhões | 29 min | 251 mil | Antes do protocolo: cada agente varreu o TSV do MV e o código do `new-sgh` por conta própria |
| 2026-11-20 | Análise cruzada, rodada 2 (rastreio tabela a tabela) | 75 | 10,13 milhões | 52 min | 135 mil | Regras 1 a 8: fatias por script, brief em arquivo, catálogo compacto, cobertura por script. **Custo por agente 46% menor que na rodada 1, com cerca de 20 vezes mais trabalho.** A conferência do orquestrador foi feita por script, fora dos agentes |
| 2026-11-20 | F1.3 DDL das 3.500 tabelas (87 lotes, validação, reparo) | 94 | 12,57 milhões | 45 min | 134 mil | Fatias por lote com as colunas das origens já recortadas (até 62 KB), brief em arquivo, catálogo por grep, lista de hubs, esforço baixo na validação, amostra conferida no início |

**Meta:** na rodada 2, o custo por agente deve ficar bem abaixo das 251 mil da rodada 1. O volume total de
trabalho (8.867 + 1.503 tabelas, tabela a tabela) é cerca de 20 vezes maior que o da rodada 1.

**Lições da rodada 2:** cada um dos 45 agentes de mapeamento leu o catálogo compacto inteiro (regra 9 nova).
Na próxima rodada, a pré-classificação por módulo deve cortar mais. A conferência por script pegou o que os 9
verificadores adversariais não pegaram: as 150 tabelas fora da paridade estrutural.

**2026-11-20, sessão nova (regras 15 a 19 aplicadas):** carregador do SIGTAP e F2.1 (núcleo), em 2 trilhas,
cada uma com construir, revisão adversarial e correção.
- **Execução:** 6 agentes, 657 mil tokens de subagentes, 21,7 minutos.
- **Custo médio:** 110 mil tokens por agente, contra 134 mil no DDL.
- **Qualidade:**
  - **SIGTAP:** 5 achados médios, todos corrigidos.
  - **Núcleo:** 0 altos e 4 médios, corrigidos.
  - **Conferência final independente:** 72 testes e banco com 0 erros.

**2026-11-20, F2-L (login), 6 lotes em sequência, cada um com construir, revisão adversarial e correção:**
- 18 agentes, 2,51 milhões de tokens (139 mil por agente), 124 minutos.
- **Qualidade:** 4 achados altos e 23 médios, todos corrigidos. Conferência final independente verde.
- **Custo maior que no núcleo:** cada lote precisava medir o fecho de imports de uma API de cerca de 700
  arquivos.

## 2026-11-21: análise do dono, "consumo elevadíssimo" (pausa)

| Trabalho | Agentes | Custo equivalente |
|---|---|---|
| SIGTAP, núcleo, login, conector L1 a L4 | 36 | 52 M |
| F2.2 ondas 1 a 4 | 98 | 363 M |
| F2.2 ondas finais | 158 | 284 M |
| Conector L5 a L8, rodada 1 | 175 | 135 M |
| Conector rodadas 2 e 3 (retrabalho) | 318 | 512 M |
| Orquestrador | — | 48 M |
| **Total** | **cerca de 790** | **cerca de 1,4 bilhão** |

**Evitável: cerca de 600 a 700 M.** Causas:

1. **Conector sem meta de completude desde o início.** A rodada 1 chegou a só 34% e exigiu duas rodadas de
   retrabalho. A rodada 3 refez fatias que dependiam de mudanças compartilhadas ainda não aplicadas
   (regras 23 e 24).
2. **Lotes de 20 a 40 arquivos sem roteiro de turnos** nas ondas 1 e 2 da F2.2: 256 turnos e 9,5 M por
   construtor (regras 20 a 22).
3. **Três agentes por lote, sempre:** o corretor custa quase tanto quanto o construtor.
4. **Workflows lançados sem orçamento aprovado.** Daqui em diante, acima de 50 M, só com aprovação do dono.

## 22/11, 13h a 16h30: verificação pedida pelo dono ("gasto expressivo na última hora")

- **Controles técnicos:** funcionaram. A G6 contou todos os subagentes, abaixo de 60 ferramentas; o LIMITE_AGENTES
  segurou; não houve agente em laço.
- **Medido por hora, custo aproximado pela tabela do Opus 5.5:**

  | Hora | Orquestrador: tokens lidos | Orquestrador | Subagentes |
  |---|---|---|---|
  | 13h | 11,0 M | US$ 4,6 | US$ 1,4 |
  | 14h | 10,5 M | US$ 2,9 | US$ 12,0 |
  | 15h | 12,8 M | US$ 3,3 | US$ 4,9 |
  | 16h, parcial | 7,3 M | US$ 1,7 | US$ 4,4 |

- **Causas, todas de orquestração:**
  1. Sessão do orquestrador com 1.449 turnos, contra a regra de cerca de 150. Cada turno relê cerca de 250 mil tokens
     de contexto.
  2. Três agentes perdidos na queda das 15h, cerca de 5,6 M equivalentes. A queda veio de três medições pesadas
     rodando juntas.
  3. Rodada parada e retomada às 16h15, com um corretor descartado (cerca de 1 M equivalente).
- **Correções:**
  - passagem e sessão nova ao fechar a rodada `liberacao-prontocardio`;
  - mínimo de turnos até lá;
  - trava de execução pesada (`flock`);
  - não parar rodada no meio para reorganizar.

## Noite de 22 para 23/11/2026: rodadas da cadeia da conta (estimado x gasto, medido com medir_consumo.py)

| Rodada | Estimativa | Teto | Gasto | Agentes |
|---|---|---|---|---|
| plano-conta | 4 M | 5,2 M | cerca de 2 M | 1 corretor |
| conta-itens | 10 M | 13 M | 7,0 M | 3 corretores (1,66 M cada), conferidor 1,49 M, 2 revisores (0,27 M cada) |
| conta-itens-2 | 9 M | 12 M | 7,3 M | compartilhado 1,66 M, item 2,69 M, conferidor 1,93 M, 2 revisores (0,51 M cada) |
| deadlock-paralelo | 4 M | 5,2 M | cerca de 1,5 M | 1 corretor em worktree isolado, 1 revisor |
| conta-itens-3 | 6 M | 8 M | 4,8 M | construtor 3,02 M (68% abaixo da base de 9,51 M), revisor 0,73 M, conferidor 1,08 M |
| **Total** | **33 M** | **43,4 M** | **cerca de 22,6 M** | 16 agentes |

- Nenhuma rodada passou do teto; todas abaixo da estimativa.
- **Desperdício da noite:** o ORQUESTRADOR. A sessão passou de 1.950 turnos e 76 M equivalentes, muito acima da regra de
  sessão curta (cerca de 150 turnos). O custo por turno cresce com o contexto. Causa: acompanhar a carga real ao vivo
  na mesma sessão.
- **Aprendido:**
  - verificação por script (diag-cadeia com DIAG_SO_L3=1 em 3 min) pegou 2 defeitos que a suíte sintética não pegava;
  - revisores lendo só o diff custaram 0,27 a 0,73 M e acharam defeitos reais em todas as rodadas;
  - conferidor que espera uma prova de 50 minutos estoura o G6: a prova longa fica com o orquestrador, em segundo
    plano.
