# Lote 10-suprimentos (F2.4): suprimentos e licitação — PARCIAL

## O que mudou
- **Nome de origem zerado nos 15 arquivos do lote** (controller do estoque e do OPME, contratos de suprimentos):
  - comentários reescritos com o termo de negócio ou sem a proveniência;
  - a trilha de leitura do estoque (`tabelaAlvo`) usa as tabelas do modelo próprio:
    `lote_insumo`, `documento_estoque`, `requisicao_material`, `pedido_compra_item` e `consumo_centro_custo`;
  - `onda3.ts`: `TABELAS_EFEITO_ESTOQUE` e `DOCUMENTOS_ONDA3.tabela` com nomes do modelo próprio; saiu
    `CODIGOS_BAIXA_CONFIANCA_ONDA_3`, que descrevia códigos do sistema de origem e não era usado (é do conector).
  - Regra 2 da onda redefinida (correção da revisão): sem gatilho, quem grava as tabelas de efeito é a operação de
    movimento. A nova lista `OPERACOES_MOVIMENTO_ESTOQUE` (documentos de estoque, entrada por nota, movimento direto,
    balanço, fechamento e reabertura do mês, dispensação, devolução de dose, cancelamento e perda de controlado) pode
    gravá-las; `gravacoesEmTabelaDeEfeito` acusa só as outras operações da onda, comparando em minúsculas.
  - `TABELAS_EFEITO_ESTOQUE` ficou só com as do estoque: saíram `lancamento_contabil` (financeiro) e
    `sequencia_negocio` (numeração do núcleo, usada por todo documento).
  - `packages/dominio-suprimentos/src/onda3.spec.ts` (regra 2) atualizado na mesma rodada: 19 de 19 verdes.
- **modelo-pendente não mudou** (4 arquivos, 6 linhas). Ver "Falta".

## Decisões pela melhor prática (para o dono ver)
- Tabelas de efeito do estoque (saldos, custo médio, consumo por centro) são atualizadas só pelas operações de
  movimento designadas, na transação do documento. Numeração e lançamento contábil não são efeito do estoque.
- Licitação: **não** foi feita porta própria guardando parecer, recurso, publicação, ata e pedido no texto da descrição
  do evento. O domínio decide por esses dados (parecer desfavorável trava a publicação, recurso provido volta à sessão,
  pedido só do vencedor e só uma vez). Pedido de DDL com as colunas exatas em `10-suprimentos.json`.

## Pedidos (detalhe em `10-suprimentos.json`)
- DDL: `evento_processo_licitatorio` (tipos, resultado, veículo, fornecedor, pedido, arquivo), `processo_licitatorio`
  (método da estimativa, quem julgou e homologou), `processo_licitatorio_item` (valor adjudicado), `pesquisa_preco_item`
  (justificativa de 1000 e autor do descarte), `proposta_licitacao_item` (nota técnica).
- Contrato: comentários de `licitacao.ts` (nomes do new-sgh e do sistema anterior, fora do verificador).
- Montagem: licitação, contrato e consignado continuam fora de todo módulo da API (pedido do f22 03-13).
- Rodada própria do estoque: as operações e leituras pendentes dependem de trocar a chave antiga (ano, mês, documento;
  item por código) por id, de ponta a ponta.

## Falta (modelo-pendente)
- `porta-propria.ts` (linhas 20 e 884): 30 leituras e 15 gravações do estoque.
- `operacoes.ts` (64, 89): `OPERACOES_SUPRIMENTOS_PENDENTES` e o `modeloPendente`, usados por estoque, OPME e manipulação.
- `opme-porta-propria.ts` (9): solicitação, consumo em sala, rastreio reverso, saldos e lotes, fornecedores e itens da conta.
- `manipulacao-porta-propria.ts` (11): itens a manipular, ordens, vínculos do login e gravações da ordem.
- Licitação: porta própria bloqueada pelo DDL pedido.

## Autoconferência
`tools/obra/conferir-lote-f24.sh 10-suprimentos`: rc=1. Sobram as 4 dívidas de modelo-pendente acima, 2 erros de tsc
em specs da web da qualidade (fora do lote) e 1 falha de integração fora do lote: `licitacao-documento.int.spec.ts`
devolve "Emissão indisponível" (503) ao emitir o PDF/A; o arquivo não mudou nesta rodada, e Gotenberg e S3 estão de pé.
Os demais 70 testes de suprimentos passam.
