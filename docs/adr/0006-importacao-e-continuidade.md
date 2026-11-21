# ADR 0006: a importação é continuidade, não arquivo histórico

- **Data:** 2026-11-21
- **Situação:** aceita (decisão do dono, no chat da obra)

## Decisão

Importar de um sistema de origem é **continuar a operação do hospital no sistema novo**. Todo dado que o hospital usa
entra **vivo e utilizável** no modelo próprio. Não existe "acervo morto" nem "arquivo histórico somente leitura".

## Regras para o conector

1. **Sem descarte por julgamento do agente.** As causas `sem_valor`, `duplicado` e `mecanismo_do_produto` deixam de
   bastar sozinhas. Só não se copia uma tabela quando a **mesma informação continua disponível e utilizável** no sistema
   novo, e isso tem de ser **provado pela conciliação**:
   - derivado recalculado: o valor recalculado bate linha a linha com a origem;
   - mecanismo do produto: o estado é carregado no mecanismo novo (ex.: a numeração de documentos continua do último
     número usado, nunca reinicia).

   Toda tabela que não carrega fica listada no relatório de conciliação, com a prova.
2. **Rascunhos (evolução, alergia e outros registros clínicos não finalizados) entram como rascunho.**
   - A cópia da origem é um retrato num instante, então o que estava em edição precisa continuar editável.
   - O rascunho volta para o **autor** no sistema novo, com a situação "rascunho" e a data original.
   - O autor (ou quem tiver a permissão) pode **finalizar** ou **apagar**, com trilha de auditoria.
   - Rascunho não aparece como registro finalizado do prontuário.
3. **Tabela licenciada padrão não vem do conector** (dono, 2026-11-21, revisão desta mesma data).
   - Itens como Simpro, Brasíndice, CBHPM e CEP fazem parte do **espelho padrão da base**: o conjunto de catálogos de
     referência do produto, mantido pela plataforma e versionado por edição.
   - Todo cliente, inclusive os novos, recebe esse espelho no "criar novo cliente" e nas atualizações de edição.
   - A licença é condição comercial; a Rede Santé a possui.
   - O conector só **liga** as referências do hospital ao espelho, pelo código e pela edição. Não copia o conteúdo
     licenciado da origem.
   - Preço e tabela **próprios do hospital** (tabelas negociadas, personalizações) são dado do cliente e entram pelo
     conector.
4. **Catálogo oficial do hospital é copiado e fica útil.**
   - O espelho padrão da base (oficiais por carregador versionado da fonte oficial, mais os licenciados) continua
     sendo a referência.
   - O conteúdo de catálogo que vem da origem do hospital também entra:
     - códigos que existem na fonte oficial são ligados a ela pelo código;
     - versões antigas, códigos locais e personalizações do hospital entram como itens do próprio hospital, ativos e
       utilizáveis;
     - nada do que o hospital usava fica de fora.

## Consequências

- Os 287 descartes da F4 (16,9 milhões de registros, 8,7% da origem) são **revistos todos** por esta regra numa rodada
  própria do conector (rodada 5, "continuidade"), antes da carga completa da ProntoCardio.
- O modelo ganha:
  - a situação "rascunho" nos registros clínicos que ainda não a têm;
  - os itens de catálogo do próprio hospital.
- A plataforma ganha o **espelho padrão da base**: carregadores versionados para os licenciados, ao lado dos
  oficiais. O "criar novo cliente" e a atualização de edição levam o espelho a cada cliente.
- A regra 7 do AGENTS.md muda: o licenciado padrão faz parte da base do produto, pelo espelho, e nunca pelo conector.
