# Fatia F2.4 16-misto-financeiro (assunto: financeiro+adt+enfermagem-2; cliente de teste próprio: f24_16mistofinanceiro)

## apps/api/src/modulos/financeiro/porta-propria.ts
- modelo-pendente: linhas 1331
    1331: 'modelo-pendente',

## packages/contratos/src/financeiro/entradas.ts  (só comentário)
- nome-origem: linhas 38,54,111,113,126,149,152,154,176,194,230,287
    38: /** MFREFDES.COD (a conta de desconto ou acréscimo, com o tipo do imposto em MFREFDES.TIPO). */
    54: * hoje (perfil de MFCONPAG: 111 títulos de folha e encargos em 2025 e 2026, todos de parcela 1, TIPO F ou X, NF 0). O
    111: /** TBFORNEC.COD (no médico, o código do conselho em TBCBOPRO.COD). */
    113: /** TBCBOPRO.ID do médico (TIPO M). */
    126: /** Centro de custo do documento (alçada e rateio no novo; o MFLANGSI grava CDC 0). */
    149: /** TBCTABAN.ID da conta que paga (no escopo MFCTAUSU). */
    152: /** Forma de pagamento (MFCONPAG.TP_PGTO; só valores já vistos, DP-46.3). */
    154: /** Pagar por borderô (um MFBORDER para os títulos) ou sem borderô. */
    176: /** FCCTAEXT.ID da conta (ou das contas do mesmo convênio e competência, num título só). */
    194: /** TBCTABAN.ID da conta que recebe (crédito) e da debitada (débito), no escopo MFCTAUSU. */
    230: /** FCLANEXT.ID do item glosado (nulo: a glosa do título inteiro, com o valor somado dos itens). */
    287: /** Classificação tributária (NFSECLASSIFICACAO_TRIBUTARIA) e o item da lista de serviços (TBSERVICO_NFSE_ITENS). */

## packages/contratos/src/financeiro/regras/alcada.ts  (só comentário)
- nome-origem: linhas 3,11,13
    3: // 71.267 títulos); MFPARAM.AUT_ELET continua 'F' (o novo não mexe em parâmetro do outro sistema). A faixa vale por
    11: /** Centro de custo (TBCENCUS.COD) ou nulo (todos). */
    13: /** Tipo de credor (MFCONPAG.TIPO) ou nulo (todos). */

## packages/contratos/src/financeiro/regras/classificacao.ts  (só comentário)
- nome-origem: linhas 1,2,4,15,17
    1: // Regra 7 do M32 (cap-06b §6.8; ref 01 §2.5): a classificação gerencial (grupo, subgrupo, item de TBITEDES) é gravada
    2: // como o outro sistema grava (MFLANGSI só na parcela 1, CDC = 0) e mostrada como valendo para o documento inteiro; o
    4: // MFLANGSI.CDC preenchido.
    15: /** O CDC gravado em MFLANGSI pelo novo (0 em 100% do perfil). */
    17: /** TP_LAN de MFLANGSI: 0 = despesa do título a pagar, 1 = receita do título a receber, 4 = movimento (visto). */

## packages/contratos/src/financeiro/regras/credor.ts  (só comentário)
- nome-origem: linhas 3,5,41,43,70,72
    3: //   - MFCONPAG.TIPO: F 55.792 · M 8.607 (exige o vínculo com o profissional, MFCONPAG_TBCBOPRO) · E 5.421 · X 1.356 ·
    5: //   - MFCONPAG.ONDE (módulo de origem): F 46.895 · E 18.914 · R 5.458 (confiança média);
    41: /** M: o título exige o vínculo com o profissional (MFCONPAG_TBCBOPRO). */
    43: /** Retenções na fonte (MFDESACR) permitidas no lançamento manual. */
    70: /** O fornecedor (TBFORNEC.COD) existe e está ativo? */
    72: /** Profissional (TBCBOPRO.ID) informado e válido, quando o tipo é M. */

## packages/contratos/src/financeiro/regras/glosa-titulo.ts  (só comentário)
- nome-origem: linhas 2,9
    2: // itens com FCLANEXT.GLOSADO = 'T' (baixados); nunca ler 'F' como glosa (daria 33,8% em vez de 15,2%). A glosa aceita
    9: /** FCLANEXT.GLOSADO: 'T' = baixado (conciliado); 'F' ou vazio = ainda sem retorno. */

## packages/contratos/src/financeiro/regras/recusa.ts  (só comentário)
- nome-origem: linhas 50
    50: /** Login comparável (TBUSERS.NOME é sensível a maiúsculas no banco; para a segregação, pessoa é pessoa). */

## packages/contratos/src/financeiro/regras/segregacao.ts  (só comentário)
- nome-origem: linhas 2,8
    2: // aprova não paga, quem paga não concilia. A pessoa é o login do outro sistema (TBUSERS.NOME), comparado sem caixa.
    8: /** Quem lançou (MFCONPAG.USUARIO). */

## packages/contratos/src/financeiro/regras/situacao-titulo.ts  (só comentário)
- nome-origem: linhas 44
    44: /** Formas de pagamento vistas (MFCONPAG.TP_PGTO e MFCTAREC.TP_PGTO): legenda candidata em TBTIPOPAGFOR (DP-46.3). */

## packages/contratos/src/financeiro/regras/tipo-movimento.ts  (só comentário)
- nome-origem: linhas 2,35,37,75
    2: // MFLANCTO.TIPO_TRF: O 18.902 (outros: tarifas, aplicações) · I 9.753 (importado do extrato) · F 5.048 (fechamento de
    35: /** Conta que recebe (crédito: o dinheiro entra), TBCTABAN.ID. */
    37: /** Conta que paga (débito: o dinheiro sai), TBCTABAN.ID. */
    75: /** As contas do movimento estão no escopo do usuário (MFCTAUSU; regra 15)? */

## packages/contratos/src/financeiro/regras/titulo-pagar.ts  (só comentário)
- nome-origem: linhas 4,21,87
    4: //   - regra 7: a classificação gerencial (MFLANGSI) é gravada só na parcela 1, com CDC = 0, e vale para o documento
    21: /** A série gravada: sem série, a letra F do DEFAULT da coluna (MFCONPAG.SERIE e MFCTAREC.SERIE; D-SERIE-32). */
    87: /** Regra 7: o MFLANGSI só nasce com a parcela 1 (o outro sistema grava assim; o rateio vale para o documento). */

## packages/contratos/src/financeiro/regras/titulo-receber.ts  (só comentário)
- nome-origem: linhas 57,59
    57: /** FCCTAEXT.FECHADA: S fechada, A apresentada (as que geram título), N aberta. */
    59: /** FCCTAEXT.ID_MFCTAREC: o título já ligado (0 ou nulo: sem título). */

## packages/contratos/src/financeiro/respostas.ts  (só comentário)
- nome-origem: linhas 265
    265: /** A apropriação gerencial do documento a pagar (MFLANGSI, a parcela 1) com o rateio por centro de custo do novo. */

## packages/dominio-financeiro/src/dre.ts  (só comentário)
- nome-origem: linhas 2,22
    2: //   - competência: a receita da conta pela competência dela (FCCTAEXT.ANOPRO*100 + MESPRO), menos a glosa aceita;
    22: /** Grupo gerencial (TBGRUDES) para a abertura da DRE. */

## packages/dominio-financeiro/src/fluxo-caixa.ts  (só comentário)
- nome-origem: linhas 4
    4: // do convênio. Agregado por dia, semana ou mês; o saldo inicial é o último saldo fechado (MFSALDOS) mais o realizado.

## packages/dominio-financeiro/src/indicadores.ts  (só comentário)
- nome-origem: linhas 2,3,4
    2: //   - títulos pagos sem aprovação, nos dois sistemas (MFCONPAG × SGH_FIN_APROVACAO);
    3: //   - contas sem título (FCCTAEXT × MFCTAREC; linha de base 13.260 de 40.693 contas de 2025 ligadas);
    4: //   - credor não encontrado no cadastro (MFCONPAG.FORN × TBFORNEC; 12,9%).

## packages/dominio-financeiro/src/lote-contabil.ts  (só comentário)
- nome-origem: linhas 2,9
    2: // do contador leva o de-para (TBINTCRC: o evento do financeiro → conta contábil; TBINTIMP: o imposto; RPINTEVE: o
    9: /** Chave do de-para: o tipo de lançamento (MFTIPOLANC) ou o item gerencial. */

## packages/dominio-financeiro/src/nfse.ts  (só comentário)
- nome-origem: linhas 3
    3: // (alíquotas de teste de 2026: CBS 0,9% e IBS 0,1%; a classificação de NFSECLASSIFICACAO_TRIBUTARIA e TBINTIMP). Emissão

## packages/dominio-financeiro/src/orcamento.ts  (só comentário)
- nome-origem: linhas 2,50,442
    2: // versões e aprovação, comparado com o realizado (MFLANGSI pela competência, saídas de estoque por centro de destino)
    50: /** IDs dos centros de custo do cadastro (TBCENCUS.ID). */
    442: * Leva o realizado do banco à chave do orçamento: o código do centro (CDC = TBCENCUS.COD) vira o ID; o documento com

## packages/dominio-financeiro/src/remessa.ts  (só comentário)
- nome-origem: linhas 3
    3: // domínio de TBTPOCORBANCOPGTO ("00" crédito efetuado).

## apps/api/src/modulos/adt/higienizacao.controller.ts  (só comentário)
- nome-origem: linhas 120
    120: * (CHPROFISLIMP.USUARIO_SISTEMA): o número dele; null para o supervisor, que escolhe o profissional. Sem ligação, 403.

## apps/api/src/modulos/adt/internacao.controller.ts
- nome-origem: linhas 163,171,183,223,304,610
    163: req.sghAlvo = { tabelaAlvo: 'RICADINT', idAlvo: 'incoerencias' };
    171: req.sghAlvo = { tabelaAlvo: 'RIPREINT', idAlvo: 'lista' };
    183: req.sghAlvo = { paciente: id, tabelaAlvo: 'RIPREINT', idAlvo: String(id) };
    223: req.sghAlvo = { tabelaAlvo: 'RICADINT', idAlvo: 'lista' };
    304: req.sghAlvo = { paciente: d.paciente, tabelaAlvo: 'RICADINT', idAlvo: String(d.reg) };
    610: tabelaAlvo: 'RICADINT',

## apps/api/src/modulos/adt/leitos.controller.ts
- nome-origem: linhas 456
    456: tabelaAlvo: 'RILEITOS',

## apps/api/src/modulos/adt/nir-porta-propria.ts
- modelo-pendente: linhas 12,160
    12: // cirúrgico ao pedido de leito. Até lá, leitura vazia e gravação recusada com "modelo-pendente".
    160: new ErroOperacao(409, 'modelo-pendente', 'Recurso aguardando o modelo', `${o} aguarda a estrutura no modelo do banco.`);

## apps/api/src/modulos/adt/porta-propria.ts
- modelo-pendente: linhas 1173
    1173: new ErroOperacao(409, 'modelo-pendente', 'Recurso aguardando o modelo', `${o} aguarda a estrutura no modelo do banco.`);

## apps/api/src/modulos/adt/porta.ts  (só comentário)
- nome-origem: linhas 287
    287: /** O profissional da higienização ligado ao login (CHPROFISLIMP.USUARIO_SISTEMA); null sem ligação. */

## apps/api/src/modulos/adt/same.controller.ts
- nome-origem: linhas 87
    87: req.sghAlvo = { tabelaAlvo: 'GDPRONTMOVIM', idAlvo: String(l.conta) };

## apps/web/src/modulos/adt/regras-tela.ts
- vocab-antigo: linhas 1
    1: // Regras puras das telas do M21 (testadas em regras-tela.spec.ts): o texto do leito, a hora HHMM, o agrupamento do

## packages/dominio-enfermagem/src/tempo.ts
- vocab-antigo: linhas 30
    30: /** HH:mm (ou HHMM) → minutos do dia. */
