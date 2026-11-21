# F2.4, lote 06-faturamento

Dívida do lote: **0** em `divida_f24.py` (eram modelo-pendente 1 arquivo, vocabulário antigo 3, nome de origem 30).
Autoconferência: tsc e vitest do lote verdes; os únicos erros de tsc restantes são de outros lotes em andamento
(qualidade, operadora, identidade). Integração no cliente `f24_06faturamento`: 21 de 21.

## O que mudou

- **Porta própria da conta (`porta-propria.ts`): nenhuma recusa "modelo-pendente".** Ligada às tabelas que já existiam:
  - fila do lançamento após o fechamento: leitura, contagem no painel e na worklist, e decisão (uma vez só);
  - regras de faturabilidade por fonte pagadora: leitura e gravação (exigência em snake_case no banco);
  - pacote pela tela: cria ou edita o pacote, o valor por fonte pagadora e os itens inclusos;
  - orçamento particular: item livre, urgência, garantia antes (recusada na urgência) e desconto;
  - recebimento particular: movimento do caixa ligado ao orçamento ou à conta, com parcelas, troco abatido do
    dinheiro, totais da sessão e o orçamento quitado;
  - recibo: numerado, com valor por extenso, ligado ao recebimento; segundo recibo do mesmo pagamento é recusado.
- **Valor por extenso** (`valorPorExtenso`) em `contratos/faturamento/regras/particular.ts`, com teste.
- **Vocabulário:** hora do lançamento passa a `HH:MM` (`esquemaHora`; instante pelo fuso do estabelecimento);
  `atendimentoRN` passa a booleano no contrato e no domínio, e só o XML da TISS recebe S/N.
- **Nomes de origem:** comentários reescritos em termos de negócio; o texto da tela das tabelas de apoio usa as
  mesmas chaves camelCase que a API devolve (`CHAVE_RESPOSTA_DOMINIO`: `tipoAfericao`, `componenteOrcamento`…), com
  teste que amarra as 11 chaves e confere que nenhuma cai em "Outra tabela de apoio"; a lista de códigos de baixa confiança usa o campo do produto (`contaPagar.situacao` etc.).

## Decisões pela melhor prática (para o dono ver)

- O "registro" da fila tardia é o id da entrada na fila (um lançamento por linha), não a ficha do atendimento.
- Regra de faturabilidade de internação grava `natureza_conta = internacao`; a de conta externa fica só no seletor.
- Pacote: a tela edita o valor e a vigência por fonte pagadora (`pacote_contrato`) e o pacote em si (nome, situação,
  itens), que é comum às fontes. O código do pacote não muda. Pacote novo exige o item faturável do pacote cadastrado.
- Pacote da rede (sem estabelecimento): o estabelecimento grava só o valor e a vigência da fonte pagadora; mudar nome,
  situação ou itens inclusos é recusado com `pacote-da-rede` (fica com a administração da rede). Teste de integração
  cobre pacote novo e edição.
- Recebimento particular: um `recebimento_particular` por forma de pagamento; o troco sai do dinheiro e o caixa
  guarda o líquido. O recibo sai do recebimento, com o valor que ficou no caixa.
- Numeração própria (`OP-`, `RP-` e recibo sem prefixo) criada na primeira gravação do estabelecimento.

## Fora da `.lista` (arquivos sem dono em nenhum lote, mudados para a troca de ponta a ponta)

`apps/api/src/modulos/faturamento/operacoes.ts`, `apps/api/src/modulos/tiss/operacoes.ts`,
`apps/api/src/modulos/tiss/porta-memoria.ts`, `apps/web/src/modulos/faturamento/telas/LancamentosTela.vue` e os
testes `faturamento.spec.ts`, `operadora/contas.spec.ts`, `operadora/portal-prestador-contas.spec.ts`,
`tiss/simulador.spec.ts`, `dominio-faturamento/src/onda4/onda4.spec.ts`, `e2e/w0-10-glosas.spec.ts`, `e2e/m56-6.spec.ts`.

## Pedidos (`06-faturamento.json`)

1. Lote 22: `acompanhamento.ts` passa a usar `movimentoBancario.tipoTransferencia`.
2. Quem lança item de outro módulo em conta fechada passa a alimentar a fila tardia.
3. Centro cirúrgico: leitura da nota de sala.
4. Carga de cliente: tipo de movimento `recebimento_particular` e formas de recebimento por meio.
