# F2.4, lote 23-misto-coexistencia

## O que mudou
- **Contratualização SUS (porta própria):** saíram as recusas `modelo-pendente`. A porta foi ligada às colunas que já
  existiam no banco:
  - contrato: `observacao`, `motivo_encerramento`, `encerrado_em` e `encerrado_por_usuario_id` (gravados e relidos);
  - meta: `complexidade_dominio_contratualizacao_sus_id` e o formato `inteiro`;
  - apuração: `origem_realizado`.
  - `producaoContasSus` soma os itens das contas hospitalares das fontes pagadoras do parâmetro, pela
    `equivalencia_sigtap_item` vigente na data do item. O parâmetro `faturamento.sus.conveniosSus` traz **códigos** de
    negócio: o filtro casa `fonte_pagadora.codigo` (texto, sem zeros à esquerda), nunca o id. O int spec prova com uma
    fonte de código `0917` e id diferente.
  - O int spec agora prova a gravação e a releitura, em vez da recusa.
- **Chaves das listas na resposta da contratualização:** passaram do nome de tabela de origem para o nome de negócio
  em camelCase (`incentivo`, `tipoAfericao`…). A tela `ContratualizacaoTela.vue`, de nenhum lote, foi ajustada junto. O
  alvo da auditoria da busca SIGTAP é `procedimento_sigtap`.
- **Portal do paciente, telas de pré-check-in e teleconsulta** (`ConferenciaPreCheckinTela`, `PortalPreCheckinTela`,
  `PortalTeleconsultasTela`, `PortalTeleconsultaTela`, de nenhum lote): a hora passou pelo `lerHoraDigitada`, que mostra
  `HH:MM` como chega e nunca quebra a tela. O `portal-agenda.spec.ts` confere `08:15` na fila.
- **Portal do paciente, agenda online:** a hora passou a `HH:MM` de ponta a ponta:
  - o contrato usa `esquemaHora`;
  - o serviço normaliza as duas portas por `lerHoraDigitada`;
  - as telas `PortalAgendarTela` e `PortalPagamentosTela` mostram a hora como vem;
  - os specs foram ajustados.
- **Parâmetros `enfermagem.inicioTurnoDiurno` e a hora de corte do balanço hídrico:** formato `HH:MM`, com padrão `07:00`.
- **Nome de origem:** comentários e textos reescritos com termo de negócio (coexistência, parâmetros, suporte, portal,
  documento, assinatura). O inventário de desligamento lista os dados pelo nome de negócio.

- O spec da API confere as onze chaves camelCase das listas, as mesmas do i18n da tela.

## Decisões pela melhor prática
- A modalidade da produção das contas SUS sai da natureza da conta. Internação conta como hospitalar; as demais, como
  ambulatorial.
- Item estornado ou transferido não conta na produção. Item glosado conta, porque foi produzido.
- A apuração gravada antes da coluna `origem_realizado` mantém a leitura antiga: a qualitativa é `informado`; a
  quantitativa, `faturamento-sus`.
- Ao aceitar a observação do contrato, o texto é cortado em 500 caracteres, como no contrato.

## Pedidos (detalhe em `23-misto-coexistencia.json`)
1. **DDL do faturamento SUS:** o pedido 03-05 da F2.2 ainda não foi aplicado. `sus/porta-propria.ts` mantém 18
   recusas `modelo-pendente`.
2. **DDL da carga de tabela de preço**, ou a decisão de reusar `carga_catalogo`. `precos/fonte-propria.ts` mantém a
   recusa.
3. **Lote 11 (enfermagem):** três controladores aceitam só a hora de quatro dígitos do parâmetro de turno.
4. **e2e do portal do paciente:** conferir as horas.
