# Protocolo de otimização de tokens e relatórios periódicos (regra obrigatória do projeto, 2026-11-20)

Replicado do `new-sgh` (`planejamento/obra/protocolo-tokens.md`, 18/11/2026) por ordem do dono, adaptado a este
projeto.

**Quando vale:** em toda tarefa longa, em qualquer chat ou ferramenta. Tarefa longa é workflow, subagentes,
construção ou correção de mais de cerca de 30 minutos.

**Ao começar, avise o dono com a frase exata:**
**"Rodando sob o protocolo de otimização de tokens e reports periódicos"**.

**Em todo relatório no chat** durante uma orquestração com subagentes, o **cabeçalho** é:
**"Orquestrando com otimização do uso de tokens"**.

## Por quê

No `new-sgh`, a medição de 18/11/2026 mostrou para onde iam os tokens:

- **Total:** 2,1 bilhões de tokens.
- **Sessões longas:** 94% do consumo. Cada turno relia um contexto de 400 a 700 mil tokens, com custo
  quadrático.
- **Plano inteiro relido:** cada agente lia o arquivo completo do plano (337 KB).

Evitar a leitura de contexto em duplicidade reduz o consumo em até 2/3.

## Regras para orquestrar

1. **Fatias preparadas antes, por script.**
   - Cada agente recebe **só a sua fatia**, num arquivo pequeno em `docs/obra/fatias/<tarefa>/`. Nunca o
     plano inteiro nem a base inteira.
   - As fatias são geradas por script determinístico, não por agente.
   - Documentos grandes (matrizes, catálogos completos) são lidos só por `grep` do trecho.
2. **Brief comum curto num arquivo** (`docs/obra/fatias/<tarefa>/brief.md`).
   - O prompt de cada agente **cita o arquivo**. Não repete o texto.
   - O prompt traz só o que é específico do agente: qual fatia e qual arquivo de saída.
3. **Saídas longas sempre em arquivo.**
   - O agente grava o resultado em arquivo e devolve ao orquestrador **só um resumo estruturado e
     pequeno** (contagens, avisos).
   - Logs, testes, builds e diffs também vão para arquivo; leia só o resumo e as falhas com `tail` ou `grep`.
   - Não releia arquivo inteiro: use `grep -n` e `sed -n` no trecho.
4. **Versão compacta para consulta.** Quando todos precisam consultar a mesma referência (por exemplo, o
   catálogo de tabelas), gere uma versão compacta só com as colunas essenciais. O detalhe é buscado por
   `grep` na versão completa.
5. **Sessões curtas.**
   - Cada sessão de construir ou corrigir faz **uma** parte, grava a passagem (`docs/obra/passagens/<id>.md`,
     até cerca de 60 linhas) e termina.
   - A próxima sessão começa limpa, pela passagem.
   - Correções em lotes de até cerca de 6 achados por sessão.
6. **Sem subagentes dentro de subagentes.**
7. **Conferência determinística primeiro.** Cobertura, contagem e consistência de nomes são feitas por
   script. Agentes só verificam o que exige julgamento, por amostra e com lente adversarial. Etapas curtas e
   independentes (revisão por lente, verificação de achado) continuam, porque são baratas e dão a qualidade.
8. **Ao retomar depois de uma parada,** não refaça o que já está gravado em arquivo. O workflow retoma do
   cache.

## Melhorias de 2026-11-20 (crítica feita na rodada 2 da análise)

9. **Fatiar pelo eixo da consulta, não pela ordem alfabética.** Se cada agente precisa da mesma referência
   inteira (por exemplo, o catálogo completo), a duplicidade volta. Na rodada 2, 45 agentes leram o
   catálogo compacto inteiro porque os lotes eram alfabéticos. Pré-classifique primeiro, por script ou com
   um agente barato, no mesmo eixo da referência (por exemplo, módulo). Assim cada agente recebe só a fatia
   da referência que lhe interessa.
10. **Poucos turnos por agente.** O custo de um agente cresce com o número de turnos, porque cada turno relê
    o contexto acumulado. Por isso:
    - o agente lê a fatia uma vez e produz a saída com **um script** ou em uma ou duas gravações;
    - nada de ler em pedaços pequenos nem de gravar linha a linha;
    - o prompt diz isso explicitamente.
11. **Esforço por etapa.** Etapas mecânicas (integrar, rodar script, completar linhas faltantes) usam
    `effort: 'low'`. O esforço alto fica para julgamento: mapear, verificar adversarialmente, desenhar o
    modelo.
12. **Nunca bifurcar o contexto do orquestrador.** Subagente do tipo *fork* herda a conversa inteira e a
    relê. Para trabalho pesado, use sempre agente novo com o brief em arquivo.
13. **O orquestrador também economiza.**
    - Leia só o resumo estruturado e o `tail`/`grep` do que importa.
    - Nunca carregue no chat o resultado inteiro de um workflow nem um arquivo de achados completo: filtre
      por script antes, por gravidade ou por grupo.
    - Prefira contagens a listas.
14. **Medir para provar.** Cada workflow registra em `docs/obra/consumo.md` estes dados, que permitem
    comparar com a linha de base e provar a redução:
    - data e tarefa;
    - número de agentes;
    - tokens de subagentes;
    - duração;
    - o que mudou no protocolo.

## Relatório periódico ao dono

**Frequência:** a cada 50 minutos enquanto a tarefa longa durar, e o primeiro no início.

**Conteúdo:**

- **Cabeçalho:** "Orquestrando com otimização do uso de tokens".
- **Tarefas em execução,** em termos da área hospitalar. Por exemplo: "mapeando as tabelas de faturamento
  SUS", não só o código do pacote.
- **Por tarefa:** nível de completude (%) e tempo estimado até terminar.
- **Geral:** completude (%) e previsão de término (data e hora).
- **Fonte dos números:** o diário do workflow e os arquivos gravados. Estimativas são ditas como estimativas.
