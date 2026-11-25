// Ciclo do registro clínico (03-PEP L96): a versão anterior guardada na suspensão e ligada à correção, e o pedido ou a
// resposta de parecer gravados com o registro. Regras puras: a porta lê o banco, chama estas funções e grava o resultado.
// Registro clínico e histórico nunca se apagam (CFM 1.638/2002; SBIS NGS2: trilha de cada versão com autor e motivo).

/** O que a versão anterior do registro fotografa (o registro e as respostas como estavam). */
export interface FotografiaRegistro {
  readonly situacao: string;
  readonly impressaoDigital: string;
  readonly textoConsolidado: string | null;
  readonly dataHoraClinica: string;
  readonly respostas: number;
}

export class RecusaCicloRegistro extends Error {
  constructor(
    readonly codigo:
      | 'motivo-obrigatorio'
      | 'versao-sem-registro'
      | 'parecer-sem-destino'
      | 'parecer-sem-motivo'
      | 'parecer-prazo-invalido'
      | 'parecer-encerrado'
      | 'parecer-proprio'
      | 'parecer-de-outro-paciente',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface VersaoGravavel {
  readonly numeroVersao: number;
  readonly operacao: 'alteracao';
  readonly motivo: string;
  readonly dados: FotografiaRegistro & { readonly evento: 'suspensao' };
}

/**
 * A versão anterior do registro, guardada na suspensão: número seguinte ao último já guardado (a primeira é 1), com a
 * fotografia do registro e o motivo (a justificativa da suspensão, obrigatória).
 */
export function versaoNaSuspensao(
  versoesGuardadas: readonly number[],
  foto: FotografiaRegistro,
  justificativa: string | null | undefined,
): VersaoGravavel {
  const motivo = justificativa?.trim() ?? '';
  if (motivo.length === 0)
    throw new RecusaCicloRegistro('motivo-obrigatorio', 'A suspensão do registro exige a justificativa.');
  const ultimo = versoesGuardadas.length ? Math.max(...versoesGuardadas) : 0;
  return {
    numeroVersao: ultimo + 1,
    operacao: 'alteracao',
    motivo: motivo.slice(0, 500),
    dados: { ...foto, evento: 'suspensao' },
  };
}

/**
 * A correção liga a última versão guardada do original ao registro novo. Sem versão guardada (suspenso antes desta
 * regra), a correção guarda a fotografia agora, com a justificativa da suspensão, já ligada ao registro novo.
 */
export function ligacaoDaCorrecao(
  versoesGuardadas: readonly { readonly numero: number; readonly corrigidoPor: number | null }[],
): { readonly ligar: number } | { readonly criar: true } {
  const livres = versoesGuardadas.filter((v) => v.corrigidoPor === null);
  if (livres.length === 0) return { criar: true };
  return { ligar: Math.max(...livres.map((v) => v.numero)) };
}

// ── Parecer gravado com o registro ────────────────────────────────────────────────────────────────────

export const PRIORIDADES_PARECER = ['rotina', 'prioritario', 'urgente'] as const;
export type PrioridadeParecer = (typeof PRIORIDADES_PARECER)[number];

export interface PedidoParecerInformado {
  readonly especialidade: number | null;
  readonly categoria: string | null;
  readonly prioridade: PrioridadeParecer;
  /** Prazo em UTC (ISO); nulo é sem prazo. */
  readonly prazo: string | null;
  /** O texto do registro do pedido (o motivo do parecer). */
  readonly texto: string | null;
  readonly agora: Date;
}

export interface PedidoParecerGravavel {
  readonly especialidade: number | null;
  readonly categoria: string | null;
  readonly prioridade: PrioridadeParecer;
  readonly prazo: Date | null;
  readonly motivo: string;
}

/** O pedido de parecer exige o destino (especialidade ou categoria), o motivo (o texto do registro) e prazo futuro. */
export function pedidoDeParecer(p: PedidoParecerInformado): PedidoParecerGravavel {
  const categoria = p.categoria?.trim() || null;
  if (p.especialidade === null && categoria === null)
    throw new RecusaCicloRegistro(
      'parecer-sem-destino',
      'Informe a especialidade ou a categoria a quem o parecer é pedido.',
    );
  const motivo = p.texto?.trim() ?? '';
  if (motivo.length === 0)
    throw new RecusaCicloRegistro('parecer-sem-motivo', 'O pedido de parecer precisa do texto do motivo.');
  const prazo = p.prazo === null ? null : new Date(p.prazo);
  if (prazo !== null && (Number.isNaN(prazo.getTime()) || prazo.getTime() <= p.agora.getTime()))
    throw new RecusaCicloRegistro('parecer-prazo-invalido', 'O prazo do parecer tem de ser futuro.');
  return {
    especialidade: p.especialidade,
    categoria: categoria?.slice(0, 30) ?? null,
    prioridade: p.prioridade,
    prazo,
    motivo,
  };
}

export interface RespostaParecerInformada {
  readonly situacao: string;
  readonly solicitante: number;
  readonly respondente: number;
  readonly pacienteDoParecer: number;
  readonly pacienteDoRegistro: number;
  readonly sequencias: readonly number[];
  readonly texto: string | null;
}

export interface RespostaParecerGravavel {
  readonly sequencia: number;
  /** Respondido sem o aceite antes: o aceite é registrado junto (quem responde assume o parecer). */
  readonly aceitaAgora: boolean;
  readonly parecer: string;
}

/**
 * A resposta ao parecer: só do mesmo paciente, só em parecer aberto (solicitado ou aceito), nunca por quem pediu, com o
 * texto do registro como parecer. Mais de uma resposta (o especialista segue acompanhando) tem a sequência seguinte.
 */
export function respostaDeParecer(p: RespostaParecerInformada): RespostaParecerGravavel {
  if (p.pacienteDoParecer !== p.pacienteDoRegistro)
    throw new RecusaCicloRegistro('parecer-de-outro-paciente', 'O parecer é de outro paciente.');
  if (p.situacao !== 'solicitado' && p.situacao !== 'aceito' && p.situacao !== 'respondido')
    throw new RecusaCicloRegistro('parecer-encerrado', 'O parecer foi cancelado.');
  if (p.respondente === p.solicitante)
    throw new RecusaCicloRegistro('parecer-proprio', 'Quem pediu o parecer não o responde.');
  const parecer = p.texto?.trim() ?? '';
  if (parecer.length === 0)
    throw new RecusaCicloRegistro('parecer-sem-motivo', 'A resposta ao parecer precisa do texto.');
  return {
    sequencia: (p.sequencias.length ? Math.max(...p.sequencias) : 0) + 1,
    aceitaAgora: p.situacao === 'solicitado',
    parecer,
  };
}
