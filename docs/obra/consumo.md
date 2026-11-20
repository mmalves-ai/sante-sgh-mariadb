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
