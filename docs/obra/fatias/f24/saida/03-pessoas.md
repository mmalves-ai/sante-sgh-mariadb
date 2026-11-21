# F2.4, 2ª volta, lote 03-pessoas

## O que mudou
- **Avaliação de desempenho** (`avaliacao/porta-propria.ts`): sem nenhum `modelo-pendente`.
  - Competências do estabelecimento (`competencia_avaliacao`): incluir, alterar, ativar ou inativar com motivo, excluir.
  - Ligação ao cargo (`cargo_competencia`).
  - Abertura da avaliação, com avaliador, cargo e marco de experiência.
  - Correção por versão nova (`avaliacao_anterior_id`, `motivo_correcao`), com as notas copiadas.
  - Quem finalizou e a ciência gravados nas colunas novas.
  - Motivo da situação do ciclo.
  - PDI, o plano de desenvolvimento individual (`plano_desenvolvimento`), com a conclusão do curso lida do treinamento.
  - Teste de integração: o caso "aguarda o modelo" virou o caso de efeito, com competências, abertura, notas, correção,
    PDI e as recusas (10 de 10 no `f24_03pessoas`).
  - A limpeza da massa passou a apagar PDI, correções, ligações, competências e os critérios criados.
- **eSocial** (`esocial/porta-esocial-propria.ts`):
  - lote e evento no ambiente `coletor`;
  - operação do evento de tabela (`operacao_tabela`) e data de referência (`data_referencia`), gravadas e lidas;
  - conferência da conciliação gravada (`conferencia_eventos_esocial` e `_item`) e relida em `ultimaConciliacao`.
  - Teste de integração com os casos novos: 17 de 17.

## Decisões pela melhor prática (para o dono ver)
1. **Nota da competência:** ao abrir a avaliação, cada competência vira o critério `competencia-<id>` do modelo do
   ciclo, criado na mesma transação se faltar. A nota segue por critério, como o modelo prevê.
   - A leitura devolve a competência.
   - Item antigo sem competência é lido pelo próprio critério.
2. **Número da versão da avaliação:** `numero_versao` grava o próximo livre do grupo da chave única. O número mostrado é
   a profundidade da cadeia de correções. Há pedido de DDL para a chave contar o marco de 45 e 90 dias.
3. **Exclusão do rascunho de correção:** solta a anterior (`avaliacao_anterior_id` volta a nulo, e o retrato fica na
   trilha). Sem isso, a chave única impediria corrigir de novo.
4. **Religar a competência ao cargo:** reaproveita a linha desligada. A chave única conta a excluída.
5. **Nome reservado:** o nome da competência excluída continua reservado no estabelecimento, como já vale no ciclo.
6. **Situação da linha da conferência do eSocial:** é guardada resumida (conciliada, divergente ou sem transmissor),
   como o CHECK do banco pede.
   - O serviço só relê a quantidade externa.
   - A divergência detalhada é recalculada a cada consulta.
7. **Transmissor:** o da tela (`sante`) é gravado como `sistema`.

## O que falta (dívida restante do lote, com pedido em `03-pessoas.json`)

| Arquivo | Dívida | Bloqueio |
|---|---|---|
| `esocial/porta-esocial-propria.ts` | parâmetros do empregador e ficha do vínculo | DDL do de-para de afastamento e DDL da ficha |
| `folha/porta-calculo-propria.ts` | 20 leituras e gravação do cálculo | DDL aplicado; falta a porta (3ª volta) |
| `folha/porta-integracao-propria.ts`, `servico-integracao.ts` | integração folha × financeiro | DDL v2 aplicado; falta a porta (3ª volta) |
| `folha/porta-folha-propria.ts` | lotes da folha externa | situação `substituido` e número do lote (DDL) |
| `escala/porta-realizado-propria.ts` | lançamento e estorno no repasse | gravador do repasse (faturamento) |
| `sesmt/porta-sesmt-propria.ts` | leitura do dosímetro e exposição | contrato tipo + id (pedido do 02-pessoas-2) |
| `autoatendimento/porta-propria.ts` | efeito da aprovação | composição do módulo (pedido do 01-pessoas-1) |
| `banco-apoio.ts` | auxiliar `modeloPendente` | uso em `pessoas/porta-propria.ts`, de outro lote |

## Correção da revisão (situação da linha da conciliação do eSocial)
- O banco só guarda o resumo da situação da linha (conciliada, divergente, sem transmissor). A leitura inventava
  `dois-transmissores` para toda linha divergente. Agora a linha conciliada e a sem transmissor voltam como foram
  conferidas, e a conferência com linha divergente **recusa com `modelo-pendente`** na releitura, dizendo o que fica
  indisponível. A gravação segue (as contagens são o fato conferido).
- **Decisão pela melhor prática:** não recalcular a situação pelas contagens guardadas, porque ela depende da decisão
  do transmissor e da mesma raiz, que não ficam na linha. O rótulo da linha é o nome do tipo de evento no catálogo
  (o mesmo que o domínio usa), então não precisa de coluna.
- Pedido de DDL: o CHECK de `conferencia_eventos_esocial_item.situacao` passa a aceitar as 6 situações do contrato.
- Teste de ida e volta: conciliado e sem transmissor relidos exatos; as 4 divergentes gravam e recusam na releitura.

## 3ª volta (folha: cálculo e integração com o financeiro)

### O que mudou
- **Integração da folha com o financeiro** (`folha/porta-integracao-propria.ts`):
  - o de-para por vigência é lido e gravado em `integracao_folha_financeiro` e `_destino`, pela gravação direta do
    executor, com a trilha;
  - a classificação é achada pelos códigos numéricos do grupo, do subgrupo e do item, e a ambígua ou inexistente é recusada;
  - o credor tem de ser fornecedor ativo, e a vigência repetida é recusada;
  - a liberação nega só o lançamento dos títulos, que segue recusando com `modelo-pendente`.
- **Serviço da integração** (`folha/servico-integracao.ts`): saiu o desvio que tratava a falta do de-para como "sem
  de-para vigente". Agora a falha de leitura sobe. O arquivo zerou a dívida.
- **Cálculo da folha** (`folha/porta-calculo-propria.ts`): a gravação foi ligada, com `podeGravar` verdadeiro.
  - Vigência do salário em `historico_salarial`, com o adicional conferido contra o risco da função.
  - Parâmetros da folha por vigência em `parametro_folha`, lidos e gravados.
  - Fechamento do período em `fechamento_periodo_folha`: leitura com filtros, trava do vigente, inclusão e reabertura
    pela versão.
  - O que depende do processamento (cálculo, férias, rescisão e obrigações) recusa dentro do gravador, sem gravar
    nada.
- **Testes:**
  - `porta-calculo-propria.int.spec.ts` (novo, 5 casos): salário, parâmetros, fechamento e reabertura, e a recusa do
    processamento;
  - `porta-integracao-propria.int.spec.ts` ganhou o caso do de-para, com gravação, releitura e as três recusas;
  - a unidade do dublê cobre a leitura do de-para e a liberação.

### Decisões pela melhor prática (para o dono ver)
1. **Motivo do salário:** a tela manda texto livre, e o modelo guarda um código. Grava-se o código `outro`, com o texto
   em `dados.justificativa`. A leitura devolve o texto, e a linha vinda de outra origem devolve o código.
2. **Adicional do salário:** o adicional vem do laudo, ou seja, do risco da função. A vigência nova com adicional
   diferente do laudo é recusada (`adicional-diverge-do-laudo`).
   - Com direito aos dois adicionais, a escolha do empregado vai em `adicional_escolhido`, e a leitura a respeita.
   - Sem escolha, vale a periculosidade.
3. **Destino `outro`:** o banco aceita o destino `outro`, mas o contrato não tem esse valor. Ele não entra no de-para
   lido pela tela.
4. **Processamento:** a gravação não foi ligada sobre o DDL aplicado, porque perderia dado. Faltam a situação
   substituída, a contagem fora da folha, as datas da tabela legal e dos parâmetros, e a unidade e a memória da linha.
   O pedido de correção está no `.json`.

### O que falta
| Arquivo | Bloqueio |
|---|---|
| `folha/porta-calculo-propria.ts` | correção do DDL do processamento (pedido); depois, férias e rescisão ligam por ele; obrigações a conferir |
| `folha/porta-integracao-propria.ts` | gravador do título a pagar do financeiro (composição) e coluna da conta contábil sugerida (DDL) |
| `folha/porta-folha-propria.ts`, `esocial/`, `escala/`, `sesmt/`, `autoatendimento/`, `banco-apoio.ts` | sem mudança: os mesmos bloqueios da 2ª volta |
