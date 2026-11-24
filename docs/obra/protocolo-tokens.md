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

## Regras padrão de economia sem perda de qualidade (dono, 2026-11-20)

Vieram da análise de consumo de 2026-11-20 (`docs/obra/consumo.md`). Medido até ali:

- **Orquestrador:** uma única sessão de 640 turnos, cada turno relendo um contexto que só crescia. Foi o maior
  consumidor.
- **Subagentes:** 25,5 milhões de tokens no total.
- **Ferramentas:** cerca de 19 chamadas por agente.

15. **Sessão contínua do orquestrador** (dono, 2026-11-23; substitui "sessão curta de 150 turnos").
    - Começa pela `RETOMADA.md` e pelo `ESTADO.md` e segue até o dono mandar recomeçar em outro chat.
    - A cada bloco fechado: passagem e commit (para o caso de recomeço), sem pedir chat novo.
    - Medido em 23/11: recomeçar a cada 150 turnos economizava de 5 a 8% do gasto total.
    - **Efeito na qualidade:** nenhum, ou positivo (o contexto enorme dilui a atenção).
16. **Poucos turnos do orquestrador.**
    - Verificação por script com saída compacta.
    - Status só no relatório de 50 minutos.
    - Resultado grande nunca entra no chat inteiro.
    - **Proteção:** a conferência final por script não muda.
17. **Prefixo comum idêntico.**
    - O brief vai no início do prompt, igual palavra por palavra em todos os agentes; a parte variável (lote,
      arquivo de saída) vai no fim.
    - Isso substitui "citar o arquivo do brief" quando o mesmo brief serve a muitos agentes: repetir texto
      idêntico no prefixo é barato (cache), e ler por ferramenta não é.
    - **Efeito na qualidade:** zero, porque o conteúdo é o mesmo.
18. **Fatia autossuficiente e autoconferência em um comando.**
    - A fatia traz, já extraído por script, o que o agente buscaria (campos dos contratos, DDL relacionado).
    - A autoconferência é um único comando que devolve "ok" ou os erros.
    - O agente gera a saída com um script, numa chamada.
    - **Proteção:** o orquestrador confere 2 ou 3 fatias antes de lançar a rodada (se o extrator errar, todos
      os agentes recebem o erro), e o agente pode usar grep se faltar algo.
19. **Reprocessar só o que mudou.**
    - A correção vai só ao lote afetado.
    - O validador global roda sempre sobre tudo e pega qualquer regressão.

**Não adotado:** modelo mais leve em etapas mecânicas (decisão do dono, 2026-11-20). Todos os agentes usam o
modelo da sessão.

**Mantidos sempre:** conferência determinística, verificação adversarial, amostra no início da rodada e
conferência final independente.

**Prova:** cada rodada registra em `docs/obra/consumo.md` o custo e o resultado da conferência. Se a qualidade
cair, a regra que causou é desfeita.

## Relatório periódico ao dono

**Frequência:** a cada 50 minutos enquanto a tarefa longa durar, e o primeiro no início.

**Conteúdo:**

- **Cabeçalho:** "Orquestrando com otimização do uso de tokens".
- **Tarefas em execução,** em termos da área hospitalar. Por exemplo: "mapeando as tabelas de faturamento
  SUS", não só o código do pacote.
- **Por tarefa:** nível de completude (%) e tempo estimado até terminar.
- **Geral:** completude (%) e previsão de término (data e hora).
- **Fonte dos números:** o diário do workflow e os arquivos gravados. Estimativas são ditas como estimativas.

**A cada etapa (dono, 2026-11-20),** o relatório tem estas 4 seções, nesta ordem:

1. **Etapa atual:** a fase e o marco (por exemplo, "F2.1, núcleo").
2. **O que foi construído:** o que ficou pronto desde o relatório anterior, com a prova.
3. **O que está em andamento:** cada tarefa, com % e tempo estimado.
4. **Próximas etapas e o que falta:** o que vem em seguida e o que falta para completar o sistema.

**Sem parar até completar o sistema** (dono, 2026-11-20). Fechada uma etapa, a próxima é lançada em seguida.
Só se para por bloqueio real (decisão do dono, disco abaixo de 100 GB ou pausa pedida). A sessão é contínua: só
se recomeça em outro chat quando o dono mandar (2026-11-23).

**Termos da área da saúde (dono, 2026-11-20).** Nos relatórios, todo termo técnico ou sigla da área médica
ou hospitalar vem explicado em poucas palavras no primeiro uso. Exemplos: CID, CBO, SIGTAP, TUSS, TISS, CNES,
AIH, BPA, OPME.

## Regras 20 a 22 (2026-11-21, medição da F2.2)

**O que a medição mostrou:**

| Agente | Custo equivalente por agente | Turnos por agente |
|---|---|---|
| Construtor da F2.2 | 9,5 milhões | 256 |
| Revisor | 1,25 milhão | 64 |
| Corretor | 1,9 milhão | 84 |
| Rodadas anteriores | 0,9 a 1,5 milhão | — |

- **Causa:** cada turno grava um arquivo ou roda uma compilação e relê o contexto acumulado. O custo cresce de
  forma quadrática.
- **Cache:** funcionou, com 99% do contexto lido do cache. O problema era o número de turnos.

20. **Construtor em blocos.**
    - Lê de uma vez os trechos de todos os arquivos do lote.
    - Grava vários arquivos numa só chamada, por script.
    - Roda a autoconferência no máximo 3 vezes.
    - Meta: até cerca de 80 turnos.
21. **Teto com continuação.** Passou de cerca de 100 turnos:
    - o construtor grava o que fez e devolve a lista exata do que falta;
    - o corretor continua com contexto limpo.

    Nada se perde.
22. **Lotes de no máximo cerca de 20 arquivos.** No fatiador, `LOTE_MAX` caiu de 40 para 20.

**Mantidos:** revisão adversarial em todo lote, conferência estrita na integração e conferência final
independente.

## Economia no relatório (dono, 2026-11-21)

A economia de tokens sem perda de qualidade é **obrigatória e contínua**. O orquestrador mede, analisa a
estratégia e a melhora quando os números pedirem.

**Todo relatório de 50 minutos traz uma seção "Economia",** gerada por `tools/obra/medir_consumo.py`, com:
- custo equivalente por agente e por papel (construir, revisar, corrigir, integrar);
- turnos por agente;
- **% em relação à linha de base sem a regra nova** (construtor da F2.2 antes das regras 20 a 22: 9,51 M e
  256 turnos);
- o efeito na qualidade: achados graves por lote e a integração na primeira tentativa.

**O relatório também traz:**
- completude geral e por etapa, em %;
- previsão de término;
- trabalhos feitos desde o último relatório, com detalhes.

23. **Meta de completude verificada desde o início** (2026-11-21, conector rodada 1).
    - A primeira rodada das fatias do conector foi barata (cerca de 1,2 M por fatia), mas carregou só 34% das
      tabelas, porque cada agente podia "bloquear com motivo".
    - Toda rodada nasce com:
      - o **verificador de completude** (por exemplo, `cobertura_conector.py --falhar-se-bloqueada`, ou o
        contador de 501 da F2.4) rodando na autoconferência do lote e no integrador;
      - a regra "decida pela melhor prática e registre para o dono", em vez de "bloqueie".
    - **Retrabalho evitado é a maior economia.**

24. **Bloqueio compartilhado se resolve antes das fatias** (2026-11-21, conector rodada 3).
    - Quando a causa do bloqueio está em código compartilhado (motor) ou no modelo (DDL), a mudança é aplicada
      **primeiro**, por um agente sozinho e em sequência. Só **depois** as fatias são refeitas.
    - Refazer fatias que dependem de mudança compartilhada não aplicada desperdiça a rodada inteira: na volta 2
      da rodada 3 foram cerca de 18 agentes e 13 M sem avanço.
    - O conferidor pode aplicar o compartilhado restante quando está sozinho.
