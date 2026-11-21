# Fatia F2.4 06-misto-suprimentos (assunto: suprimentos+integracao+acesso+farmacia+atendimento; cliente de teste próprio: f24_06mistosuprimentos)

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

## apps/api/src/modulos/suprimentos/porta-propria.ts
- modelo-pendente: linhas 20,884
    20: // GRAVACOES_SUPRIMENTOS_PENDENTES respondem 409 modelo-pendente. As tabelas existem: falta a porta (trabalho de lote).
    884: // Pendentes: 409 modelo-pendente com o motivo (LEITURAS_SUPRIMENTOS_PENDENTES).

## packages/contratos/src/integracao/segredos-legado.ts
- nome-origem: linhas 36,44,52,60,68,76,84,99
    36: tabela: 'TBCONVEN',
    44: tabela: 'TBTISSWEBSERV',
    52: tabela: 'TBCODATI',
    60: tabela: 'TBHOSPIT',
    68: tabela: 'GEUSERS',
    76: tabela: 'PREMAILCFG',
    84: tabela: 'SITPEQV',
    99: objeto: 'TBINFBANCO',

## packages/dominio-integracao/dist/apoio.d.ts  (só comentário)
- nome-origem: linhas 11,13
    11: /** Código do elemento no laboratório (SITBELHP.COD). */
    13: /** Nome do elemento no de-para (SITBELHP.ELEMENTO_NOME). */

## packages/dominio-integracao/dist/fachada/convenio-situacao.d.ts  (só comentário)
- nome-origem: linhas 44
    44: /** A pré-checagem do gatilho de TBCONVEN: diária apontada que não é TIPO 1/SUBTIPO 5 recusa qualquer alteração. */

## packages/dominio-integracao/dist/fachada/convenios.d.ts  (só comentário)
- nome-origem: linhas 1
    1: /** A linha lida de TBCONVEN (COD, NOME aparado, SITUACAO aparada, PERMITE_ATEND). */

## packages/dominio-integracao/dist/hl7/mensagem.d.ts
- vocab-antigo: linhas 13
    13: /** Data e hora HL7 (AAAAMMDDHHMMSS) do relógio de parede (o Date carrega a hora local nos campos UTC). */
- nome-origem: linhas 40
    40: /** O exame do pedido (SILANEXA.ID: o identificador do pedido no Sante SGH e no outro sistema). */

## apps/api/src/modulos/acesso/fonte-sintetica.ts
- nome-origem: linhas 1405,1406,1407
    1405: 'GEUSERS.PERMITIR_AUTORIZAR_PEDIDO',
    1406: 'GEUSERS.AUT_REQ',
    1407: 'GEUSERS.PERMITIR_DESBLOQUEIO_FECHAMENTO',

## apps/web/src/modulos/acesso/i18n-segredos.ts
- nome-origem: linhas 33,34,35,36,41,42,43,46,51
    33: TBCONVEN: { SENHA: 'Senha do portal' },
    34: TBTISSWEBSERV: { SENHA_PRESTADOR: 'Senha do prestador' },
    35: TBCODATI: { SENHA_PRESTADOR: 'Senha do prestador' },
    36: TBHOSPIT: {
    41: GEUSERS: { SENHA: 'Senha do almoxarifado' },
    42: PREMAILCFG: { SENHA_AUTENTICACAO: 'Senha de autenticação' },
    43: SITPEQV: { SENHA_FTP: 'Senha de transferência de arquivos', SENHA_EXPORTACAO: 'Senha de exportação' },
    46: TBINFBANCO: 'Dados de acesso ao banco externo do estabelecimento',
    51: TBINFBANCO:

## packages/contratos/src/acesso/tabelas-clinicas.gerado.ts
- nome-origem: linhas 5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24
    5: 'CCCADCIR',
    6: 'CCCADCIR_EXCLUSAO',
    7: 'CCLANCIR',
    8: 'HTATENDALTA',
    9: 'HTATENDIMENTO',
    10: 'HTATENDRESP',
    11: 'HTCHKGERAL',
    12: 'PRALERGIAPAC',
    13: 'PRALERGIAPAC_TBPRINC',
    14: 'PRASSINATURA_CAB',
    15: 'PRASSINATURA_DOC',
    16: 'PRASSINAT_DOC_PRCHKGERAL',

## apps/api/src/modulos/farmacia/gravador-avaliacao.ts
- modelo-pendente: linhas 45,51
    45: * F2.4, em docs/obra/fatias/f24/saida/21-misto-farmacia.json): 409, nada gravado, com o código `modelo-pendente`
    51: 'modelo-pendente',

## apps/api/src/modulos/farmacia/operacoes.ts
- modelo-pendente: linhas 2
    2: // A porta em memória aplica o mesmo Zod; a porta própria recusa com 'modelo-pendente' as que ainda não gravam no banco próprio.

## apps/api/src/modulos/farmacia/porta-propria.ts
- modelo-pendente: linhas 17,148,170,415,465
    17: // essas leituras e essas gravações recusam com 'modelo-pendente' (409); nada é gravado pela metade.
    148: codigo: 'modelo-pendente',
    170: * recusam com 'modelo-pendente', cada uma com o seu pedido no lote 21-misto-farmacia da F2.4.
    415: // principais recusam com 409 'modelo-pendente' (a tela mostra a pendência, nunca uma fila ou um livro vazio como se
    465: 'modelo-pendente',

## packages/dominio-atendimento/dist/impressos.d.ts
- vocab-antigo: linhas 11
    11: readonly retorno: 'S' | 'N';

## packages/dominio-atendimento/dist/teleconsulta/regras.d.ts
- vocab-antigo: linhas 6
    6: /** O relógio do estabelecimento (data AAAA-MM-DD e hora HHMM), como o do banco. */
