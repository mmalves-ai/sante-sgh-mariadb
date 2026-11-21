# F2.4, 3ª etapa: lote p-operadora-portal-precos (operadora, portal do médico, preços)

## O que foi construído
- **Cobrança da operadora: acordo de inadimplência** (`cobranca-porta.ts`, `cobranca-porta-propria.ts`; serviço e memória
  ajustados à assinatura nova). `registrarAcordo` grava num passo só o acordo (`acordo_inadimplencia`, número pela
  numeração `acordo_inadimplencia` do estabelecimento, criada na primeira vez), as cobranças renegociadas pela versão vista
  (`acordo_inadimplencia_fatura`, com valor, multa e juros) e a fatura passa a `renegociada`. As parcelas apontam o acordo
  (`fatura_plano.acordo_inadimplencia_id`). Leitura: `acordoOrigem`, `parcelas`, `acordoDestino` e `renegociadas(acordo)`.
- **Notificação de inadimplência:** ocorrência aberta do contrato (`ocorrencia_inadimplencia`) criada ou atualizada, e a
  notificação (`notificacao_inadimplencia`: meio, data, dias de atraso, referência no aviso de recebimento). A leitura da
  cobrança traz `notificadoEm`, `notificacaoMeio` e `notificacaoReferencia`. Segunda notificação no mesmo dia recusa
  `notificacao-sem-atraso`.
- **Ressarcimento ao SUS** (`ans-porta-propria.ts`): o aviso gera a cobrança (`cobranca_ressarcimento_sus`) e um atendimento
  por item (`ressarcimento_sus_atendimento`), ligados ao envio e aos itens. **Decisão** por atendimento (impugnar abre a
  impugnação em elaboração; aceitar marca devido e desiste da impugnação aberta; a decisão fica no item). **GRU** paga na
  cobrança. O envio lê aviso, prazo, GRU e pagamento.
- **Portal do médico: troca de senha** pela credencial do usuário da conta (`credencial_usuario`, argon2id) com
  `historico_senha` e o ato `troca_senha`, na mesma transação. `OPERACOES_PENDENTES` ficou vazio.
- **Preços:** campos `uf`, `nfUf` (pela sigla, FK `unidade_federativa`) e `telefone` do contrato do convênio ligados.
- Testes de integração no cliente `f24p_operadoraportalprecos` (catálogo IBGE carregado): 77 de 77 nos specs dos três
  módulos. tsc de apps/api: 0 erros.

## Decisões pela melhor prática (para o dono ver)
1. **Senha do portal do médico = credencial do produto.** A conta do portal usa o usuário dela (`usuario_id`) e a mesma
   credencial, algoritmo (argon2id) e histórico do produto. Conta sem usuário recusa `conta-sem-usuario`. Resumo que não é
   argon2id não chega ao banco.
2. **Acordo num passo só** (o pedido dos lotes 04 e 09): o número só existe com o acordo gravado inteiro; a recusa de uma
   cobrança desfaz tudo. Acordo de uma parcela é `quitacao`; mais de uma, `parcelamento`. Encargos dispensados vão na
   observação com o motivo.
3. **O número do acordo na tela é o número de negócio** (numeração só de dígitos), não o id.
4. **Cobrança notificada é derivada da notificação**, sem tabela de ligação: vencida em aberto no dia do registro, desde o
   primeiro vencimento em aberto da ocorrência. A fase da ocorrência é a do tipo `notificacao` quando o cadastro a tem.
5. **Impugnação do ressarcimento:** o código oficial do motivo na ANS fica vazio; o motivo grava a descrição do contrato e a
   natureza (cadastral → administrativo; cobertura, segmentação, abrangência → técnico). Texto maior que a coluna recusa
   `texto-longo` (nunca é cortado).
6. **GRU registrada uma vez:** a segunda recusa `situacao-nao-permite`.

## Falta (ok=false; pedidos em p-operadora-portal-precos.json)
- `apoio-banco.ts:78` (usado por `operadora/modulo.ts`, fora da lista), `apoio-porta-propria.ts:9,76` (auxiliar das
  recusas restantes: arquivos ADR 0004, portal do prestador, GRU da TPS, identificação do aviso, SIB, SIP, DIOPS,
  monitoramento) e `autorizacao-porta-propria.ts:21` (anexos, ADR 0004).
- `precos/fonte-propria.ts`: cargas de tabela (DDL dos componentes da linha pedido) e os campos do contrato sem coluna.
  Preço por médico não foi tocado (aguarda o dono).

## Correção pelos achados da revisão
- **Notificação de inadimplência (cobranca-porta-propria.ts):** a data que vale é a de emissão (`emitida_em`) em
  tudo: `NOTIFICACAO_DA_FATURA` compara vencimento e pagamento com `DATE(n.emitida_em)` e ordena por ela; `notificar`
  trava as vencidas até `em` (não `hoje`); a notificação grava os dias de atraso na emissão e a ocorrência, os de
  hoje. Emissão futura recusa (`notificacao-data-futura`). Spec novo com `em` dez dias antes de hoje: a cobrança
  vencida entre a emissão e hoje não é alcançada.
- **Troca de senha do portal (portal-medico/porta-propria.ts):** a porta recebe só o resumo, então não confere reuso;
  o comentário que dizia "a mesma política do produto" foi corrigido. Pedidos no `.json`: conferência de reuso no
  serviço/porta (fora da lista) e `acessoPorId` do sadt ligado à `credencial_usuario`.

## Correção pelos achados da revisão
- Contato por área do convênio (`precos/fonte-propria.ts`, OP_CONTRATO): o achado partia de exclusão lógica, mas
  `tx.excluir` do Executor apaga a linha (DELETE), então limpar e preencher de novo não quebrava. Mesmo assim a chave
  única (fonte pagadora, área) não considera `excluido_em`: a linha excluída logicamente por outro caminho (importação)
  agora é lida e reativada (`excluido_em`/`excluido_por` nulos) no lugar de nova inclusão. Comentário corrigido. Teste
  int: área esvaziada volta a ter contato, e linha excluída logicamente é reativada.
- Publicação da carga em duas transações (controller + servico, fora do lote): pedido em
  `p-operadora-portal-precos.json` (tipo codigo-compartilhado).
