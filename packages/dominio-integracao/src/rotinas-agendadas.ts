// Rotinas agendadas com histórico de execução (01-SIS L95, ficha F3.9). Regras puras, sem banco: a transição de cada
// execução (aguardando → em execução → concluída, concluída com avisos, falhou, cancelada ou expirada), a falha com
// mensagem obrigatória, a situação da rotina depois de cada execução, o atraso contado pela tolerância da rotina e o
// disparo manual (só rotina ativa, não suspensa, que aceita acionamento manual e sem execução em curso). O registrador
// do worker e a tela de rotinas da administração aplicam estas regras; o banco só guarda (nenhum gatilho).

export type SituacaoExecucao =
  'aguardando' | 'em_execucao' | 'concluida' | 'concluida_com_avisos' | 'falhou' | 'cancelada' | 'expirada';

export type SituacaoRotina = 'ociosa' | 'em_execucao' | 'suspensa' | 'com_falha';

export type DisparoExecucao = 'agendado' | 'manual' | 'reprocessamento';

export const SITUACOES_FINAIS_EXECUCAO: readonly SituacaoExecucao[] = [
  'concluida',
  'concluida_com_avisos',
  'falhou',
  'cancelada',
  'expirada',
];

/** Para onde cada situação da execução pode ir. As finais não vão a lugar nenhum: o histórico não se reescreve. */
const TRANSICOES: Readonly<Record<SituacaoExecucao, readonly SituacaoExecucao[]>> = {
  aguardando: ['em_execucao', 'cancelada', 'expirada'],
  em_execucao: ['concluida', 'concluida_com_avisos', 'falhou', 'cancelada', 'expirada'],
  concluida: [],
  concluida_com_avisos: [],
  falhou: [],
  cancelada: [],
  expirada: [],
};

export type RecusaRotina =
  | 'transicao-invalida'
  | 'falha-sem-mensagem'
  | 'volumes-invalidos'
  | 'fim-antes-do-inicio'
  | 'rotina-inativa'
  | 'rotina-suspensa'
  | 'sem-acionamento-manual'
  | 'execucao-em-curso'
  | 'fora-da-vigencia';

export const MENSAGEM_ROTINA: Readonly<Record<RecusaRotina, string>> = {
  'transicao-invalida': 'A execução não pode passar para essa situação (execução encerrada não muda).',
  'falha-sem-mensagem': 'Execução com falha precisa da mensagem do erro.',
  'volumes-invalidos': 'Os volumes lidos, gravados e rejeitados precisam ser inteiros não negativos.',
  'fim-antes-do-inicio': 'O fim da execução não pode ser antes do início.',
  'rotina-inativa': 'A rotina está inativa.',
  'rotina-suspensa': 'A rotina está suspensa; retome-a antes de acionar.',
  'sem-acionamento-manual': 'Esta rotina não aceita acionamento manual.',
  'execucao-em-curso': 'Já há uma execução desta rotina em curso; aguarde o fim.',
  'fora-da-vigencia': 'A rotina está fora do período de vigência.',
};

export const execucaoEncerrada = (s: SituacaoExecucao): boolean => SITUACOES_FINAIS_EXECUCAO.includes(s);

export interface VolumesExecucao {
  readonly lidos: number;
  readonly gravados: number;
  readonly rejeitados: number;
}

export interface MudancaExecucao {
  readonly de: SituacaoExecucao;
  readonly para: SituacaoExecucao;
  readonly mensagemErro?: string | null | undefined;
  readonly volumes?: VolumesExecucao | undefined;
  readonly inicioEm?: Date | null | undefined;
  readonly fimEm?: Date | null | undefined;
}

/**
 * Confere a mudança de situação de uma execução: só pelas transições permitidas, falha com mensagem (não vazia),
 * volumes inteiros não negativos e fim não anterior ao início. Devolve a recusa ou nulo.
 */
export function conferirMudancaExecucao(m: MudancaExecucao): RecusaRotina | null {
  if (!TRANSICOES[m.de].includes(m.para)) return 'transicao-invalida';
  if (m.para === 'falhou' && !(m.mensagemErro ?? '').trim()) return 'falha-sem-mensagem';
  if (m.volumes) {
    const v = [m.volumes.lidos, m.volumes.gravados, m.volumes.rejeitados];
    if (v.some((n) => !Number.isInteger(n) || n < 0)) return 'volumes-invalidos';
  }
  if (m.inicioEm && m.fimEm && m.fimEm.getTime() < m.inicioEm.getTime()) return 'fim-antes-do-inicio';
  return null;
}

/**
 * Situação da rotina depois de uma execução: em curso enquanto a execução roda; ao encerrar, "com falha" quando a
 * execução falhou ou expirou e "ociosa" nos demais casos. Rotina suspensa continua suspensa (a execução que já rodava
 * termina, mas a suspensão é decisão de alguém e só sai por quem a retomar).
 */
export function situacaoDaRotinaApos(atual: SituacaoRotina, execucao: SituacaoExecucao): SituacaoRotina {
  if (atual === 'suspensa') return 'suspensa';
  if (execucao === 'aguardando' || execucao === 'em_execucao') return 'em_execucao';
  if (execucao === 'falhou' || execucao === 'expirada') return 'com_falha';
  return 'ociosa';
}

/**
 * A rotina está atrasada quando a próxima execução prevista já passou além da tolerância (sem tolerância, qualquer
 * atraso conta). Rotina inativa, suspensa, sem previsão ou já em execução não está atrasada.
 */
export function rotinaAtrasada(
  r: {
    readonly ativo: boolean;
    readonly situacao: SituacaoRotina;
    readonly proximaExecucaoEm: Date | null;
    readonly toleranciaAtrasoSegundos: number | null;
  },
  agora: Date,
): { atrasada: boolean; segundos: number } {
  if (!r.ativo || r.situacao === 'suspensa' || r.situacao === 'em_execucao' || !r.proximaExecucaoEm)
    return { atrasada: false, segundos: 0 };
  const segundos = Math.floor((agora.getTime() - r.proximaExecucaoEm.getTime()) / 1000);
  return { atrasada: segundos > (r.toleranciaAtrasoSegundos ?? 0), segundos: Math.max(0, segundos) };
}

/**
 * Pode acionar a rotina à mão agora? Só rotina ativa, não suspensa, que aceita acionamento manual, dentro da vigência
 * e sem execução em curso (aguardando ou em execução). Devolve a recusa ou nulo.
 */
export function conferirAcionamentoManual(
  r: {
    readonly ativo: boolean;
    readonly situacao: SituacaoRotina;
    readonly permiteAcionamentoManual: boolean;
    readonly vigenciaInicio?: Date | null | undefined;
    readonly vigenciaFim?: Date | null | undefined;
  },
  emCurso: boolean,
  agora: Date,
): RecusaRotina | null {
  if (!r.ativo) return 'rotina-inativa';
  if (r.situacao === 'suspensa') return 'rotina-suspensa';
  if (!r.permiteAcionamentoManual) return 'sem-acionamento-manual';
  if (
    (r.vigenciaInicio && agora.getTime() < r.vigenciaInicio.getTime()) ||
    (r.vigenciaFim && agora.getTime() > r.vigenciaFim.getTime())
  )
    return 'fora-da-vigencia';
  if (emCurso || r.situacao === 'em_execucao') return 'execucao-em-curso';
  return null;
}

/** Situação final de uma execução que terminou sem erro: com avisos quando houve rejeitados ou avisos. */
export function situacaoFinalSemErro(v: VolumesExecucao, avisos = 0): 'concluida' | 'concluida_com_avisos' {
  return v.rejeitados > 0 || avisos > 0 ? 'concluida_com_avisos' : 'concluida';
}

/** Cadastro de uma rotina do worker: o código é a identidade (o cadastro no banco é idempotente por ele). */
export interface DefinicaoRotina {
  readonly codigo: string;
  readonly nome: string;
  readonly descricao: string;
  readonly categoria: 'carga' | 'envio' | 'fechamento' | 'integracao' | 'manutencao' | 'relatorio' | 'outra';
  /** De quanto em quanto tempo a volta roda (segundos). */
  readonly intervaloSegundos: number;
  /** Atraso aceito antes de a rotina aparecer como atrasada (segundos). */
  readonly toleranciaAtrasoSegundos: number;
  readonly permiteAcionamentoManual: boolean;
}

/**
 * A volta sem trabalho (nada lido, gravado nem rejeitado, sem falha) não vira histórico: só marca a rotina como viva
 * (última e próxima execução), no máximo a cada este intervalo. Assim o histórico mostra o que aconteceu, não um
 * registro por minuto de "nada a fazer".
 */
export const INTERVALO_MARCACAO_SEGUNDOS = 900;

export type DestinoDaVolta = 'historico' | 'marcar' | 'nada';

/**
 * O que gravar de uma volta encerrada: histórico (execução e etapas) quando houve falha, avisos, volume ou
 * acionamento por alguém; só a marca de vida quando a última marca já passou do intervalo; nada nos demais casos.
 */
export function destinoDaVolta(
  v: {
    readonly situacao: SituacaoExecucao;
    readonly volumes: VolumesExecucao;
    readonly disparo: DisparoExecucao;
  },
  ultimaMarcaEm: Date | null,
  agora: Date,
): DestinoDaVolta {
  if (v.disparo !== 'agendado') return 'historico';
  if (v.situacao !== 'concluida') return 'historico';
  if (v.volumes.lidos + v.volumes.gravados + v.volumes.rejeitados > 0) return 'historico';
  if (!ultimaMarcaEm || agora.getTime() - ultimaMarcaEm.getTime() >= INTERVALO_MARCACAO_SEGUNDOS * 1000)
    return 'marcar';
  return 'nada';
}

/** Próxima execução prevista pela agenda por intervalo (sem intervalo, sem previsão). */
export function proximaExecucaoPorIntervalo(ultimaEm: Date, intervaloSegundos: number | null): Date | null {
  if (!intervaloSegundos || intervaloSegundos <= 0) return null;
  return new Date(ultimaEm.getTime() + intervaloSegundos * 1000);
}

/** Suspender e retomar: só se suspende rotina não suspensa e só se retoma a suspensa (volta ociosa). */
export function conferirSuspensao(
  atual: SituacaoRotina,
  acao: 'suspender' | 'retomar',
): { recusa: 'rotina-suspensa' | 'rotina-nao-suspensa'; mensagem: string } | { situacao: SituacaoRotina } {
  if (acao === 'suspender')
    return atual === 'suspensa'
      ? { recusa: 'rotina-suspensa', mensagem: 'A rotina já está suspensa.' }
      : { situacao: 'suspensa' };
  return atual === 'suspensa'
    ? { situacao: 'ociosa' }
    : { recusa: 'rotina-nao-suspensa', mensagem: 'A rotina não está suspensa.' };
}
