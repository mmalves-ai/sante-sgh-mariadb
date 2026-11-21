# F2.4, 3ª etapa: lote p2-suprimentos-farmacia (OPME e manipulação no banco próprio)

## O que mudou
- **`suprimentos/opme-porta-propria.ts`: a porta do OPME no banco próprio.**
  - Leituras reais, todas restritas ao estabelecimento da sessão: solicitações (por agendamento, por período e por id),
    consumos (por agendamento, período, id e pela chave do pedido), local da saída, pedido e nota das etapas,
    fornecedores de OPME, itens com saldo e lotes, rastreio reverso (expostos e saídas do lote) e itens da conta.
  - Gravação da solicitação e das etapas (cotação, autorização, negativa, cancelamento) pelo Executor, com trilha,
    evento e idempotência pela chave da tela (`idempotencia_operacao`).
  - `executar` e `podeGravar` usam a operação do estoque (`registrarSaida`, `registrarDevolucao`).
- **`suprimentos/manipulacao-porta-propria.ts`: a porta da manipulação no banco próprio.**
  - Leituras: fila de itens a manipular, ordens, ordem e vínculos do login com o CBO (Classificação Brasileira de
    Ocupações).
  - Gravações pelo Executor: abertura (com o insumo e o lote) e dupla conferência
    (`conferencia_manipulacao`). A baixa do insumo vai pela saída do estoque.
- **`suprimentos/porta-propria.ts`:** a saída com `opme` grava o `consumo_opme` ligado ao movimento. A saída com
  `manipulacao` liga o movimento ao insumo da ordem e passa a ordem a baixada. A devolução com `opme` volta pelos lotes
  da saída e marca o consumo devolvido. As 5 tabelas entraram na lista do executor.
- **Testes** (cliente `f24q_suprimentosfarmacia`):
  - novo `opme-manipulacao-propria.int.spec.ts`, com contrato de efeito, recusas e isolamento;
  - `opme-porta-propria.int.spec.ts` e `porta-propria.int.spec.ts` ajustados: a recusa pendente virou leitura real.
  - Resultado: unitários de suprimentos 52 de 52 verdes; integração da pasta 26 de 27 verdes. A falha é
    `licitacao-documento` (PDF/A), que fica fora do lote e já falhava antes.

## Decisões pela melhor prática (para o dono ver)
1. **A solicitação é cabeçalho com item.** O contrato da tela é o item 1. O TUSS (terminologia de procedimentos da
   saúde suplementar) fica em `codigo_referencia`.
   - O médico vem do cirurgião do agendamento. A fonte pagadora vem do agendamento ou do atendimento.
   - Sem médico ou sem fonte pagadora, a gravação recusa.
2. **As etapas lidas vêm dos registros reais:** a solicitação, a resposta da operadora (`autorizacao_opme`), o
   consumo, a devolução e o cancelamento. Não há histórico paralelo.
3. **O fabricante do consumo tem de estar no cadastro.** Se não estiver, a saída recusa com
   `fabricante-nao-cadastrado`.
4. **A sala gravada no consumo é a do agendamento,** que deve ser do estabelecimento da sessão. A sala mandada pela
   tela não vale.
5. **O consumo sem autorização mantém a situação da solicitação,** mas a versão muda. O consumo autorizado marca o
   item e a solicitação como utilizados.
6. **A devolução do OPME volta pelos lotes da saída,** sem a tela escolher. O consumo devolvido por inteiro passa a
   `devolvido`.
7. **Arranjo provisório, até sair a coluna pedida:**
   - a guia da operadora fica na 1ª linha da observação da resposta;
   - a dose da ordem fica na observação da ordem.
8. **Dupla conferência:** quem preparou a ordem não confere, nem o mesmo usuário nem o mesmo profissional. A ordem
   reprovada guarda o motivo.

## Pedidos (detalhe em `p2-suprimentos-farmacia.json`)
- **DDL:**
  - `solicitacao_opme_etapa`, para as etapas de pedido, consignação, esterilização e nota fiscal. Hoje essas etapas
    recusam com `modelo-pendente`;
  - `consumo_opme.modelo`: hoje o consumo com modelo recusa com `modelo-pendente`;
  - `autorizacao_opme.numero_guia`;
  - `ordem_manipulacao.dose`.
- **Numeração:** `solicitacao_opme` e `ordem_manipulacao` em `configurar_numeracoes.py`.

## Dívida restante
- **`suprimentos/operacoes.ts`:** continua com `modeloPendente`, porque ainda há quem o use:
  - as 4 etapas do OPME e o modelo do consumo, que dependem do DDL pedido;
  - o vínculo do pedido de compra ao contrato do fornecedor, em `porta-propria.ts`.
- `api/farmacia` já estava em 0.

## Correção pelos achados da revisão
- **Manipulação:** a avaliação farmacêutica do item devolve em `reg` o atendimento da avaliação
  (`avaliacao_farmaceutica.atendimento_id`), não o id da avaliação. Assim, a ordem aberta pela tela fica no atendimento e
  no paciente certos. O spec novo abre a ordem com `avaliacao(item).reg` e confere o `atendimento_id` e o `paciente_id`
  gravados.
- **OPME, idempotência:** o reenvio da solicitação e da etapa com a mesma chave confere o usuário, o estabelecimento
  (pela solicitação) e o hash do pedido. Se algum divergir, recusa com `idempotencia-divergente`.
  - O hash cobre só o que a tela manda. A hora do pedido da solicitação é do servidor e fica fora. Na etapa, a versão
    vista e a mudança são lidas e também ficam fora.
  - `etapaPelaChave(chave, pedido)` passou a receber o pedido. O controller monta o pedido uma vez e o usa nas duas
    chamadas.
- **Consumo de OPME na saída:** recusa com `agendamento-de-outro-atendimento` quando a cirurgia é de outro atendimento
  ou de outro paciente. Há caso no spec.
- **Spec da saída com OPME de fora:** afirma o código exato, `atendimento-inexistente`, com ids que não existem.
