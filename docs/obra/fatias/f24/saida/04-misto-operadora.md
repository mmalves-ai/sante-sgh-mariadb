# F2.4, 2ª volta: lote 04-misto-operadora (operadora, qualidade, contabilidade do worker)

## O que mudou
- **Produto do plano (`operadora/porta-propria.ts`):** grava e lê a operadora dona (`produto_plano.operadora_saude_id`) e a
  natureza (`plano` ou `cartao_desconto`). Saíram as duas recusas `modelo-pendente` (cartão de desconto e produto de operadora
  que não é a principal). Spec de integração atualizado: cartão de desconto gravado, produto da segunda operadora lido como
  dela, troca de dona recusada.
- **Protocolo de atendimento ao beneficiário (`operadora/atendimento-porta-propria.ts`):** registro (instância, natureza,
  classe, canal, assunto, NIP, urgência, tipo de prazo, pedido de resposta por escrito), interação, prorrogação do prazo,
  pedido e envio da resposta por escrito e reanálise (protocolo novo que aponta o anterior) ligados ao modelo. A leitura
  passa a devolver esses campos, a conclusão, as reanálises, o vencido pela prorrogação e o total de respostas por escrito
  pendentes. Spec de integração novo cobre o fluxo inteiro.

## Decisões pela melhor prática (para o dono ver)
1. Produto antigo sem operadora é lido como da principal do estabelecimento e passa a gravá-la na primeira alteração. A
   operadora dona não muda depois (recusa `operadora-do-produto`): preços, coparticipação e contratos são dela.
2. Contrato com hífen, banco em snake_case (`reclamacao-assistencial` ↔ `reclamacao_assistencial`, `nao-assistencial` ↔
   `nao_assistencial`, `portal-prestador` ↔ `portal_prestador`).
3. `prazo_tipo` só aceita `imediato`, `padrao`, `complexo` (CHECK). Os prazos padrão do contrato (assistencial, não
   assistencial, ouvidoria, NIP) gravam `padrao` e voltam pela instância e pela classe. O prazo em si fica em `prazo_em`.
4. O motivo de contato (obrigatório no modelo) é o primeiro ativo do tipo que corresponde à natureza: `informacao`,
   `reclamacao` (as duas reclamações) ou `solicitacao` (as demais). Sem cadastro, recusa `motivo-contato-ausente`.
5. O tipo de solicitante vai ao `vinculo_solicitante_protocolo` pelo grau (beneficiário → próprio, representante → representante
   legal, prestador, ANS → órgão público, outro → terceiro). Sem vínculo cadastrado, fica vazio (coluna opcional).
6. A conclusão da resposta é lida do andamento `resposta`, sem coluna nova.
7. Ação sobre protocolo cuja situação mudou desde a tela recusa com `conflito-versao`.

## Pedidos (em `04-misto-operadora.json`)
- Construção das portas da qualidade (controle de infecção, gestão, agravo, etapa 2 da notificação): grandes demais para
  o lote misto; só depois delas sai o mecanismo de leitura pendente de `apoio-propria.ts` e do painel.
- Contabilização automática do worker: mover a leitura e a gravação do lote da porta da API para um pacote comum.
- Cobrança (acordo, renegociação e notificação): mudar a assinatura da porta, que fica fora da lista.
- Ressarcimento ao SUS: ligar a geração do envio à cobrança antes de liberar a GRU e a decisão.
- Arquivos, portal do prestador e bases do SIP, DIOPS e monitoramento dependem de outras frentes.
- Semente de motivos de contato e de vínculos do solicitante no "criar novo cliente".

## 3ª volta (2ª volta da F2.4, continuação)
- **Notificação compulsória (`qualidade/porta-agravo-propria.ts`):** porta construída inteira. Lê o cadastro de agravos
  (CID notificável com a periodicidade, CID-10, fichas e perguntas), os gatilhos do prontuário (diagnósticos e CIDs do
  atendimento, declarações de óbito, resultados liberados com os valores dos analitos), o paciente e o estabelecimento.
  Grava o caso (abrir, notificar, descartar) e os gatilhos de exame numa gravação direta com trilha, travando a linha e
  conferindo a versão. `agravo.int.spec.ts` reescrito (5 testes no banco do lote); a limpeza da massa apaga os casos e
  gatilhos do estabelecimento sintético.
- Decisões pela melhor prática: unidade do agravo = estabelecimento (CNES, município, UF); "modelo da ficha" = o agravo
  notificável, nomeado pelos CIDs separados por "/" (o domínio escolhe a ficha pelo CID); situação rascunho = aberto,
  enviada/confirmada lidas como notificado e cancelada como descartado; o exame do caso é o item pedido (vem da chave do
  gatilho) e `exame_id` guarda o exame do catálogo; o CID é gravado pelo termo da CID-10 (`cid-inexistente` se faltar) e o
  agravo pelo CID mais específico do cadastro (`agravo-nao-cadastrado` se faltar); número de notificação repetido no
  estabelecimento recusa com `numero-duplicado`; CID notificável "imediato" = periodicidade imediata ou prazo até 24 h.
- Faltam (pedidos no .json): portas do controle de infecção (26 gravações, 45 leituras) e da gestão (46 leituras), a etapa
  2 da notificação de incidente com as 7 leituras de outros módulos; só depois sai o mecanismo de `apoio-propria.ts` e do
  painel (`seguranca.controller.ts`). Contabilização do worker, acordo de inadimplência, GRU e decisão do ressarcimento e
  portal do prestador seguem como na volta anterior (fora da lista ou de outra frente). Carga do cadastro de agravos pedida.
