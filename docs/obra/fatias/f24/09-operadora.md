# Fatia F2.4 09-operadora (assunto: operadora; cliente de teste próprio: f24_09operadora)

## apps/api/src/modulos/operadora/ans-porta-propria.ts
- modelo-pendente: linhas 17
    17: // respondem 501 `modelo-pendente`.

## apps/api/src/modulos/operadora/apoio-banco.ts
- modelo-pendente: linhas 78
    78: 'modelo-pendente',

## apps/api/src/modulos/operadora/apoio-porta-propria.ts
- modelo-pendente: linhas 9,76
    9: //   - o que o modelo ainda não tem responde 501 `modelo-pendente` (falha fechada, com o nome do recurso), nunca um
    76: 'modelo-pendente',

## apps/api/src/modulos/operadora/atendimento-porta-propria.ts
- modelo-pendente: linhas 17
    17: // portal (identidade no módulo de administração) e anexos da resposta do prestador respondem 501 `modelo-pendente`.

## apps/api/src/modulos/operadora/autorizacao-porta-propria.ts
- modelo-pendente: linhas 20
    20: // 501 `modelo-pendente`.

## apps/api/src/modulos/operadora/cobranca-porta-propria.ts
- modelo-pendente: linhas 14
    14: // (acordo_inadimplencia), notificação de inadimplência (ocorrencia_inadimplencia) respondem 501 `modelo-pendente`;

## apps/api/src/modulos/operadora/contas-porta-propria.ts
- modelo-pendente: linhas 15
    15: // arquivos) respondem 501 `modelo-pendente`.

## apps/api/src/modulos/operadora/porta-propria.ts
- modelo-pendente: linhas 32
    32: // produto (as outras: 501 modelo-pendente), para a leitura e a gravação dos preços não divergirem.

## apps/api/src/modulos/operadora/portal-prestador-servico.ts  (só comentário)
- nome-origem: linhas 95
    95: /** Origem do atendimento do pedido feito pelo portal (SPORIGEM_ATEND 4, "Portal autorizador"). */

## packages/contratos/src/operadora/ans.ts  (só comentário)
- nome-origem: linhas 7,13,56,73
    7: //   - SIP (trimestral): eventos e despesas assistenciais por grupo do SIP (TBSIPANSATO e TBSIPANSPROC do banco), pela
    13: //     trimestral vigente (PSTPSVIGENCIA do banco), com o desconto de cada plano, e a GRU do recolhimento;
    56: * Motivos de movimentação cadastral (CDMOTMOVIMCAD do banco: 12 linhas, conferidas na cópia em 26/10/2026). O grupo é a
    73: * Campos do beneficiário que a retificação do SIB declara (PSSIBCAMPOALT do banco: 19 linhas, conferidas na cópia em

## packages/contratos/src/operadora/atendimento.ts  (só comentário)
- nome-origem: linhas 12,16,165,192,297,316,615
    12: //     interno), ligada a um prestador da rede, com as funções que o credenciamento libera (PFPORTALOPCAO), ativada com o
    16: // legada (seção 5); SPORIGEM_ATEND, PFPORTALOPCAO e PFTPATEND são só lidos.
    165: /** Funções do portal que o credenciamento pode liberar (PFPORTALOPCAO; D-PORTAL-FUNCOES-568). */
    192: /** Origem do atendimento (SPORIGEM_ATEND), conferida no domínio do banco. */
    297: /** As funções liberadas (códigos de PFPORTALOPCAO; o servidor confere as liberáveis e o domínio do banco). */
    316: /** Tipo de atendimento (PFTPATEND), conferido no domínio do banco. */
    615: /** Funções do portal (PFPORTALOPCAO) e tipos de atendimento (PFTPATEND) do banco; `liberavel` marca as liberáveis. */

## packages/contratos/src/operadora/autorizacao.ts  (só comentário)
- nome-origem: linhas 22,482
    22: /** Tipo de guia (CDTPGUIA): o código do domínio do banco. */
    482: /** A situação da guia (CDGUIASTATUS) que vale para as contas médicas: autorizada ou cancelada; null em análise. */

## packages/contratos/src/operadora/cobranca.ts  (só comentário)
- nome-origem: linhas 4,30
    4: // TBTIPOCOBRANCASGO de 1 a 4), a baixa com multa e juros de mora, o cancelamento e o estorno, o reajuste anual do contrato
    30: /** Tipos de cobrança (TBTIPOCOBRANCASGO, regra 6): o código do domínio. */

## packages/contratos/src/operadora/inventario.ts
- nome-origem: linhas 50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69
    50: ['CDACOMODTIPO', 'dominios', 'crud', 3, 1, 'Tipos de acomodação do plano', 'bloqueada'],
    51: ['CDDIAVENCCOB', 'dominios', 'crud', 31, 1, 'Dias de vencimento de cobrança', 'condicionada'],
    52: ['CDFAIXAETATP', 'dominios', 'crud', 3, 1, 'Tipos de faixa etária', 'bloqueada'],
    53: ['CDGUIASTATUS', 'dominios', 'crud', 9, 1, 'Status de guia', 'bloqueada'],
    54: ['CDINCIDECOMIS', 'dominios', 'crud', 4, 1, 'Incidência de comissão', 'bloqueada'],
    55: ['CDMOTIVOBAIXA', 'dominios', 'crud', 1, 2, 'Motivos de baixa', 'condicionada'],
    56: ['CDMOTIVOSOLCART', 'dominios', 'crud', 3, 0, 'Motivos de solicitação de carteirinha', 'livre'],
    57: ['CDMOTMOVIMCAD', 'dominios', 'crud', 12, 1, 'Motivos de movimentação cadastral', 'bloqueada'],
    58: ['CDMSGCOBRANCA', 'dominios', 'crud', 9, 1, 'Mensagens de cobrança', 'condicionada'],
    59: ['CDMSGLINHA', 'dominios', 'crud', 7, 1, 'Linhas de mensagem', 'bloqueada'],
    60: ['CDORIGEMCOBR', 'dominios', 'crud', 4, 1, 'Origem da cobrança', 'bloqueada'],
    61: ['CDORIGEMGUIA', 'dominios', 'crud', 5, 1, 'Origem da guia', 'bloqueada'],

## packages/contratos/src/operadora/rede.ts  (só comentário)
- nome-origem: linhas 6,13,22,26,30,34,37
    6: // reinclusão e os movimentos da rede que vão ao RPS da ANS (inclusão, alteração, exclusão, reinclusão; TBSTATUSCREPLS).
    13: /** Classificação do estabelecimento na rede (TBCLASSIFCREPLS; código 1 é a assistência hospitalar). */
    22: /** Disponibilidade dos serviços do prestador para a operadora (TBDISPONIBILSERV). */
    26: /** Indicador de isenção de ônus do prestador (TBISENCAOONUS). */
    30: /** Código do tipo de prestador "hospital geral" (TBTPPRESTADOR). */
    34: /** Contratação indireta (TBTPCONTRATOCREPLS 2): pela rede de outra operadora, com o registro dela na ANS. */
    37: /** Movimentos da rede que vão ao RPS da ANS (TBSTATUSCREPLS): o código do domínio. */

## packages/contratos/src/operadora/vocabulario.ts  (só comentário)
- nome-origem: linhas 7,16,31,39,43,56,60,64,68,77,91,100,113,117,121,133,141,152,165
    7: /** Tipo de cobrança ao beneficiário (TBTIPOCOBRANCASGO; ref 02; regra 6). */
    16: /** Vínculo com o titular (SPVINCULOTITULAR; 1 é o próprio titular). */
    31: /** Tipo de contratação do plano (CDPLANOCLASSIF; os três da regulação da ANS). */
    39: /** Tipo de contrato (CDTPCONTRATO): pessoa física (individual ou familiar) ou pessoa jurídica (coletivo). */
    43: /** Forma de reajuste do contrato (TBTPFORMAREAJ; carga de referência). */
    56: /** Tipo de vigência do contrato (TBTPVIGCONTRATO). */
    60: /** Acomodação do plano (CDACOMODTIPO). */
    64: /** Tipo de coparticipação do plano (CDTPCOPART). */
    68: /** Movimento cadastral do beneficiário (CDSTATUSCAD; é o que vai ao SIB). */
    77: /** Situação da guia na operadora (CDGUIASTATUS). */
    91: /** Tipo de guia na operadora (CDTPGUIA). */
    100: /** Tipo de prestador da rede (TBTPPRESTADOR). */

## packages/dominio-operadora/src/ans/sib.ts  (só comentário)
- nome-origem: linhas 4,7,119
    4: //   - aceito ativo e agora excluído: cancelamento, com o motivo do SIB (CDMOTMOVIMCAD 5 a 10);
    7: //   - outro campo do SIB mudou: retificação, com os campos (PSSIBCAMPOALT).
    119: /** Os campos do SIB que mudaram entre o retrato aceito e o atual, na ordem de PSSIBCAMPOALT. */

## packages/dominio-operadora/src/ans/sip.ts  (só comentário)
- nome-origem: linhas 6
    6: // procedimentos do SIP vigente na data (TBSIPANSPROC do banco); o que não tem grupo vigente e as outras despesas

## packages/dominio-operadora/src/ans/tps.ts  (só comentário)
- nome-origem: linhas 3
    3: // beneficiário vigente no fim do trimestre (PSTPSVIGENCIA do banco: hoje R$ 5,39 ao ano, R$ 1,3475 por trimestre, desde

## packages/dominio-operadora/src/autorizacao.ts  (só comentário)
- nome-origem: linhas 15,223,304,520
    15: //   - a situação da guia que vale para as contas médicas (CDGUIASTATUS) e o comunicado da negativa ao beneficiário.
    223: /** Códigos das críticas da autorização no domínio da operadora (PSCRITICA), lidos do banco do estabelecimento. */
    304: /** O regime do contrato do prestador (TBREGIMEATEND: 1 ambulatorial, 2 hospitalar, 3 os dois) serve? */
    520: /** A situação da guia (CDGUIASTATUS) para as contas médicas: 1 autorizada (também a parcial), 5 cancelada. */
