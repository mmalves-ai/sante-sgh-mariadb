// Gestão estratégica (C2-066, 01-ADM L118): mapa estratégico no modelo BSC (perspectivas, objetivos com relação de
// causa e efeito e indicadores ligados), iniciativas com ações, participantes e apontamento de horas, e as reuniões de
// análise crítica (prática ONA: pauta com as análises dos indicadores do período, participantes com presença, ata e
// deliberações com responsável e prazo). Regras puras, sem banco nem Nest: a porta própria grava o que daqui passa.

export type RecusaEstrategia =
  | 'mapa-vigencia'
  | 'objetivo-indicador-repetido'
  | 'objetivo-peso-incompleto'
  | 'objetivo-peso-soma'
  | 'iniciativa-periodo'
  | 'iniciativa-transicao'
  | 'iniciativa-acoes-abertas'
  | 'iniciativa-encerrada'
  | 'acao-periodo'
  | 'acao-fora-da-iniciativa'
  | 'acao-transicao'
  | 'apontamento-duracao'
  | 'apontamento-futuro'
  | 'apontamento-antes-do-inicio'
  | 'apontamento-dia-excedido'
  | 'apontamento-acao-fechada'
  | 'reuniao-transicao'
  | 'reuniao-sem-ata'
  | 'reuniao-presenca-pendente'
  | 'reuniao-sem-presente'
  | 'reuniao-encerrada'
  | 'reuniao-analise-fora-do-periodo'
  | 'reuniao-justificativa-ausencia'
  | 'deliberacao-prazo';

export const MENSAGEM_ESTRATEGIA: Readonly<Record<RecusaEstrategia, string>> = {
  'mapa-vigencia': 'O fim da vigência do mapa não pode ser antes do início.',
  'objetivo-indicador-repetido': 'O mesmo indicador aparece mais de uma vez no objetivo.',
  'objetivo-peso-incompleto': 'Informe o peso de todos os indicadores do objetivo, ou de nenhum.',
  'objetivo-peso-soma': 'Os pesos dos indicadores do objetivo precisam somar 100.',
  'iniciativa-periodo': 'O término previsto da iniciativa não pode ser antes do início.',
  'iniciativa-transicao': 'A iniciativa não pode passar para essa situação a partir da atual.',
  'iniciativa-acoes-abertas': 'A iniciativa só é concluída com todas as ações concluídas ou canceladas.',
  'iniciativa-encerrada': 'Iniciativa concluída ou cancelada não recebe ação nem apontamento.',
  'acao-periodo': 'O término previsto da ação não pode ser antes do início.',
  'acao-fora-da-iniciativa': 'A ação precisa caber no período previsto da iniciativa.',
  'acao-transicao': 'A ação não pode passar para essa situação a partir da atual.',
  'apontamento-duracao': 'A duração do apontamento vai de 1 minuto a 24 horas.',
  'apontamento-futuro': 'Não se apontam horas em data futura.',
  'apontamento-antes-do-inicio': 'Não se apontam horas antes do início previsto da ação.',
  'apontamento-dia-excedido': 'A soma das horas apontadas pela pessoa no dia passaria de 24 horas.',
  'apontamento-acao-fechada': 'Ação cancelada não recebe apontamento de horas.',
  'reuniao-transicao': 'A reunião não pode passar para essa situação a partir da atual.',
  'reuniao-sem-ata': 'A reunião só é encerrada com a ata registrada.',
  'reuniao-presenca-pendente': 'Marque a presença de todos os convocados antes de encerrar a reunião.',
  'reuniao-sem-presente': 'A reunião realizada precisa de ao menos um participante presente.',
  'reuniao-encerrada': 'Reunião encerrada ou cancelada não muda mais (as deliberações seguem o andamento).',
  'reuniao-analise-fora-do-periodo': 'A análise é de uma competência fora do período da reunião.',
  'reuniao-justificativa-ausencia': 'A ausência justificada exige a justificativa.',
  'deliberacao-prazo': 'O prazo da deliberação não pode ser antes da data da reunião.',
};

// ── Mapa e objetivos ───────────────────────────────────────────────────────────────────────────

export function validarMapa(m: { vigenciaInicio: string; vigenciaFim: string }): RecusaEstrategia[] {
  return m.vigenciaFim < m.vigenciaInicio ? ['mapa-vigencia'] : [];
}

export interface IndicadorDoObjetivo {
  readonly indicador: number;
  readonly peso?: number | null;
}

/** Indicadores ligados ao objetivo: sem repetição; pesos todos ou nenhum, e somando 100 quando informados. */
export function validarObjetivo(indicadores: readonly IndicadorDoObjetivo[]): RecusaEstrategia[] {
  const r: RecusaEstrategia[] = [];
  if (new Set(indicadores.map((i) => i.indicador)).size !== indicadores.length)
    r.push('objetivo-indicador-repetido');
  const comPeso = indicadores.filter((i) => i.peso !== null && i.peso !== undefined);
  if (comPeso.length > 0 && comPeso.length < indicadores.length) r.push('objetivo-peso-incompleto');
  else if (comPeso.length > 0) {
    const soma = comPeso.reduce((s, i) => s + Number(i.peso), 0);
    if (Math.abs(soma - 100) > 0.0001) r.push('objetivo-peso-soma');
  }
  return r;
}

export type Farol = 'verde' | 'amarelo' | 'vermelho' | 'sem_dado';
export interface ResultadoIndicadorObjetivo {
  readonly situacaoMeta: 'na_meta' | 'fora_da_meta' | 'sem_meta' | 'sem_valor' | null;
  readonly peso?: number | null;
}
export interface DesempenhoObjetivo {
  readonly farol: Farol;
  /** Percentual (0 a 100, duas casas) do peso dos indicadores com resultado que está na meta; null sem resultado. */
  readonly percentualNaMeta: number | null;
  readonly naMeta: number;
  readonly foraDaMeta: number;
  readonly semResultado: number;
}

/**
 * Farol do objetivo pela última apuração de cada indicador ligado (BSC): verde com 80% ou mais do peso na meta,
 * amarelo de 50% a menos de 80%, vermelho abaixo de 50%. Indicador sem meta ou sem valor não entra na conta (fica em
 * "sem resultado"); sem nenhum indicador com resultado, "sem_dado". Sem peso informado, todos pesam igual.
 */
export function desempenhoObjetivo(ind: readonly ResultadoIndicadorObjetivo[]): DesempenhoObjetivo {
  let naMeta = 0;
  let foraDaMeta = 0;
  let semResultado = 0;
  let pesoNa = 0;
  let pesoCom = 0;
  for (const i of ind) {
    const p = i.peso === null || i.peso === undefined ? 1 : Number(i.peso);
    if (i.situacaoMeta === 'na_meta') {
      naMeta++;
      pesoNa += p;
      pesoCom += p;
    } else if (i.situacaoMeta === 'fora_da_meta') {
      foraDaMeta++;
      pesoCom += p;
    } else semResultado++;
  }
  if (pesoCom <= 0) return { farol: 'sem_dado', percentualNaMeta: null, naMeta, foraDaMeta, semResultado };
  const pct = Math.round((pesoNa / pesoCom) * 10000) / 100;
  const farol: Farol = pct >= 80 ? 'verde' : pct >= 50 ? 'amarelo' : 'vermelho';
  return { farol, percentualNaMeta: pct, naMeta, foraDaMeta, semResultado };
}

// ── Iniciativas, ações e horas ─────────────────────────────────────────────────────────────────

export type SituacaoIniciativa = 'planejada' | 'em_andamento' | 'suspensa' | 'concluida' | 'cancelada';
export type SituacaoAcao = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';

const TRANSICAO_INICIATIVA: Readonly<Record<SituacaoIniciativa, readonly SituacaoIniciativa[]>> = {
  planejada: ['em_andamento', 'suspensa', 'cancelada'],
  em_andamento: ['suspensa', 'concluida', 'cancelada'],
  suspensa: ['em_andamento', 'cancelada'],
  concluida: [],
  cancelada: [],
};
const TRANSICAO_ACAO: Readonly<Record<SituacaoAcao, readonly SituacaoAcao[]>> = {
  pendente: ['em_andamento', 'concluida', 'cancelada'],
  em_andamento: ['concluida', 'cancelada'],
  concluida: ['em_andamento'],
  cancelada: [],
};

export const iniciativaEncerrada = (s: SituacaoIniciativa): boolean => s === 'concluida' || s === 'cancelada';

export function validarIniciativa(i: {
  inicioPrevisto: string;
  terminoPrevisto: string;
}): RecusaEstrategia[] {
  return i.terminoPrevisto < i.inicioPrevisto ? ['iniciativa-periodo'] : [];
}

/** Mudança de situação da iniciativa: concluir exige as ações fechadas e devolve as datas reais a gravar. */
export function mudarSituacaoIniciativa(
  atual: { situacao: SituacaoIniciativa; inicioReal: string | null },
  nova: SituacaoIniciativa,
  acoes: readonly { situacao: SituacaoAcao }[],
  hoje: string,
):
  | { ok: true; inicioReal: string | null; terminoReal: string | null; progresso: number | null }
  | { ok: false; recusa: RecusaEstrategia } {
  if (nova === atual.situacao)
    return { ok: true, inicioReal: atual.inicioReal, terminoReal: null, progresso: null };
  if (!TRANSICAO_INICIATIVA[atual.situacao].includes(nova))
    return { ok: false, recusa: 'iniciativa-transicao' };
  if (nova === 'concluida' && acoes.some((a) => a.situacao === 'pendente' || a.situacao === 'em_andamento'))
    return { ok: false, recusa: 'iniciativa-acoes-abertas' };
  const inicioReal = atual.inicioReal ?? (nova === 'em_andamento' || nova === 'concluida' ? hoje : null);
  return {
    ok: true,
    inicioReal,
    terminoReal: nova === 'concluida' ? hoje : null,
    progresso: nova === 'concluida' ? 100 : null,
  };
}

export function validarAcao(
  a: { inicioPrevisto: string; terminoPrevisto: string },
  iniciativa: { inicioPrevisto: string; terminoPrevisto: string; situacao: SituacaoIniciativa },
): RecusaEstrategia[] {
  const r: RecusaEstrategia[] = [];
  if (iniciativaEncerrada(iniciativa.situacao)) r.push('iniciativa-encerrada');
  if (a.terminoPrevisto < a.inicioPrevisto) r.push('acao-periodo');
  else if (a.inicioPrevisto < iniciativa.inicioPrevisto || a.terminoPrevisto > iniciativa.terminoPrevisto)
    r.push('acao-fora-da-iniciativa');
  return r;
}

/** Mudança de situação da ação, com as datas reais e o progresso que a acompanham. */
export function mudarSituacaoAcao(
  atual: { situacao: SituacaoAcao; inicioReal: string | null; progresso: number },
  nova: SituacaoAcao,
  progressoInformado: number | null,
  hoje: string,
):
  | { ok: true; inicioReal: string | null; terminoReal: string | null; progresso: number }
  | { ok: false; recusa: RecusaEstrategia } {
  if (nova !== atual.situacao && !TRANSICAO_ACAO[atual.situacao].includes(nova))
    return { ok: false, recusa: 'acao-transicao' };
  const inicioReal = atual.inicioReal ?? (nova === 'em_andamento' || nova === 'concluida' ? hoje : null);
  if (nova === 'concluida') return { ok: true, inicioReal, terminoReal: hoje, progresso: 100 };
  const base = progressoInformado ?? atual.progresso;
  const progresso =
    nova === 'em_andamento' ? Math.min(99, Math.max(0, base)) : Math.max(0, Math.min(100, base));
  return { ok: true, inicioReal, terminoReal: null, progresso: nova === 'pendente' ? 0 : progresso };
}

const DIA_MS = 86_400_000;
const diasEntre = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS) + 1;

/**
 * Progresso da iniciativa (0 a 100, duas casas): média das ações ponderada pela duração prevista (em minutos, ou em
 * dias do período previsto quando não informada). As ações canceladas saem da conta; sem ação, 0.
 */
export function progressoIniciativa(
  acoes: readonly {
    situacao: SituacaoAcao;
    progresso: number;
    duracaoPrevistaMinutos: number | null;
    inicioPrevisto: string;
    terminoPrevisto: string;
  }[],
): number {
  let soma = 0;
  let pesos = 0;
  for (const a of acoes) {
    if (a.situacao === 'cancelada') continue;
    const p = a.duracaoPrevistaMinutos ?? diasEntre(a.inicioPrevisto, a.terminoPrevisto) * 480;
    soma += (a.situacao === 'concluida' ? 100 : a.progresso) * p;
    pesos += p;
  }
  return pesos > 0 ? Math.round((soma / pesos) * 100) / 100 : 0;
}

/** Apontamento de horas na ação: 1 a 1440 minutos, sem data futura, dentro do dia da pessoa e da ação aberta. */
export function validarApontamento(a: {
  dataTrabalho: string;
  minutos: number;
  hoje: string;
  minutosJaApontadosNoDia: number;
  acao: { situacao: SituacaoAcao; inicioPrevisto: string };
  iniciativa: SituacaoIniciativa;
}): RecusaEstrategia[] {
  const r: RecusaEstrategia[] = [];
  if (!Number.isInteger(a.minutos) || a.minutos < 1 || a.minutos > 1440) r.push('apontamento-duracao');
  if (a.dataTrabalho > a.hoje) r.push('apontamento-futuro');
  if (a.dataTrabalho < a.acao.inicioPrevisto) r.push('apontamento-antes-do-inicio');
  if (a.acao.situacao === 'cancelada') r.push('apontamento-acao-fechada');
  if (iniciativaEncerrada(a.iniciativa)) r.push('iniciativa-encerrada');
  if (a.minutosJaApontadosNoDia + a.minutos > 1440 && !r.includes('apontamento-duracao'))
    r.push('apontamento-dia-excedido');
  return r;
}

/** Horas por pessoa e total (minutos), com as parcelas para a conta impressa. */
export function totalHoras(apontamentos: readonly { pessoa: string; minutos: number }[]): {
  total: number;
  porPessoa: { pessoa: string; minutos: number }[];
} {
  const m = new Map<string, number>();
  for (const a of apontamentos) m.set(a.pessoa, (m.get(a.pessoa) ?? 0) + a.minutos);
  const porPessoa = [...m.entries()]
    .map(([pessoa, minutos]) => ({ pessoa, minutos }))
    .sort((x, y) => y.minutos - x.minutos || x.pessoa.localeCompare(y.pessoa));
  return { total: porPessoa.reduce((s, p) => s + p.minutos, 0), porPessoa };
}

// ── Reunião de análise crítica ─────────────────────────────────────────────────────────────────

export type SituacaoReuniao = 'agendada' | 'em_preparacao' | 'realizada' | 'encerrada' | 'cancelada';
export type Presenca = 'convocado' | 'presente' | 'ausente' | 'ausencia_justificada';

const TRANSICAO_REUNIAO: Readonly<Record<SituacaoReuniao, readonly SituacaoReuniao[]>> = {
  agendada: ['em_preparacao', 'realizada', 'cancelada'],
  em_preparacao: ['realizada', 'cancelada'],
  realizada: ['encerrada'],
  encerrada: [],
  cancelada: [],
};

export const reuniaoFechada = (s: SituacaoReuniao): boolean => s === 'encerrada' || s === 'cancelada';

export function validarPresenca(p: { presenca: Presenca; justificativa: string | null }): RecusaEstrategia[] {
  return p.presenca === 'ausencia_justificada' && !p.justificativa?.trim()
    ? ['reuniao-justificativa-ausencia']
    : [];
}

/** Mudança de situação da reunião: realizada exige alguém presente; encerrada exige ata e todas as presenças marcadas. */
export function mudarSituacaoReuniao(
  atual: SituacaoReuniao,
  nova: SituacaoReuniao,
  r: { ata: string | null; presencas: readonly Presenca[] },
): RecusaEstrategia[] {
  if (nova === atual) return [];
  if (!TRANSICAO_REUNIAO[atual].includes(nova)) return ['reuniao-transicao'];
  const x: RecusaEstrategia[] = [];
  if (nova === 'realizada' || nova === 'encerrada') {
    if (!r.presencas.includes('presente')) x.push('reuniao-sem-presente');
  }
  if (nova === 'encerrada') {
    if (!r.ata?.trim()) x.push('reuniao-sem-ata');
    if (r.presencas.includes('convocado')) x.push('reuniao-presenca-pendente');
  }
  return x;
}

/** A análise do indicador entra na pauta só se a competência dela cai no período da reunião. */
export function analiseNoPeriodo(
  competencia: string,
  reuniao: { competenciaInicio: string; competenciaFim: string },
): boolean {
  const c = competencia.slice(0, 7);
  return c >= reuniao.competenciaInicio.slice(0, 7) && c <= reuniao.competenciaFim.slice(0, 7);
}

export function validarDeliberacao(d: { prazo: string | null }, dataReuniao: string): RecusaEstrategia[] {
  return d.prazo && d.prazo < dataReuniao.slice(0, 10) ? ['deliberacao-prazo'] : [];
}
