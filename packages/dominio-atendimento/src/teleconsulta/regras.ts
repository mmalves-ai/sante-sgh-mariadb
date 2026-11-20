// Regras puras da telemedicina (M50, etapa 4; ficha, regra 7; cap-13 §13.3.5 TELE-01 a TELE-04; Res. CFM 2.314/2022):
//   - a sala de espera virtual abre 30 minutos antes do horário e fecha 2 horas depois; o paciente entra com o termo
//     vigente aceito e o local informado (TELE-02);
//   - o médico só inicia com o paciente na sala de espera (termo e local), no dia marcado, com o vínculo profissional e o
//     conselho ativo (ato médico); a teleconsulta abre o atendimento como uma consulta (TELE-01);
//   - o alerta do crônico sem consulta presencial há mais de 180 dias (TELE-04): o médico vê e decide, com a ciência
//     registrada;
//   - os documentos do atendimento de teleconsulta levam a marca da modalidade;
//   - a teleinterconsulta: pedida por um médico a outro do corpo clínico, com o consentimento do paciente; responde só o
//     convidado; cancela só quem pediu, antes do parecer.
import {
  DIAS_ALERTA_CRONICO,
  MARCA_TELEMEDICINA,
  MINUTOS_ANTES_SALA_ESPERA,
  MINUTOS_DEPOIS_SALA_ESPERA,
  type AlertaCronico,
  type MotivoEncerramentoTeleconsulta,
  type SituacaoTeleconsulta,
} from '@sgh/contratos';

export interface Decisao {
  readonly pode: boolean;
  readonly motivo: string | null;
}

const sim: Decisao = { pode: true, motivo: null };
const nao = (motivo: string): Decisao => ({ pode: false, motivo });

/** O relógio do estabelecimento (data AAAA-MM-DD e hora HHMM), como o do banco. */
export interface RelogioTele {
  readonly hoje: string;
  readonly hhmm: string;
}

/** Minutos desde 1970 de uma data e hora civis (sem fuso: tudo no relógio do estabelecimento). */
export function minutosCivis(data: string, hhmm: string): number {
  const [a, m, d] = data.split('-').map(Number);
  const h = Number(hhmm.slice(0, 2));
  const mi = Number(hhmm.slice(2, 4));
  return Math.floor(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1, h, mi) / 60_000);
}

const civil = (min: number) => new Date(min * 60_000).toISOString().slice(0, 16);

export interface JanelaSalaEspera {
  readonly aberta: boolean;
  /** AAAA-MM-DDTHH:MM no relógio do estabelecimento. */
  readonly abreEm: string;
  readonly fechaEm: string;
  readonly motivo: string | null;
}

/** A janela da sala de espera: 30 minutos antes do horário marcado até 2 horas depois. */
export function janelaSalaEspera(t: { data: string; hora: string }, r: RelogioTele): JanelaSalaEspera {
  const marcado = minutosCivis(t.data, t.hora);
  const abre = marcado - MINUTOS_ANTES_SALA_ESPERA;
  const fecha = marcado + MINUTOS_DEPOIS_SALA_ESPERA;
  const agora = minutosCivis(r.hoje, r.hhmm);
  const base = { abreEm: civil(abre), fechaEm: civil(fecha) };
  if (agora < abre)
    return {
      ...base,
      aberta: false,
      motivo: `A sala de espera abre ${MINUTOS_ANTES_SALA_ESPERA} minutos antes do horário marcado.`,
    };
  if (agora > fecha) return { ...base, aberta: false, motivo: 'O horário desta teleconsulta já passou.' };
  return { ...base, aberta: true, motivo: null };
}

const ABERTAS: ReadonlySet<SituacaoTeleconsulta> = new Set([
  'agendada',
  'aguardando',
  'sala-aberta',
  'em-andamento',
]);

/** A teleconsulta ainda pode acontecer (não encerrada nem cancelada). */
export const teleconsultaAberta = (s: SituacaoTeleconsulta): boolean => ABERTAS.has(s);

/** O paciente pode entrar na sala de espera (aceitar o termo, informar o local) agora? */
export function podeEntrarSalaEspera(
  t: { situacao: SituacaoTeleconsulta; data: string; hora: string },
  r: RelogioTele,
  ligada: boolean,
): Decisao {
  if (!ligada) return nao('A teleconsulta ainda não foi liberada neste estabelecimento.');
  if (!teleconsultaAberta(t.situacao))
    return nao(
      t.situacao === 'cancelada' ? 'Esta teleconsulta foi cancelada.' : 'Esta teleconsulta já foi encerrada.',
    );
  const j = janelaSalaEspera(t, r);
  // Com o médico já na sala, o paciente entra mesmo depois do fim da janela (o atendimento está acontecendo).
  if (!j.aberta && !(t.situacao === 'sala-aberta' || t.situacao === 'em-andamento'))
    return nao(j.motivo ?? 'A sala de espera não está aberta.');
  return sim;
}

export interface QuemInicia {
  readonly ligada: boolean;
  readonly podeRealizar: boolean;
  /** O vínculo profissional da sessão, com o conselho ativo (ato médico). */
  readonly profissional: { readonly conselhoAtivo: boolean } | null;
}

/** O médico pode iniciar (abrir a sala e o atendimento)? */
export function podeIniciarTeleconsulta(
  t: {
    situacao: SituacaoTeleconsulta;
    data: string;
    termo: boolean;
    local: boolean;
    atendimento: number | null;
  },
  r: RelogioTele,
  q: QuemInicia,
): Decisao {
  if (!q.ligada) return nao('A telemedicina está em consulta neste estabelecimento: a liberação é pendente.');
  if (!q.podeRealizar) return nao('Seu perfil não permite realizar teleconsulta.');
  if (!q.profissional) return nao('Seu usuário não tem vínculo profissional para o ato médico.');
  if (!q.profissional.conselhoAtivo) return nao('O registro no conselho do seu vínculo não está ativo.');
  if (t.atendimento !== null || t.situacao === 'em-andamento')
    return nao('A teleconsulta já foi iniciada: o atendimento está aberto.');
  if (!teleconsultaAberta(t.situacao)) return nao('Esta teleconsulta foi encerrada ou cancelada.');
  if (t.data !== r.hoje) return nao('A teleconsulta só é iniciada no dia marcado.');
  if (t.situacao === 'agendada' || !t.termo || !t.local)
    return nao('O paciente ainda não entrou na sala de espera (termo aceito e local informado).');
  return sim;
}

/** O médico pode encerrar com este motivo? (concluída só depois do atendimento aberto). */
export function podeEncerrarTeleconsulta(
  t: { situacao: SituacaoTeleconsulta },
  motivo: MotivoEncerramentoTeleconsulta | null,
): Decisao {
  if (!teleconsultaAberta(t.situacao)) return nao('Esta teleconsulta já foi encerrada ou cancelada.');
  if (motivo === 'concluida' && t.situacao !== 'em-andamento')
    return nao('Só a teleconsulta com o atendimento aberto é encerrada como concluída.');
  return sim;
}

// ── Alerta do crônico (TELE-04) ────────────────────────────────────────────────────────────────────────────────────

/** Grupos de CID-10 de condição crônica (letra e dois dígitos, de-até), para o alerta da presencial. */
export const GRUPOS_CID_CRONICOS: readonly { de: string; ate: string; rotulo: string }[] = [
  { de: 'B20', ate: 'B24', rotulo: 'HIV' },
  { de: 'C00', ate: 'C97', rotulo: 'neoplasia maligna' },
  { de: 'E03', ate: 'E03', rotulo: 'hipotireoidismo' },
  { de: 'E10', ate: 'E14', rotulo: 'diabetes' },
  { de: 'E66', ate: 'E66', rotulo: 'obesidade' },
  { de: 'E78', ate: 'E78', rotulo: 'dislipidemia' },
  { de: 'F20', ate: 'F20', rotulo: 'esquizofrenia' },
  { de: 'F31', ate: 'F33', rotulo: 'transtorno do humor' },
  { de: 'G20', ate: 'G20', rotulo: 'Parkinson' },
  { de: 'G30', ate: 'G30', rotulo: 'Alzheimer' },
  { de: 'G40', ate: 'G40', rotulo: 'epilepsia' },
  { de: 'I10', ate: 'I15', rotulo: 'hipertensão' },
  { de: 'I20', ate: 'I25', rotulo: 'doença isquêmica do coração' },
  { de: 'I48', ate: 'I48', rotulo: 'fibrilação atrial' },
  { de: 'I50', ate: 'I50', rotulo: 'insuficiência cardíaca' },
  { de: 'J44', ate: 'J45', rotulo: 'DPOC ou asma' },
  { de: 'K74', ate: 'K74', rotulo: 'cirrose' },
  { de: 'M05', ate: 'M06', rotulo: 'artrite reumatoide' },
  { de: 'N18', ate: 'N18', rotulo: 'doença renal crônica' },
];

/** O grupo crônico do CID (A00, A000, A00.0…), ou null. */
export function grupoCronico(cid: string | null): string | null {
  const c = (cid ?? '').trim().toUpperCase().replace('.', '');
  if (!/^[A-Z]\d{2}/.test(c)) return null;
  const tres = c.slice(0, 3);
  const g = GRUPOS_CID_CRONICOS.find((x) => tres >= x.de && tres <= x.ate);
  return g ? `${g.de === g.ate ? g.de : `${g.de}-${g.ate}`} ${g.rotulo}` : null;
}

export interface AtendimentoDoHistorico {
  /** AAAA-MM-DD. */
  readonly data: string;
  /** Código do CID principal (sem ponto), ou null. */
  readonly cid: string | null;
  /** O atendimento foi uma teleconsulta (não conta como presencial). */
  readonly teleconsulta: boolean;
  /** Requisição de laboratório não é consulta (fica fora). */
  readonly laboratorio?: boolean;
}

const dias = (de: string, ate: string) =>
  Math.floor((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/**
 * O alerta do crônico: o paciente tem CID de condição crônica nos atendimentos dos últimos dois anos e a última consulta
 * presencial foi há mais de 180 dias (ou não há nenhuma no histórico lido).
 */
export function alertaCronico(historico: readonly AtendimentoDoHistorico[], hoje: string): AlertaCronico {
  const validos = historico.filter((h) => !h.laboratorio && dias(h.data, hoje) >= 0);
  const recentes = validos.filter((h) => dias(h.data, hoje) <= 730);
  const condicoes = [...new Set(recentes.map((h) => grupoCronico(h.cid)).filter((g) => g !== null))].sort();
  const presenciais = validos
    .filter((h) => !h.teleconsulta)
    .map((h) => h.data)
    .sort();
  const ultima = presenciais.at(-1) ?? null;
  const diasSem = ultima === null ? null : dias(ultima, hoje);
  const cronico = condicoes.length > 0;
  const alerta = cronico && (diasSem === null || diasSem > DIAS_ALERTA_CRONICO);
  return {
    cronico,
    condicoes,
    ultimaPresencial: ultima,
    diasSemPresencial: diasSem,
    alerta,
    mensagem: !alerta
      ? null
      : diasSem === null
        ? `Paciente com condição crônica sem consulta presencial no histórico: avalie a indicação do atendimento presencial.`
        : `Paciente com condição crônica sem consulta presencial há ${diasSem} dias (mais de ${DIAS_ALERTA_CRONICO}): avalie a indicação do atendimento presencial.`,
  };
}

/** Com o alerta, o médico só inicia com a ciência registrada. */
export function exigirCienciaDoAlerta(a: AlertaCronico | null, ciente: boolean): Decisao {
  if (a?.alerta && !ciente)
    return nao('Confirme que viu o alerta do paciente crônico sem consulta presencial antes de iniciar.');
  return sim;
}

// ── Documentos ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** As linhas do documento com a marca da telemedicina no fim (sem repetir). */
export function linhasComMarcaTelemedicina(linhas: readonly string[], teleconsulta: boolean): string[] {
  if (!teleconsulta || linhas.includes(MARCA_TELEMEDICINA)) return [...linhas];
  return [...linhas, '', MARCA_TELEMEDICINA];
}

// ── Teleinterconsulta ──────────────────────────────────────────────────────────────────────────────────────────────

export function podeSolicitarTeleinterconsulta(o: {
  ligada: boolean;
  podeRealizar: boolean;
  solicitante: { vinculo: number; conselhoAtivo: boolean } | null;
  convidado: { vinculo: number; ativo: boolean; medico: boolean } | null;
  atendimentoAberto: boolean;
}): Decisao {
  if (!o.ligada) return nao('A telemedicina está em consulta neste estabelecimento: a liberação é pendente.');
  if (!o.podeRealizar) return nao('Seu perfil não permite pedir teleinterconsulta.');
  if (!o.solicitante?.conselhoAtivo)
    return nao('Pedir teleinterconsulta é ato médico: falta o conselho ativo.');
  if (!o.atendimentoAberto) return nao('O atendimento não está aberto.');
  if (!o.convidado) return nao('O profissional convidado não foi encontrado.');
  if (!o.convidado.ativo || !o.convidado.medico)
    return nao('O convidado precisa ser médico ativo do corpo clínico.');
  if (o.convidado.vinculo === o.solicitante.vinculo) return nao('Convide outro médico.');
  return sim;
}

const INTER_ABERTAS: ReadonlySet<SituacaoTeleconsulta> = new Set(['solicitada', 'sala-aberta']);

export function podeResponderTeleinterconsulta(
  t: { situacao: SituacaoTeleconsulta; convidado: number },
  o: { ligada: boolean; podeRealizar: boolean; vinculo: number | null; conselhoAtivo: boolean },
): Decisao {
  if (!o.ligada) return nao('A telemedicina está em consulta neste estabelecimento: a liberação é pendente.');
  if (!o.podeRealizar) return nao('Seu perfil não permite responder teleinterconsulta.');
  if (!INTER_ABERTAS.has(t.situacao)) return nao('Esta teleinterconsulta já foi respondida ou cancelada.');
  if (o.vinculo !== t.convidado) return nao('Só o médico convidado responde esta teleinterconsulta.');
  if (!o.conselhoAtivo) return nao('O registro no conselho do seu vínculo não está ativo.');
  return sim;
}

export function podeCancelarTeleinterconsulta(
  t: { situacao: SituacaoTeleconsulta; solicitante: string },
  o: { ligada: boolean; login: string },
): Decisao {
  if (!o.ligada) return nao('A telemedicina está em consulta neste estabelecimento: a liberação é pendente.');
  if (!INTER_ABERTAS.has(t.situacao)) return nao('Esta teleinterconsulta já foi respondida ou cancelada.');
  if (t.solicitante !== o.login) return nao('Só quem pediu cancela a teleinterconsulta.');
  return sim;
}
