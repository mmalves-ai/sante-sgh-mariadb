# F2.4, 3ª etapa, lote p-folha (folha: interface externa, integração com o financeiro)

## O que mudou
- **Lotes da folha externa** (`folha/porta-folha-propria.ts`): sem nenhum `modelo-pendente`.
  - Leitura e gravação em `lote_folha_intercambio` e `lote_folha_intercambio_resumo`, pelo Executor (trilha na mesma
    transação): número do lote, inclusão do exportado e do retorno, troca de situação pela situação esperada e pela
    versão, resumo por rubrica e as leituras (`lotes`, `lote`, `competenciaLancada`).
  - Recusas: número repetido, retorno de exportado inexistente, empresa de fora da sessão, situação mudada
    (`desatualizado`) e resumo repetido do mesmo colaborador.
- **Integração da folha com o financeiro** (`folha/porta-integracao-propria.ts`): sem nenhum `modelo-pendente`.
  - O lançamento dos títulos (`financeiro.criarTituloPagar`, ação `incluir-folha`) é uma operação do Executor. Na
    mesma transação ela grava:
    - cada título a pagar, pelo `gravadorTituloPagar` do financeiro (mesmas validações);
    - o lançamento (`lancamento_titulos_folha`);
    - os títulos da folha (`titulo_folha`);
    - os fatos contábeis (`fato_contabil`);
    - na origem `interface`, o retorno marcado como `lancado`.
  - Recusas: soma divergente, empresa de fora, retorno não conferido, folha repetida e competência da folha inexistente.
  - Leituras ligadas: `retorno` (lote recebido somado por rubrica), `lancamentos`, `lancamento`, `lancamentoDaOrigem`,
    `titulosDoLancamento`, `chavesLancadas` e `custoPessoal`.
  - Conta contábil sugerida do destino gravada em `conta_contabil_id` e relida.
  - O aviso de títulos manuais passou a ignorar os títulos lançados pela folha (`titulo_folha`).
- **Testes** (cliente `f24p_folha`):
  - `porta-folha-propria.int.spec.ts` (novo): 2 de 2;
  - `porta-integracao-lancamento.int.spec.ts` (novo, sobre a massa do financeiro): 3 de 3;
  - `porta-integracao-propria.spec.ts` e `.int.spec.ts`: os casos "recusa modelo-pendente" viraram casos de efeito e de
    recusa;
  - `aplicacao/folha.int.spec.ts`: só o caso dos lotes, que chamava a assinatura antiga e não compilava.
  - Resultado: 21 arquivos de spec da pasta `folha`, todos verdes, com 1 exceção. O `aplicacao/folha.int.spec.ts` falha
    no preparo da massa do cliente novo (`uq_sexo_sigla`), antes de chegar aos casos.
- No cliente `f24p_folha` entraram uma linha sintética de `tipo_vinculo_trabalho` e uma de `categoria_trabalhador`.
  São catálogos sem carregador, como o 03-pessoas já tinha feito no cliente dele.
- `tsc` de `apps/api`: 0 erros.

## Decisões pela melhor prática (para o dono ver)
1. **Número do lote:** o `id` do contrato é o número de negócio por estabelecimento (`numero`, sequência
   `lote_folha_intercambio`). O id interno não sai da porta. O lote exportado e a origem do lançamento são traduzidos
   do número para a chave. Assim o contrato e o serviço não mudam.
2. **Competência da folha do lote:** o lote só é ligado à `competencia_folha` quando o mês tem uma única folha. No
   lançamento, vale a do lote ou, na falta dela, a do período. A apuração anual cai em dezembro. Sem competência, o
   lançamento é recusado (`competencia-folha-inexistente`), nunca gravado sem ela.
3. **Fatos contábeis da folha:** usam o evento `folha`, o mesmo tipo de fato do contábil. Se faltar, o evento nativo é
   criado, como o contábil faz. A natureza (provento ou encargo), a rotina e a sequência vão em `campos`. O fato que
   não contabiliza é gravado como `ignorado`, e o custo de pessoal soma os dois. A competência contábil é o mês da
   emissão.
4. **Valores:** o contrato está em centavos, e o banco em reais (DECIMAL). A porta converte nos dois sentidos.
5. **Série do título:** `DP` no líquido e `IMP` nos encargos, como diz o comentário do contrato. O `titulo` lido é a
   parcela (a mesma chave que a baixa usa), e `pago` vale quando todas as parcelas estão pagas.
6. **Conta contábil sugerida:** é a conta analítica ativa do plano contábil vigente no início do de-para, achada pelo
   código reduzido ou pela classificação. Se não achar nenhuma ou achar mais de uma, a gravação é recusada. O grupo de
   consolidação do plano não é filtrado (ver pedido).

## O que falta (ok=false)
| Arquivo | Dívida | Situação |
|---|---|---|
| `folha/porta-calculo-propria.ts:13,101,248` | processamento da folha (11 leituras e o gravador), férias, rescisão e obrigações | O DDL v3 já cabe. Falta construir a porta, que não coube nesta etapa: próxima volta do lote |
| `escala/porta-realizado-propria.ts:18,53,420` | lançamento e estorno do plantão realizado no repasse | Pedido: gravador do repasse sobre a transação (ver `.json`) |
| `banco-apoio.ts:95` | auxiliar `modeloPendente` | Ainda é usado por `pessoas/porta-propria.ts` e `autoatendimento/porta-propria.ts`, que são de outros lotes |

## Correção dos achados da revisão (2ª volta)
- **Unidade dos valores da folha externa no banco:** o resumo por rubrica (`lote_folha_intercambio_resumo.valor`) e a
  soma do lote recebido (`lote_folha_intercambio.soma`) passam a ser gravados em **reais** (DECIMAL), como o lançamento,
  os títulos da folha e os fatos contábeis. O contrato segue em centavos inteiros; a porta converte na ida (`reais`) e
  na volta (`centavos`), inclusive no `retorno` da integração. Antes ficavam 100 vezes o valor real no banco.
- **Decisão (para o dono ver):** a coluna `soma` guarda, pelo `sentido`, reais no recebido (líquido mais encargos) e
  minutos no exportado (ponto mais plantão). Foi mantida uma coluna só, com a unidade documentada na porta; pedido de
  DDL para deixar isso explícito no comentário da coluna (ou separar em duas colunas) em `p-folha.json`.
- **Testes de efeito no banco** (cliente `f24p_folha`, 7 de 7 verdes):
  - `porta-folha-propria.int.spec.ts`: releitura do resumo em centavos e conferência crua das linhas (soma 1234
    minutos e 1234,50 reais; resumo 100,25 e 80,00) e da trilha (uma por gravação).
  - `porta-integracao-lancamento.int.spec.ts`: resumo em reais no banco; no lançamento, linhas cruas de
    `lancamento_titulos_folha` (totais em reais, usuário), `titulo_folha` com `titulo_pagar` e `parcela_pagar`,
    `fato_contabil` com `evento_contabil` (valor, centro, natureza, situação) e trilha; caso novo da recusa
    `folha-repetida` (outro retorno conferido da mesma competência), sem gravar nada e sem deixar a marca `lancado`.
- O achado de "sem teste de efeito" era parcial: os casos de lançamento e de lotes já existiam em
  `porta-integracao-lancamento.int.spec.ts` e `porta-folha-propria.int.spec.ts` (não no `.int.spec.ts` da integração
  nem no `aplicacao/folha.int.spec.ts`); faltavam a leitura crua, a trilha e a `folha-repetida`, agora cobertas.
