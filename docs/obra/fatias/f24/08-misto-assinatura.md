# Fatia F2.4 08-misto-assinatura (assunto: assinatura+especialidades+exames+manutencao+nutricao+portal-medico+portaria+precos+recepcao+sus+formatacao+onda2+cadastro+config+organizacao; cliente de teste próprio: f24_08mistoassinatura)

## apps/api/src/modulos/assinatura/porta-propria.ts
- modelo-pendente: linhas 165
    165: 'modelo-pendente',

## apps/api/src/modulos/especialidades/porta-propria.ts
- modelo-pendente: linhas 16,90
    16: // gravações recusam com 'modelo-pendente' (409), dizendo o que falta; nada é gravado pela metade.
    90: 'modelo-pendente',

## apps/api/src/modulos/exames/relogio.ts
- vocab-antigo: linhas 20,75
    20: /** Forma antiga (hora HHMM em quatro dígitos), só para os módulos de fora da agenda de exames. */
    75: * `hhmm` é a forma antiga HHMM em quatro dígitos (ADT, portaria, TISS…), que sai na troca coordenada.

## apps/api/src/modulos/manutencao/porta-propria.ts
- modelo-pendente: linhas 30,174
    30: // código `modelo-pendente` (nada é gravado pela metade) e as leituras devolvem vazio.
    174: 'modelo-pendente',

## apps/api/src/modulos/nutricao/porta-propria.ts
- modelo-pendente: linhas 23,128
    23: // respondem "modelo-pendente" (409), sem gravar nada.
    128: 'modelo-pendente',

## apps/api/src/modulos/portal-medico/porta-propria.ts
- modelo-pendente: linhas 99
    99: 'modelo-pendente',

## apps/api/src/modulos/portaria/porta-propria.ts
- modelo-pendente: linhas 136
    136: 'modelo-pendente',

## apps/api/src/modulos/precos/fonte-propria.ts
- modelo-pendente: linhas 976
    976: new ErroOperacao(409, 'modelo-pendente', 'Recurso aguardando o modelo do banco', `${o} aguarda a coluna ou tabela no modelo do banco (pedido registrado): nada foi gravado.`);

## apps/api/src/modulos/recepcao/porta-propria.ts
- modelo-pendente: linhas 89
    89: 'modelo-pendente',

## apps/api/src/modulos/sus/porta-propria.ts
- modelo-pendente: linhas 17,81
    17: // essas leituras saem vazias e as gravações recusam com "modelo-pendente". A montagem a partir da conta própria
    81: 'modelo-pendente',

## packages/contratos/src/formatacao/hora-legada.ts
- vocab-antigo: linhas 1,6,12,24,34,58,62
    1: // Hora legada (regra 8 do M07; cap-10 §10.2; porta de toHHMM e formatHora da sante-api, src/utils/sgh.js).
    6: export const FORMATO_HHMM = /^([01]\d|2[0-3])[0-5]\d$/;
    12: /** Aceita "HH:MM", "HHMM", "H:MM" e "HMM"; devolve sempre "HHMM" (quatro dígitos) ou lança. */
    24: if (!FORMATO_HHMM.test(hhmm)) {
    34: /** "HHMM" do legado → "HH:MM" para a tela. Vazio ou nulo → null; já formatado passa como está. */
    58: if (hhmm === null || !FORMATO_HHMM.test(hhmm)) return { tipo: 'invalida', bruto: valor };
    62: /** Contrato: hora trafega como "HHMM"; a entrada aceita os formatos da tela e é convertida. */

## packages/contratos/src/onda2/onda2.ts
- nome-origem: linhas 395,396,397,398,399,400,401,402,403,420,426,432,438,445,452,459,466
    395: 'TBLEITO',
    396: 'TBACOMODLEITO',
    397: 'TBSGHCONEXAO',
    398: 'ATCONTA',
    399: 'RICONTAS',
    400: 'RICGUIAS',
    401: 'RECONTAS',
    402: 'FCCTAEXT',
    403: 'RILEITOS',
    420: tabela: 'RILEITOS',
    426: tabela: 'RILEITOS',
    432: tabela: 'RILEITOS',

## packages/dominio-cadastro/dist/documento/cpf.d.ts  (só comentário)
- nome-origem: linhas 9
    9: /** Para gravar: o número do CPF (RICADPAC.CPF é numérico). Recusa o inválido. */

## packages/dominio-cadastro/dist/profissional/categoria.d.ts  (só comentário)
- nome-origem: linhas 11,13
    11: /** TBCBOPRO.ATIVO: T ativo, F inativo, nulo desconhecido (2 registros). */
    13: /** O profissional está ativo se algum registro está (a situação do TBPROFIS é "a confirmar"). */

## packages/dominio-config/dist/fim-coexistencia/usuarios-restantes.d.ts  (só comentário)
- nome-origem: linhas 5,7
    5: /** TBUSERS.STATUS ('T' ativo). */
    7: /** TBUSERS.BLOQUEADO ('T' bloqueado; 'F' ou nulo, livre). */

## packages/dominio-config/dist/homologacao/homologacao.d.ts  (só comentário)
- nome-origem: linhas 84
    84: /** Tabelas gravadas e a ação (`SIPACAGD (INSERT)`), para a TI localizar o que abrir. */

## packages/dominio-organizacao/dist/conferencia-leitos.d.ts  (só comentário)
- nome-origem: linhas 5,13,57
    5: /** RILEITOS.STATUS = 'A' (ou vazio, que o legado trata como ativo). */
    13: /** TBACOMODLEITO.TP_ATENDIMENTO: 'I' internação (espelho do RILEITOS) ou 'E' externo. */
    57: /** RILEITOS.STATUS: 'A' ativo, 'I' inativo; vazio conta como ativo (como o trigger do espelho trata). */

## packages/dominio-organizacao/dist/hierarquia.d.ts  (só comentário)
- nome-origem: linhas 49
    49: /** Ocupação (RILEITOS.REG > 0): só leitura no cadastro (regra 14). */
