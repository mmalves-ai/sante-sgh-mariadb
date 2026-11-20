// Avaliação da visita na portaria (M50, etapa 5; regras 9 e 10): bloqueio por paciente, acompanhante com direito legal,
// isolamento, horário, visitantes ao mesmo tempo e idade, nesta ordem; a identificação biométrica só com a DP-45. O
// porteiro recebe só o necessário: a mensagem do bloqueio é genérica (nunca o motivo) e o leito só sai com a visita
// permitida (quem chama decide pelo `permitida`). A exceção do supervisor vale para o horário, o limite da unidade e a
// idade; nunca para o bloqueio, o isolamento que a regra bloqueia, a visita já aberta nem a biometria. Regras puras.
import type {
  AbrangenciaBloqueio,
  FundamentoAcompanhante,
  MotivoBloqueioVisita,
  PapelVisita,
  RecusaVisita,
} from '@sgh/contratos';
import { dentroDoHorario, type RegraVisita } from './regra.js';
import { idadeNaData } from './visitante.js';

export interface BloqueioParaAvaliar {
  readonly motivo: MotivoBloqueioVisita;
  readonly abrangencia: AbrangenciaBloqueio;
  readonly visitante: number | null;
  readonly limite: number | null;
  readonly incluiAcompanhante: boolean;
  /** Início (AAAA-MM-DDTHH:mm) e fim (AAAA-MM-DD, inclusive; nulo = até revogar). */
  readonly inicio: string;
  readonly fim: string | null;
  readonly revogado: boolean;
}

/** Os bloqueios que valem agora (não revogados, já começados e dentro da data de fim). */
export function bloqueiosVigentes<B extends BloqueioParaAvaliar>(lista: readonly B[], agora: string): B[] {
  const hoje = agora.slice(0, 10);
  return lista.filter(
    (b) => !b.revogado && b.inicio.slice(0, 16) <= agora.slice(0, 16) && (b.fim === null || b.fim >= hoje),
  );
}

/** O paciente tem sigilo de presença (não aparece na busca da portaria)? */
export const temSigilo = (bloqueios: readonly BloqueioParaAvaliar[]): boolean =>
  bloqueios.some((b) => b.motivo === 'sigilo' && b.abrangencia === 'todos');

export interface EntradaAvaliacao {
  readonly agora: string;
  readonly regra: RegraVisita;
  readonly isolamento: boolean;
  /** Os bloqueios vigentes do paciente. */
  readonly bloqueios: readonly BloqueioParaAvaliar[];
  /** Visitantes com visita aberta ao paciente agora (sem contar o acompanhante). */
  readonly abertas: number;
  /** O acompanhante vigente da internação (o ID do visitante), se houver. */
  readonly acompanhante: number | null;
  /**
   * O fundamento do acompanhante vigente. O "autorizado pela equipe" não tem direito legal: segue a regra da unidade
   * (bloqueio, isolamento, horário, limite e idade, com a exceção do supervisor); nulo ou ausente vale como direito legal.
   */
  readonly acompanhanteFundamento?: FundamentoAcompanhante | null;
  /** O visitante que quer entrar (nulo na busca: avalia só o paciente). */
  readonly visitante: {
    readonly id: number;
    readonly nascimento: string | null;
    readonly emVisita: boolean;
  } | null;
  readonly biometrica: boolean;
  readonly biometriaLigada: boolean;
  /** O supervisor autorizou a exceção (com o motivo). */
  readonly excecao: boolean;
}

export type AvaliacaoVisita =
  | {
      readonly permitida: true;
      readonly papel: PapelVisita;
      readonly orientacao: string | null;
      /** A recusa que a exceção do supervisor superou (vai à visita com o motivo). */
      readonly excecaoUsada: RecusaVisita | null;
      readonly limite: number;
    }
  | {
      readonly permitida: false;
      readonly recusa: RecusaVisita;
      readonly mensagem: string;
      /** O supervisor pode autorizar a exceção (horário, limite da unidade, idade). */
      readonly excepcionavel: boolean;
      readonly limite: number;
    };

const BLOQUEIO =
  'Visita não liberada para este paciente. Oriente o visitante a procurar a recepção ou a enfermagem.';

/** A mensagem que o porteiro vê (genérica no bloqueio). */
export function mensagemDaRecusa(
  recusa: RecusaVisita,
  r: Pick<RegraVisita, 'horaInicio' | 'horaFim' | 'idadeMinima'>,
  limite: number,
): string {
  switch (recusa) {
    case 'bloqueio':
      return BLOQUEIO;
    case 'fora-do-horario':
      return `Fora do horário de visita da unidade (${r.horaInicio} às ${r.horaFim}).`;
    case 'limite':
      return `A unidade permite ${limite} visitante(s) ao mesmo tempo com este paciente: aguarde a saída de outro.`;
    case 'idade':
      return `A unidade exige ${r.idadeMinima} anos ou mais para a visita.`;
    case 'nascimento-exigido':
      return 'Informe a data de nascimento do visitante: a unidade tem idade mínima para a visita.';
    case 'isolamento':
      return 'Paciente em precaução: a visita não é liberada na portaria. Oriente o visitante a procurar a enfermagem.';
    case 'ja-em-visita':
      return 'Este visitante já tem uma visita em curso: registre a saída antes de outra entrada.';
    case 'identificacao-biometrica':
      return 'A identificação por biometria ou reconhecimento facial não está liberada: use o crachá ou a etiqueta.';
    case 'sem-internacao':
      return 'Paciente não encontrado entre os internados.';
  }
}

function orientacao(isolamento: boolean, uti: boolean): string | null {
  const partes = [
    isolamento
      ? 'Paciente em precaução: o visitante procura a enfermagem antes de entrar no quarto (higienização das mãos e paramentação).'
      : null,
    uti ? 'Unidade de terapia intensiva: higienize as mãos e siga a orientação da enfermagem.' : null,
  ].filter((x): x is string => x !== null);
  return partes.length ? partes.join(' ') : null;
}

const EXCEPCIONAVEIS: ReadonlySet<RecusaVisita> = new Set(['fora-do-horario', 'limite', 'idade']);

/** Avalia a visita (regra 9). Sem visitante, avalia só o paciente (a busca da portaria). */
export function avaliarVisita(e: EntradaAvaliacao): AvaliacaoVisita {
  const r = e.regra;
  const v = e.visitante;
  const limiteDoBloqueio = e.bloqueios
    .filter((b) => b.abrangencia === 'limite' && b.limite !== null)
    .reduce((m, b) => Math.min(m, b.limite!), Number.POSITIVE_INFINITY);
  const limite = Math.min(r.maxSimultaneos, limiteDoBloqueio);
  const recusar = (recusa: RecusaVisita, excepcionavel = false): AvaliacaoVisita => ({
    permitida: false,
    recusa,
    mensagem: mensagemDaRecusa(recusa, r, limite),
    excepcionavel,
    limite,
  });
  if (v?.emVisita) return recusar('ja-em-visita');
  if (v && e.biometrica && !e.biometriaLigada) return recusar('identificacao-biometrica');
  const papel: PapelVisita =
    v !== null && e.acompanhante !== null && v.id === e.acompanhante ? 'acompanhante' : 'visitante';
  // O acompanhante com direito legal só é barrado pelo bloqueio que o inclui (ordem judicial ou decisão clínica).
  const direitoLegal = papel === 'acompanhante' && e.acompanhanteFundamento !== 'autorizado';
  const aplica = (b: BloqueioParaAvaliar) => !direitoLegal || b.incluiAcompanhante;
  // O bloqueio (todos, ou da pessoa) não tem exceção na portaria.
  if (e.bloqueios.some((b) => b.abrangencia === 'todos' && aplica(b))) return recusar('bloqueio');
  if (v && e.bloqueios.some((b) => b.abrangencia === 'visitante' && b.visitante === v.id && aplica(b)))
    return recusar('bloqueio');
  // O acompanhante com direito legal entra fora do horário, do limite e da idade (com a orientação).
  if (direitoLegal)
    return {
      permitida: true,
      papel,
      orientacao: orientacao(e.isolamento, r.uti),
      excecaoUsada: null,
      limite,
    };
  if (e.isolamento && r.isolamento === 'bloquear') return recusar('isolamento');
  let excecaoUsada: RecusaVisita | null = null;
  const conferir = (recusa: RecusaVisita): AvaliacaoVisita | null => {
    if (e.excecao && EXCEPCIONAVEIS.has(recusa)) {
      excecaoUsada ??= recusa;
      return null;
    }
    return recusar(recusa, EXCEPCIONAVEIS.has(recusa));
  };
  if (!dentroDoHorario(e.agora, r)) {
    const x = conferir('fora-do-horario');
    if (x) return x;
  }
  if (e.abertas >= limite) {
    // O limite menor do bloqueio do paciente não tem exceção.
    if (limiteDoBloqueio <= r.maxSimultaneos && e.abertas >= limiteDoBloqueio) return recusar('bloqueio');
    const x = conferir('limite');
    if (x) return x;
  }
  if (v && r.idadeMinima > 0) {
    if (v.nascimento === null) return recusar('nascimento-exigido');
    if (idadeNaData(v.nascimento, e.agora.slice(0, 10)) < r.idadeMinima) {
      const x = conferir('idade');
      if (x) return x;
    }
  }
  return { permitida: true, papel, orientacao: orientacao(e.isolamento, r.uti), excecaoUsada, limite };
}
