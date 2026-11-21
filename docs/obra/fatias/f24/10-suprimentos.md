# Fatia F2.4 10-suprimentos (assunto: suprimentos; cliente de teste próprio: f24_10suprimentos)

## apps/api/src/modulos/suprimentos/manipulacao-porta-propria.ts
- modelo-pendente: linhas 11
    11: // conferência da ordem) respondem 409 modelo-pendente; a baixa do insumo depende da saída do estoque no banco.

## apps/api/src/modulos/suprimentos/operacoes.ts
- modelo-pendente: linhas 64,89
    64: * motivo (podeGravar) e a gravação responde 409 modelo-pendente; nada é gravado pela metade.
    89: 'modelo-pendente',

## apps/api/src/modulos/suprimentos/opme-porta-propria.ts
- modelo-pendente: linhas 9
    9: // itens com saldo e lotes, os fornecedores e os itens da conta respondem 409 modelo-pendente.

## apps/api/src/modulos/suprimentos/opme.controller.ts  (só comentário)
- nome-origem: linhas 338,339
    338: * O fornecedor, o pedido de compra e a nota fiscal citados existem no cadastro (ficha, seção 6: o pedido de GECADPED,
    339: * a NF de GECADNFS); o pedido e a nota são do fornecedor da solicitação quando ele é conhecido.

## apps/api/src/modulos/suprimentos/porta-propria.ts
- modelo-pendente: linhas 20,884
    20: // GRAVACOES_SUPRIMENTOS_PENDENTES respondem 409 modelo-pendente. As tabelas existem: falta a porta (trabalho de lote).
    884: // Pendentes: 409 modelo-pendente com o motivo (LEITURAS_SUPRIMENTOS_PENDENTES).

## apps/api/src/modulos/suprimentos/suprimentos.controller.ts
- nome-origem: linhas 281,293,330,355,426,729,814
    281: req.sghAlvo = { tabelaAlvo: 'GEVALMEM', idAlvo: `${item}/${lote}` };
    293: req.sghAlvo = { tabelaAlvo: 'GECADSAI', idAlvo: `atendimento ${atendimento}` };
    330: req.sghAlvo = { tabelaAlvo: 'GECADSAI', idAlvo: `${tipo} ${inicio}..${fim} p${pagina}` };
    355: tabelaAlvo: 'GECADSAI',
    426: req.sghAlvo = { tabelaAlvo: 'GECADSAI', idAlvo: `requisicoes ${local ?? 'todos'}` };
    729: req.sghAlvo = { tabelaAlvo: 'GECOMPRA', idAlvo: `item ${h.item} (csv)` };
    814: req.sghAlvo = { tabelaAlvo: 'GEKONCDC', idAlvo: `${c.competencia.mes}/${c.competencia.ano} (csv)` };

## packages/contratos/src/suprimentos/onda3.ts
- nome-origem: linhas 26,135,140,141,142,143,144,145,146,151,152,153,154,155,160,193,195,493,499
    26: /** Grupos funcionais (TBGRUUSU.NOME, sem acento) de quem começa no setor (cap-15 §15.4.1). */
    135: * O catálogo de operações nunca as lista entre as gravadas pelo novo. GEARMLOC e FCLANEXT: o outro sistema as grava
    140: 'GEARMLOC',
    141: 'GESALDOS',
    142: 'GEITENS',
    143: 'GEKONCDC',
    144: 'GECONITL',
    145: 'FCLANEXT',
    146: 'GEULTDOCGER',
    151: { tipo: 'saida', tabela: 'GECADSAI', rotulo: 'Saídas e requisições' },
    152: { tipo: 'devolucao', tabela: 'GECADDEV', rotulo: 'Devoluções' },
    153: { tipo: 'transferencia', tabela: 'GECADTRA', rotulo: 'Transferências' },

## packages/contratos/src/suprimentos/opme-respostas.ts  (só comentário)
- nome-origem: linhas 183
    183: * Uma saída do estoque do lote (GERASVALSAIDLOTE → GELANSAI → GECADSAI), feita no consumo em sala ou por outro caminho

## packages/contratos/src/suprimentos/opme-vocabulario.ts  (só comentário)
- nome-origem: linhas 7
    7: /** A classe dos itens de OPME no cadastro de itens do estoque (TBCLASSI 50). */

## packages/contratos/src/suprimentos/regras/cotacao.ts  (só comentário)
- nome-origem: linhas 8
    8: /** `GELANPED.ID` da linha da proposta. */

## packages/contratos/src/suprimentos/regras/escopo.ts  (só comentário)
- nome-origem: linhas 17
    17: /** Códigos de `GELOCUSU.TIPO_MOV` (uma linha por usuário, local e tipo; contagens na cópia pc). */

## packages/contratos/src/suprimentos/regras/farmacia-avaliacao.ts  (só comentário)
- nome-origem: linhas 117
    117: * Regra 8: gravar a decisão no outro sistema (2, 3 ou 4 em `PREXTRATOITEM_TBSITFARM`) só com a decisão registrada

## packages/contratos/src/suprimentos/regras/farmacia-controlado.ts  (só comentário)
- nome-origem: linhas 2,7,20
    2: // obrigatório na saída, com registro coerente com o conselho (`GELANSAI.ID_TBCBOPRO_MAT_MED_CONTROLADO`); para o
    7: /** As listas vistas no cadastro de itens da cópia (`GEITENS.PORTARIA`): A1 8, A2 3, B1 14, C1 32, C5 1. */
    20: /** O vínculo profissional (TBCBOPRO.ID). */

## packages/contratos/src/suprimentos/regras/farmacia-entrega.ts  (só comentário)
- nome-origem: linhas 11,55,60
    11: /** A última situação do documento em GECTRLENTREGADOCSAIDA (7, 8 ou 9). */
    55: /** GEDISPHOR.ID. */
    60: /** A saída que levou a dose (GELANSAI). */

## packages/contratos/src/suprimentos/regras/farmacia-fila.ts  (só comentário)
- nome-origem: linhas 17,30,116
    17: /** O horário prescrito (PRCHKGERAL.ID). */
    30: /** Já dispensada por qualquer dos dois sistemas (GEDISPHOR ou PRINTEGRACAOESTOQUE ligados ao horário). */
    116: /** Política "dispensar só depois de validar", por classe (parâmetro SGH_; nada em PRPARAM). */

## packages/contratos/src/suprimentos/regras/farmacia-situacao.ts  (só comentário)
- nome-origem: linhas 1,4,62
    1: // Situações da farmácia (ficha do M29, regra 7; ref 02 §1): os 12 códigos de `TBSITUACAOFARMACIA` com a legenda da
    4: // `PREXTRATOITEM_TBSITFARM`); só entram com a decisão registrada (regra 8, DP-25).
    62: /** A situação de entrega do documento (GECTRLENTREGADOCSAIDA): só 7, 8 e 9 vistos (272.413, 2.607 e 3). */

## packages/contratos/src/suprimentos/regras/onda3.ts  (só comentário)
- nome-origem: linhas 130,132,134,147
    130: /** Itens com linha no saldo mensal (GESALDOS) da competência do documento. */
    132: /** O documento tem consumo registrado (GEKONCDC); null quando não se aplica (centro técnico, sem centro). */
    134: /** Itens com saldo no local na competência (GEARMLOC); informativo (D-MOTOR-28). */
    147: * O efeito esperado num documento do novo. O consumo (GEKONCDC) é informativo por padrão: na cópia pc, 274 de 9.619

## packages/contratos/src/suprimentos/regras/opme.ts  (só comentário)
- nome-origem: linhas 13
    13: /** A classe do item no cadastro (TBCLASSI): só a classe de OPME. */

## packages/contratos/src/suprimentos/regras/saida.ts  (só comentário)
- nome-origem: linhas 14,17
    14: /** `GEITENS.ESTOQUE` e `GEITENS.TOTAL` (saldo e valor do item na empresa). */
    17: /** `GEITENS.VLRMED`: item de custo zero (abaixo de 0,01) sai sem valor, como o gatilho aceita. */

## packages/contratos/src/suprimentos/respostas.ts  (só comentário)
- nome-origem: linhas 51,484,488
    51: /** A ficha do item (GEITENS com a classe e o grupo): as unidades por uso e os fatores de conversão. */
    484: /** Terceiro destinatário de saída (GECADTER): só o código e o nome (a data de nascimento não sai). */
    488: /** Colaborador ou prestador (GETABFUN): o CPF e a conta mascarados; retenções só como marca. */
