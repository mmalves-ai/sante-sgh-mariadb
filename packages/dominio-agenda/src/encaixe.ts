// Encaixe (ficha do M17, `agenda.encaixar`/`agenda.desfazerEncaixe` e regra 6; ref 01 §3.3; sante-api:
// src/services/acoes-encaixe.js). No legado, encaixe não é um segundo paciente no mesmo minuto (a chave
// (NOME, CRM, DATA, HORA) de REPACAGI e o índice único de REPACAGD impedem): é uma linha nova da grade num
// minuto que a grade não ocupa, marcada TIPOHR 'E', que nunca vira vaga pública.
//   Vetos: agenda inativa; data além de 1 ano; horário que já passou; paciente sem prontuário; trio do
//   prontuário ambíguo; minuto ocupado na grade OU nas marcações (há marcações órfãs, sem horário).
//   Alertas: dia sem grade normal; sobreposição com a duração do vizinho anterior; agenda não lotada (há vaga
//   normal futura no dia, que é o caminho certo); limite de encaixes por turno do parâmetro do novo.
//   Desfazer: só até o check-in (senha de atendimento ligada ou ATENDIDO='S' recusam).
import { ehVaga, type LinhaGrade } from './estado-horario.js';
import { deMinutos, formatarHora, horarioJaPassou, paraMinutos, type Relogio, umAnoDepois } from './tempo.js';

export type VetoEncaixe =
  | 'agenda-inativa'
  | 'alem-de-um-ano'
  | 'horario-passado'
  | 'sem-prontuario'
  | 'prontuario-ambiguo'
  | 'minuto-ocupado'
  | 'limite-do-turno';

export type AlertaEncaixe = 'dia-sem-grade' | 'sobreposicao' | 'agenda-nao-lotada';

export interface PedidoEncaixe {
  readonly data: string;
  readonly hora: string;
}

export interface ContextoEncaixe {
  readonly relogio: Relogio;
  readonly agendaAtiva: boolean;
  /** Horários do dia na grade (normais e encaixes). */
  readonly gradeDoDia: readonly (LinhaGrade & { readonly duracao: string })[];
  /** Horas 'HHMM' com marcação no dia (inclui as órfãs, sem horário na grade). */
  readonly marcadasNoDia: readonly string[];
  readonly duracaoAgendaMin: number | null;
  readonly pacienteTemProntuario: boolean;
  /** Mais de um cadastro com o mesmo trio do prontuário (o gatilho estouraria). */
  readonly prontuarioAmbiguo: boolean;
  /** Parâmetro do novo: encaixes por turno (manhã antes das 12:00, tarde depois); null = sem limite. */
  readonly limitePorTurno?: number | null;
}

export interface AvaliacaoEncaixe {
  readonly vetos: readonly { codigo: VetoEncaixe; texto: string }[];
  readonly alertas: readonly { codigo: AlertaEncaixe; texto: string }[];
  /** Sugestão de minuto livre mais próximo depois do pedido (quando o pedido está ocupado). */
  readonly sugestao: string | null;
  /** Vagas normais futuras do dia (quando a agenda não está lotada). */
  readonly vagasNormais: readonly string[];
}

const turno = (hhmm: string) => (paraMinutos(hhmm) < 12 * 60 ? 'manha' : 'tarde');

/** Primeiro minuto livre a partir de `hora` (inclusive), no mesmo dia; null se não houver. */
export function proximoMinutoLivre(hora: string, ocupados: ReadonlySet<string>): string | null {
  for (let m = paraMinutos(hora); m < 1440; m++) {
    const h = deMinutos(m);
    if (!ocupados.has(h)) return h;
  }
  return null;
}

export function avaliarEncaixe(p: PedidoEncaixe, c: ContextoEncaixe): AvaliacaoEncaixe {
  const vetos: { codigo: VetoEncaixe; texto: string }[] = [];
  const alertas: { codigo: AlertaEncaixe; texto: string }[] = [];
  if (!c.agendaAtiva) vetos.push({ codigo: 'agenda-inativa', texto: 'A agenda está inativa.' });
  if (p.data > umAnoDepois(c.relogio.hoje))
    vetos.push({ codigo: 'alem-de-um-ano', texto: 'Encaixe só até um ano à frente.' });
  if (horarioJaPassou(p, c.relogio))
    vetos.push({
      codigo: 'horario-passado',
      texto: `O horário ${formatarHora(p.hora)} de ${p.data} já passou pelo relógio do servidor.`,
    });
  if (!c.pacienteTemProntuario)
    vetos.push({ codigo: 'sem-prontuario', texto: 'O paciente precisa ter prontuário para o encaixe.' });
  if (c.prontuarioAmbiguo)
    vetos.push({
      codigo: 'prontuario-ambiguo',
      texto: 'Há mais de um cadastro com o mesmo prontuário: resolva a duplicidade antes de marcar.',
    });
  const ocupados = new Set([...c.gradeDoDia.map((g) => g.hora), ...c.marcadasNoDia]);
  let sugestao: string | null = null;
  if (ocupados.has(p.hora)) {
    sugestao = proximoMinutoLivre(p.hora, ocupados);
    vetos.push({
      codigo: 'minuto-ocupado',
      texto: `O minuto ${formatarHora(p.hora)} já existe na agenda${sugestao ? `: o próximo livre é ${formatarHora(sugestao)}` : ''}.`,
    });
  }
  if (c.limitePorTurno !== undefined && c.limitePorTurno !== null) {
    const t = turno(p.hora);
    const n = c.gradeDoDia.filter((g) => g.tipo.trim() === 'E' && turno(g.hora) === t).length;
    if (n >= c.limitePorTurno)
      vetos.push({
        codigo: 'limite-do-turno',
        texto: `O limite de ${c.limitePorTurno} encaixe(s) por turno já foi atingido neste turno.`,
      });
  }
  const normais = c.gradeDoDia.filter((g) => g.tipo.trim() !== 'E');
  if (normais.length === 0)
    alertas.push({ codigo: 'dia-sem-grade', texto: 'O dia não tem horários normais na agenda.' });
  // Vizinho anterior: o último horário que começa antes do pedido; com a duração dele, termina depois?
  const antes = [...c.gradeDoDia]
    .filter((g) => g.hora < p.hora)
    .sort((a, b) => a.hora.localeCompare(b.hora))
    .at(-1);
  if (antes) {
    const dur =
      (antes.duracao && antes.duracao !== '0000' ? paraMinutos(antes.duracao) : null) ?? c.duracaoAgendaMin;
    if (dur && paraMinutos(antes.hora) + dur > paraMinutos(p.hora))
      alertas.push({
        codigo: 'sobreposicao',
        texto: `O encaixe começa antes de terminar o atendimento das ${formatarHora(antes.hora)}.`,
      });
  }
  const vagasNormais = normais
    .filter((g) => ehVaga(g) && !horarioJaPassou(g, c.relogio))
    .map((g) => g.hora)
    .sort();
  if (vagasNormais.length > 0)
    alertas.push({
      codigo: 'agenda-nao-lotada',
      texto: `A agenda ainda tem ${vagasNormais.length} vaga(s) normal(is) neste dia (a primeira às ${formatarHora(vagasNormais[0])}): prefira marcar nela.`,
    });
  return { vetos, alertas, sugestao, vagasNormais };
}

/** Desfazer o encaixe só até o check-in. */
export function podeDesfazerEncaixe(m: { temSenha: boolean; atendido: string }): boolean {
  return !m.temSenha && m.atendido.trim() !== 'S';
}
