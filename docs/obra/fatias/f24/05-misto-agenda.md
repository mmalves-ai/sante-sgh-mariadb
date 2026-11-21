# Fatia F2.4 05-misto-agenda (assunto: agenda+cirurgia+enfermagem+patrimonio; cliente de teste próprio: f24_05mistoagenda)

## packages/dominio-agenda/dist/cobertura.d.ts  (só comentário)
- nome-origem: linhas 1
    1: /** TBCONVEN.COD do particular (ref 01 §3.6; cobertura.js). */

## packages/dominio-agenda/dist/encaixe.d.ts
- vocab-antigo: linhas 16
    16: /** Horas 'HHMM' com marcação no dia (inclui as órfãs, sem horário na grade). */

## packages/dominio-agenda/dist/estado-horario.d.ts  (só comentário)
- nome-origem: linhas 10,14,33
    10: /** TBSITAGE completa (16 linhas na cópia; 'N' e '' são "não informado"). */
    14: /** Linha da grade (REPACAGI) como as leituras a devolvem (texto aparado). */
    33: /** Marcação (REPACAGD) com o estado da grade ao lado. */

## packages/dominio-agenda/dist/exame.d.ts  (só comentário)
- nome-origem: linhas 4,7,11,27,29,40,46,56
    4: /** O código existe em TBTABATO (o ato 90 não existe: rótulo do novo). */
    7: /** As categorias que as agendas de exame e o catálogo do SADT (SITABPRO.ATO) usam. */
    11: /** SIAGENDA.EXAME / SIPACAGI.EXAME: o tipo de horário (E, U e O vistos; o resto é recusado). */
    27: /** SIPACAGD.TP_AGE da marcação: 90 para o horário de EXAME 'O'; senão a categoria da agenda. */
    29: /** TBSITAGE no exame: C é Confirmado; X é Cancelado (a sante-api usava C como cancelado). */
    40: /** Há marcação (SIPACAGD) no horário. */
    46: * = ocupado sem SIPACAGD (o que a sante-api grava hoje); "confirmado sem paciente" = 'C' com PACIENTE vazio (o
    56: /** Horários ocupados sem a marcação (SIPACAGD). */

## packages/dominio-agenda/dist/grade.d.ts
- vocab-antigo: linhas 13,45,62
    13: /** HHMM ou HH:MM. */
    45: /** Chaves 'AAAA-MM-DD HHMM' que já existem na agenda (qualquer tipo de horário). */
    62: /** HHMM. */
- nome-origem: linhas 11,92,114,131
    11: /** 1 = domingo … 7 = sábado (o índice de RECTRAGE.SEMANA). */
    92: /** SEM1..SEM7 de REAGECRI ('T'/'F'). */
    114: /** Linha do modelo da escala (RECTRAGE) como lida. */
    131: /** Faixas da escala (RECTRAGE) como pedido de geração. */

## packages/dominio-agenda/dist/online/regras.d.ts
- vocab-antigo: linhas 13
    13: /** Minutos entre o relógio e o horário (negativo: já passou). Datas AAAA-MM-DD e horas HHMM, sem fuso. */

## packages/dominio-agenda/dist/sessoes/serie.d.ts  (só comentário)
- nome-origem: linhas 55
    55: * A faixa etária gravada no recurso (AGCADEIRA.FAIXA_INICIAL/FINAL): a faixa padrão 0–99 e a vazia (0–0, a linha "não

## packages/dominio-agenda/dist/tempo.d.ts
- vocab-antigo: linhas 13,14,15,28
    13: /** Duração em minutos → HHMM do legado (60 → "0100"; 15 → "0015"). */
    14: export declare function duracaoHHMM(minutos: number): string;
    15: /** Duração HHMM do legado → minutos ("0100" → 60); "0000", vazio ou inválido → null. */
    28: /** Relógio do BANCO (nunca o do processo): hoje e o minuto corrente 'HHMM'. */
- nome-origem: linhas 18
    18: /** Dia da semana como o legado (REAGECRI.SEM1..SEM7, RECTRAGE.SEMANA): 1 = domingo … 7 = sábado. */

## apps/api/src/modulos/cirurgia/anestesia-porta-propria.ts
- modelo-pendente: linhas 9,55,65
    9: // GRAVAÇÕES da APA, da ficha e da SRPA recusam com 409 modelo-pendente até a implementação do gravador sobre ela, que
    55: return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_ANESTESIA_PENDENTE };
    65: new ErroOperacao(409, 'modelo-pendente', 'Gravação aguardando o modelo', MOTIVO_ANESTESIA_PENDENTE),

## apps/api/src/modulos/cirurgia/bloco-seguro-porta-propria.ts
- modelo-pendente: linhas 9,57,67
    9: // 409 modelo-pendente até a implementação do gravador sobre ela, que depende da chave de idempotência da requisição
    57: return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_BLOCO_PENDENTE };
    67: new ErroOperacao(409, 'modelo-pendente', 'Gravação aguardando o modelo', MOTIVO_BLOCO_PENDENTE),

## apps/api/src/modulos/cirurgia/operacoes.ts
- modelo-pendente: linhas 75
    75: new ErroOperacao(409, 'modelo-pendente', 'Operação aguardando o modelo', detalhe);

## apps/api/src/modulos/cirurgia/porta-propria.ts
- modelo-pendente: linhas 143,156
    143: if (pendente) return { pode: false, codigo: 'modelo-pendente', motivo: pendente };
    156: if (pendente) throw new ErroOperacao(409, 'modelo-pendente', 'Operação aguardando o modelo', pendente);

## apps/api/src/modulos/enfermagem/escores-porta-propria.ts
- modelo-pendente: linhas 22,171
    22: // Ainda recusadas com 'modelo-pendente' (a estrutura existe, falta ligar a porta): a decisão e a retificação da
    171: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/porta-propria.ts
- modelo-pendente: linhas 20,214
    20: // não as tem) e a resposta de extensão do formulário (sem tabela) recusam com 'modelo-pendente'.
    214: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/sae-porta-propria.ts
- modelo-pendente: linhas 19,88
    19: // identificador) e a terminologia licenciada carregada por estabelecimento respondem 409 modelo-pendente; as leituras
    88: 'modelo-pendente',

## packages/dominio-enfermagem/dist/tempo.d.ts
- vocab-antigo: linhas 10
    10: /** HH:mm (ou HHMM) → minutos do dia. */

## apps/api/src/modulos/patrimonio/porta-propria.ts
- modelo-pendente: linhas 21,145
    21: // `modelo-pendente` (nada é gravado pela metade) e as leituras devolvem vazio.
    145: 'modelo-pendente',

## packages/dominio-patrimonio/dist/movimento.d.ts  (só comentário)
- nome-origem: linhas 42
    42: /** O setor (TBCENCUS.ID) que recebe; só a transferência tem. */

## packages/dominio-patrimonio/dist/origem.d.ts  (só comentário)
- nome-origem: linhas 9,17,23
    9: /** GECADNFS.ID da nota do item. */
    17: /** Origens do banco (GPORIGEM): id → deprecia. */
    23: /** Centros de custo ativos (TBCENCUS.ID). */
