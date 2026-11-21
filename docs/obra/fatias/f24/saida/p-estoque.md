# F2.4, 3ª etapa: lote p-estoque (estoque no banco próprio) — PARCIAL

## O que mudou
- **`suprimentos/porta-propria.ts`: a porta do estoque está inteira no banco próprio.** Saiu toda recusa
  `modelo-pendente` do arquivo (dívida do arquivo: 0).
  - **29 leituras:**
    - itens: busca e ficha do item, posição mensal;
    - documentos: lista e detalhe, com lotes e devolvido;
    - requisições pendentes, rastreio do lote, lotes do paciente;
    - consumo do mês e consumo mensal por item, quantidade em pedido;
    - compras: pedidos e pedido com propostas e escolhas, histórico de compras;
    - fechamentos e recálculos;
    - usuário: parâmetros, escopo, usuários do estoque;
    - fornecedores, terceiros, prestadores;
    - kits, kit e kits padrão;
    - estoque inicial, envios de transferência e envio, pontos de pedido.

    Todas são restritas ao estabelecimento da sessão.
  - **7 gravações diretas:**
    - aprovação do pedido por alçada, com segregação: quem fez o pedido não o aprova;
    - transferência: envio, cancelamento e divergência;
    - conferência do carrinho;
    - ponto de pedido em `parametro_reposicao`;
    - autorização da requisição.
  - **15 operações pelo Executor, com trilha e idempotência:**
    - saída, que atende a requisição quando vem nela;
    - devolução;
    - requisição;
    - transferência direta ou pelo recebimento do envio;
    - nota de entrada;
    - compra: pedido com cotação, proposta e vencedor;
    - movimento direto;
    - balanço do inventário;
    - fechamento e reabertura do mês;
    - reposição do kit;
    - desconsolidação da nota;
    - saneamento da validade.

    `podeGravar` consulta a liberação do executor.
- **Um motor de movimento comum** (`movimentar`) grava, numa transação:
  - o saldo do item, com o custo médio na entrada;
  - o saldo do lote;
  - o movimento, com o saldo e o custo depois;
  - os lotes do movimento.

  A saída nunca deixa saldo negativo.
- **`operacoes.ts`:** saiu a lista de operações pendentes. Fica só `modeloPendente`, que o OPME e a manipulação ainda
  usam.
- **Testes:**
  - spec novo `porta-propria-estoque.int.spec.ts`, com 6 casos de contrato de efeito, recusas e isolamento;
  - `porta-propria.int.spec.ts` ajustado: o escopo real substituiu o `null` da pendência, e o OPME na saída recusa;
  - massa de `massa-propria.spec-util.ts` com o catálogo do estoque, a numeração, as permissões por local, os
    fornecedores, o lote suspeito e o carrinho, e a limpeza das tabelas novas.
  - No cliente `f24p_estoque`: 13 arquivos, 75 testes verdes e 2 falhas fora do lote (ver avisos).

## Decisões pela melhor prática (para o dono ver)
1. **Chave do documento = número de negócio no estabelecimento + mês do movimento.** O contrato da tela ainda manda
   `{ano, mes, doc}`. A porta resolve pelo número (único por estabelecimento) e confere o mês. A troca para id de
   ponta a ponta é o pedido de contrato.
2. **Saída de item rastreável sem lote escolhido: sai o lote que vence primeiro.** Nunca sai lote vencido, bloqueado
   ou em quarentena. Com lote escolhido, vale a regra do domínio (`conferirLotesSaida`).
3. **A devolução volta pelo custo e pelos lotes da saída.** Ela aponta o movimento que desfaz
   (`estorno_movimento_estoque_id`) e não passa do que saiu.
4. **O envio de transferência é o próprio documento de transferência em aberto.**
   - O saldo só sai da origem no recebimento.
   - O que não chegou fica na origem, e o envio aparece como divergente.
   - O cancelamento não move saldo.
5. **O pedido de compra nasce com a cotação aos fornecedores convidados, e é preciso ao menos um.** O pedido guarda o
   primeiro fornecedor; o preço do item vem da vencedora.
   - O valor para a alçada vem das vencedoras, ou, sem cotação, dos itens.
   - Quem fez o pedido não aprova.
6. **Autorizar a requisição é de quem atende o local dela** (`pode_atender`). Os tipos de movimento do escopo vêm
   das permissões de `local_estoque_usuario`.
7. **O fechamento do mês grava a posição de cada saldo no fim do mês** (saldo de hoje menos o que se moveu depois), com
   as entradas e as saídas do mês. A reabertura guarda o motivo e o autor.
8. **Balanço com sobra e falta gera dois documentos de acerto,** com o motivo "inventario" do catálogo. O inventário
   aponta o primeiro (há pedido de DDL).
9. **Catálogo ausente recusa com código, nunca grava pela metade.** Vale para o tipo de movimento, o tipo de entrada,
   o motivo de ajuste e a numeração.
10. Outras regras:
    - a desconsolidação vale só para a nota e devolve a nota à conferência;
    - a correção de validade guarda a validade original e recusa lote repetido;
    - o destino 1 e o 3 (paciente internado ou externo) são a mesma saída a paciente;
    - "baixa a confirmar" (origem B) grava como saída manual.

## Pedidos (detalhe em `p-estoque.json`)
- **Rodada do OPME e da manipulação.** Ainda devolvem `modelo-pendente`:
  - `opme-porta-propria.ts:9`;
  - `manipulacao-porta-propria.ts:11`;
  - `operacoes.ts:63`.
- **Contrato do estoque por id e com vocabulário neutro, de ponta a ponta.**
- **DDL:**
  - tipo `balanco` no documento;
  - item de origem da devolução;
  - fornecedor nulo no pedido em cotação;
  - `pode_autorizar_requisicao`, opcional.
- **Criar cliente:** semear o catálogo e a numeração do estoque.

## Falta (dívida restante do módulo)
- modelo-pendente:
  - `suprimentos/opme-porta-propria.ts` (9);
  - `suprimentos/manipulacao-porta-propria.ts` (11);
  - `suprimentos/operacoes.ts` (63).

## Correção dos achados da revisão (2026-11-21)
- **Movimento direto:** devolve o documento de estoque criado pela saída (`id`, `ano`, `mes`, `doc`); o atendimento vai
  em campo próprio. A trilha e o evento apontam o documento certo, e não há mais `?? 0`.
- **Desconsolidação da nota:** o estorno tira o valor que a nota pôs no estoque (`valorSaida` no motor, com o custo
  médio recalculado), não o custo médio de hoje. Na mesma transação, a quantidade recebida volta no item do pedido de
  compra, e o pedido volta a `parcialmente_recebido`, ou a `enviado`/`aprovado` quando nada mais foi recebido. Teste:
  o custo médio volta ao de antes da nota.
- **Fechamento do mês:** o custo da posição é o do fim do mês, não o de hoje. A ordem de busca é:
  - sem movimento depois, o de hoje;
  - senão, o do último movimento até o mês;
  - senão, o do fechamento anterior;
  - senão, o de antes do primeiro movimento posterior (desfeito pelo saldo e custo que ele gravou).

  Sem nenhum desses e com saldo, a operação recusa com `custo-do-mes-indisponivel`, em vez de inventar um custo.
- **Devolução:** confere por lote o que saiu menos o que já voltou desse lote (`devolucao-lote-acima`).
- **Balanço:** a sobra de item que controla lote recusa com `sobra-sem-lote`, porque a contagem do inventário não
  guarda o lote (pedido de DDL abaixo). O teste agora cobre a recusa da sobra e o balanço de falta.
- **Teste do OPME na saída:** a entrada agora é válida pelo esquema, o teste exige `modelo-pendente` e confere que
  nada foi gravado.

- **Desconsolidação repetida (2ª revisão):** a nota reconsolidada e desconsolidada de novo só estorna as entradas que
  ainda não foram estornadas (antes, estornava de novo as entradas da consolidação anterior).
- Conferência (2ª revisão): 76 de 77 testes verdes no cliente `f24p_estoque`. A falha é de `licitacao-documento`
  (PDF/A), fora do lote. A dívida restante é `operacoes.ts:63`, pendente de OPME e manipulação.

### Decisões pela melhor prática
- O pedido desconsolidado sem nada recebido volta a `enviado` se tinha data de envio ao fornecedor, ou a `aprovado` se
  não tinha.
- Quando a sobra não tem lote, o balanço recusa, em vez de entrar sem lote. Assim, o saldo do item e a soma dos lotes
  não divergem.

### Pendente (rodada própria)
- **Chave por id de ponta a ponta:** a porta ainda resolve o documento pelo número e pelo mês. Isso depende do pedido
  `contrato`.
- **Portas de OPME e de manipulação:** dependem do pedido `rodada`.
- **Porta em memória:** `porta-memoria.ts` ainda devolve `id: atendimento` no movimento direto. O arquivo está fora do
  lote.
