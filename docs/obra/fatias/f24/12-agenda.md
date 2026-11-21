# Fatia F2.4 12-agenda (assunto: agenda; cliente de teste próprio: f24_12agenda)

## apps/api/src/modulos/agenda/porta-propria.ts
- vocab-antigo: linhas 45,1531
    45: import { duracaoHHMM, feriadosMoveis } from '@sgh/dominio-agenda';
    1531: duracao: a['duracao_horario_minutos'] ? duracaoHHMM(num(a['duracao_horario_minutos'])) : '',

## apps/api/src/modulos/agenda/visao.ts
- vocab-antigo: linhas 7,22,48,50
    7: import { duracaoHHMM, duracaoMinutos, normalizarHora } from '@sgh/dominio-agenda';
    22: export const duracaoDigitos = (m: number | null | undefined): string => (m ? duracaoHHMM(m) : '');
    48: readonly ativa: 'S' | 'N';
    50: readonly teleatendimento: 'S' | 'N';

## apps/web/src/modulos/agenda/formato.ts
- vocab-antigo: linhas 1,10,17
    1: // Formatos da agenda na tela: datas dd/mm/aaaa, horas HH:MM e a hora digitada (HH:MM ou HHMM) para o contrato.
    10: /** HHMM ou HH:MM → HH:MM. */
    17: /** Hora digitada (HH:MM, HHMM ou H:MM) → HHMM do contrato; null quando inválida. */

## packages/contratos/src/agenda/entradas.ts
- vocab-antigo: linhas 3,6,15,226,227
    3: // e o CRM sob a trava), o paciente é o ID do cadastro único, a marcação é o ID de REPACAGD. Horas em HHMM de 4
    6: import { FORMATO_HHMM } from '../formatacao/hora-legada.js';
    15: export const esquemaHhmm = z.string().regex(FORMATO_HHMM, 'Hora no formato HHMM (00:00 a 23:59).');
    226: ativa: z.enum(['S', 'N']).optional(),
    227: teleatendimento: z.enum(['S', 'N']).optional(),
- nome-origem: linhas 2,3,27,85
    2: // na API e no executor (o mesmo Zod). Vocabulário do novo: a agenda é o ID de REAGENDA (a receita resolve o NOME
    3: // e o CRM sob a trava), o paciente é o ID do cadastro único, a marcação é o ID de REPACAGD. Horas em HHMM de 4
    27: /** Recado do balcão (REPACAGD.OBS, BLOB): até 500 caracteres CP1252. */
    85: /** Cadastro único (RICADPAC.ID): o prontuário e o contato vêm dele. */

## packages/contratos/src/agenda/exame.ts
- vocab-antigo: linhas 4
    4: // de SIPACAGD, o exame escolhido é o ID do catálogo do SADT (SITABPRO). Horas em HHMM de 4 dígitos (a tela converte
- nome-origem: linhas 3,4,29
    3: // SIAGENDA (a receita resolve NOME, CRM e EXAME sob a trava), o paciente é o ID do cadastro único, a marcação é o ID
    4: // de SIPACAGD, o exame escolhido é o ID do catálogo do SADT (SITABPRO). Horas em HHMM de 4 dígitos (a tela converte
    29: /** SICANAGE.MOTIVO tem 30 posições (o texto livre do legado tem de 1 a 24 caracteres em 2026). */

## packages/contratos/src/agenda/sessoes.ts
- vocab-antigo: linhas 8,45
    8: import { FORMATO_HHMM } from '../formatacao/hora-legada.js';
    45: const hhmm = z.string().regex(FORMATO_HHMM, 'Hora no formato HHMM.');
- nome-origem: linhas 3,4,5,39,51,53,55,57,109
    3: // recurso nem do paciente, com a complexidade e a duração dos domínios do agendamento (AGCOMPLEXIDADE, AGDURACAO) e a
    4: // faixa etária do recurso. Os recursos são as cadeiras e salas do cadastro de agendas do agendamento (AGCADAGENDA e
    5: // AGCADEIRA, pelo CRUD genérico); as sessões ficam só no novo (SGH_AGE_SESSAO). Desligada até o serviço existir (chave
    39: /** A duração da sessão em minutos (a categoria curta, média ou longa vem do domínio AGDURACAO). */
    51: /** RICADPAC.ID do paciente (escolhido pela busca do cadastro). */
    53: /** O recurso (AGCADEIRA.ID_CADEIRA): a cadeira ou a sala; a agenda vem dele. */
    55: /** AGCOMPLEXIDADE.ID_COMPLEXIDADE da sessão (1 a 3; 0 = "todas" não é complexidade de sessão). */
    57: /** AGDURACAO.ID_DURACAO da sessão (1 a 3). */
    109: /** Uma cadeira ou sala (AGCADEIRA) com a agenda (AGCADAGENDA) a que pertence. */

## packages/contratos/src/agenda/vocabulario.ts  (só comentário)
- nome-origem: linhas 3,4,6,7,12,36,47,56,95
    3: // RECANAGE.MOTIVO, 1.160 "." e 858 "ca" desde 10/2025; TBMOTCANCCAD está vazia), canais da marcação (o valor
    4: // que o legado grava em REPACAGD.TP_AGE pelo domínio RETIPAGE: 0 não informado, 10 presencial, 20 telefone,
    6: // (TBMOTCANCTP: 1 Agendamento, 2 Atendimento; o novo guarda o solicitante próprio), prioridades e situações da
    7: // lista de espera e resultados da confirmação ativa (TBESTADOCONFIRMACAO: 1 não confirmado, 2 confirmado,
    12: /** Texto gravado em RECANAGE.MOTIVO (até 300 caracteres, CP1252). */
    36: /** Texto do motivo para RECANAGE.MOTIVO: o do código, com o complemento (até 300 caracteres). */
    47: /** REPACAGD.TP_AGE (RETIPAGE.COD); null = o canal não existe no legado (fica só em SGH_AGE_MARCACAO_EXT). */
    56: // Portal do paciente: fora de RETIPAGE. Sem a resposta da DP-46.2, grava o mesmo valor que o call center grava hoje
    95: /** TBESTADOCONFIRMACAO: o resultado da tentativa de confirmação. */

## packages/dominio-agenda/src/cobertura.ts  (só comentário)
- nome-origem: linhas 9
    9: /** TBCONVEN.COD do particular (ref 01 §3.6; cobertura.js). */

## packages/dominio-agenda/src/encaixe.ts
- vocab-antigo: linhas 34
    34: /** Horas 'HHMM' com marcação no dia (inclui as órfãs, sem horário na grade). */
- nome-origem: linhas 3
    3: // (NOME, CRM, DATA, HORA) de REPACAGI e o índice único de REPACAGD impedem): é uma linha nova da grade num

## packages/dominio-agenda/src/estado-horario.ts  (só comentário)
- nome-origem: linhas 3,7,19,48,90
    3: //   - A legenda de SITUACAO é a de TBSITAGE: 'C' é Confirmado (não Cancelado: o cancelado sai da grade e vai
    7: //   - Comparecimento é REPACAGD.ATENDIDO em S/N; vigência = ativa e com horário que ainda não começou.
    19: /** TBSITAGE completa (16 linhas na cópia; 'N' e '' são "não informado"). */
    48: /** Linha da grade (REPACAGI) como as leituras a devolvem (texto aparado). */
    90: /** Marcação (REPACAGD) com o estado da grade ao lado. */

## packages/dominio-agenda/src/exame.ts  (só comentário)
- nome-origem: linhas 3,4,6,9,13,19,23,44,63,68,80,97,136
    3: //   - a categoria da agenda é SIAGENDA.ID_TBTABATO (21 Endoscopia digestiva, 24 Ultrassonografia, 42 Outros; o
    4: //     catálogo do SADT conhece também 15, 16, 25, 26, 27 e o ato 90, Métodos gráficos, que não tem linha em TBTABATO
    6: //   - SIPACAGD.TP_AGE é a categoria da marcação: 90 quando o horário é de EXAME 'O' (Outros: 4.593 de 4.594 nas
    9: //   - o exame grava o horário (SIPACAGI) E a marcação (SIPACAGD, com o prontuário): em 2026, todo horário ocupado tem
    13: //   - SIPACAGD.ATENDIDO usa T/F (F na marcação; nunca S/N) e PROCED é 0 nas duas tabelas.
    19: /** O código existe em TBTABATO (o ato 90 não existe: rótulo do novo). */
    23: /** As categorias que as agendas de exame e o catálogo do SADT (SITABPRO.ATO) usam. */
    44: /** SIAGENDA.EXAME / SIPACAGI.EXAME: o tipo de horário (E, U e O vistos; o resto é recusado). */
    63: /** SIPACAGD.TP_AGE da marcação: 90 para o horário de EXAME 'O'; senão a categoria da agenda. */
    68: /** TBSITAGE no exame: C é Confirmado; X é Cancelado (a sante-api usava C como cancelado). */
    80: /** Há marcação (SIPACAGD) no horário. */
    97: * = ocupado sem SIPACAGD (o que a sante-api grava hoje); "confirmado sem paciente" = 'C' com PACIENTE vazio (o

## packages/dominio-agenda/src/grade.ts
- vocab-antigo: linhas 6,19,49,85,118,384
    6: //   - Duração em minutos (5 a 240), gravada em HHMM; uma duração por geração (REAGECRI guarda uma só).
    19: duracaoHHMM,
    49: /** HHMM ou HH:MM. */
    85: /** Chaves 'AAAA-MM-DD HHMM' que já existem na agenda (qualquer tipo de horário). */
    118: /** HHMM. */
    384: const dur = duracaoHHMM(duracao);
- nome-origem: linhas 5,6,9,13,47,143,385,401,438
    5: //     RECTRAGE.HOR_FIN; intervalo: nenhum horário COMEÇA dentro de [início, fim).
    6: //   - Duração em minutos (5 a 240), gravada em HHMM; uma duração por geração (REAGECRI guarda uma só).
    9: //   - Feriados de TBFERIAD pulados (ano 9999 = todo ano); feriado móvel não cadastrado no ano vira alerta (o
    13: //   - Sábado e domingo: o legado nunca gerou (SEM1 e SEM7 'F' em 100% das gerações; RECTRAGE só de 2 a 6):
    47: /** 1 = domingo … 7 = sábado (o índice de RECTRAGE.SEMANA). */
    143: /** SEM1..SEM7 de REAGECRI ('T'/'F'). */
    385: // O modelo da semana (RECTRAGE) é o da escala pedida inteira, também no dia pulado por feriado.
    401: /** Linha do modelo da escala (RECTRAGE) como lida. */
    438: /** Faixas da escala (RECTRAGE) como pedido de geração. */

## packages/dominio-agenda/src/indicadores.ts  (só comentário)
- nome-origem: linhas 6
    6: //   - agrupar falta pela especialidade do NOME da agenda, nunca por REPACAGD.ESPEC (só se preenche na chegada);

## packages/dominio-agenda/src/online/regras.ts
- vocab-antigo: linhas 21
    21: /** Minutos entre o relógio e o horário (negativo: já passou). Datas AAAA-MM-DD e horas HHMM, sem fuso. */

## packages/dominio-agenda/src/sessoes/serie.ts
- vocab-antigo: linhas 65
    65: throw new ErroSessao('hora-invalida', 'Hora no formato HHMM.');
- nome-origem: linhas 147
    147: * A faixa etária gravada no recurso (AGCADEIRA.FAIXA_INICIAL/FINAL): a faixa padrão 0–99 e a vazia (0–0, a linha "não

## packages/dominio-agenda/src/tempo.ts
- vocab-antigo: linhas 2,6,15,49,50,55,113
    2: // texto 'HHMM' de 4 dígitos (100% das linhas de REPACAGI medidas) e a duração também em HHMM ('0100' são 60
    6: import { FORMATO_HHMM } from '@sgh/contratos';
    15: return FORMATO_HHMM.test(h);
    49: /** Duração em minutos → HHMM do legado (60 → "0100"; 15 → "0015"). */
    50: export function duracaoHHMM(minutos: number): string {
    55: /** Duração HHMM do legado → minutos ("0100" → 60); "0000", vazio ou inválido → null. */
    113: /** Relógio do BANCO (nunca o do processo): hoje e o minuto corrente 'HHMM'. */
- nome-origem: linhas 2,76
    2: // texto 'HHMM' de 4 dígitos (100% das linhas de REPACAGI medidas) e a duração também em HHMM ('0100' são 60
    76: /** Dia da semana como o legado (REAGECRI.SEM1..SEM7, RECTRAGE.SEMANA): 1 = domingo … 7 = sábado. */
