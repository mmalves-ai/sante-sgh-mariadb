// Histórico e manifestações da alergia do paciente (03-PEP L100; ONA/JCI, segurança na medicação; classificação
// brasileira de alergias e reações). Cada mudança na alergia (inclusão, confirmação, alteração, inativação,
// reativação) deixa um evento com quem, quando, o motivo e o estado da alergia DEPOIS da mudança: a linha nunca é
// apagada e a pergunta "quem retirou esta alergia, quando e por quê" tem resposta. As manifestações (urticária,
// broncoespasmo, anafilaxia) são escolhidas no catálogo de manifestações, na mesma gravação da alergia.
// Regra pura: sem banco nem I/O; a porta própria grava o que estas funções devolvem.

export const EVENTOS_ALERGIA = ['inclusao', 'confirmacao', 'alteracao', 'inativacao', 'reativacao'] as const;
export type EventoAlergia = (typeof EVENTOS_ALERGIA)[number];

/** Operação de gravação do evento (o CHECK do banco): a inclusão cria a linha; o resto a altera. */
export type OperacaoEventoAlergia = 'inclusao' | 'alteracao' | 'exclusao';

/** Limite de manifestações por alergia (a tela mostra todas numa linha; mais que isso é engano de digitação). */
export const MAX_MANIFESTACOES_ALERGIA = 10;
/** Motivo mínimo da inativação e da reativação (o mesmo da inativação pela tela). */
export const MOTIVO_MINIMO_ALERGIA = 10;

/** Estado da alergia depois da mudança: só ids, códigos e datas (nada de texto livre do paciente no evento). */
export interface EstadoAlergia {
  readonly tipoRegistro: 'alergia' | 'intolerancia' | 'nega_alergias' | 'desconhece_alergias';
  readonly alergeno: number | null;
  /** Há descrição livre (o texto fica na própria alergia; o evento só diz que existe). */
  readonly descricaoLivre: boolean;
  readonly gravidade: string | null;
  readonly certeza: string | null;
  readonly fonte: string | null;
  readonly ativa: boolean;
  readonly principios: readonly number[];
  readonly manifestacoes: readonly number[];
}

export interface EventoAlergiaGravavel {
  readonly operacao: OperacaoEventoAlergia;
  readonly evento: EventoAlergia;
  readonly motivo: string | null;
  readonly dados: string;
}

export class RecusaHistoricoAlergia extends Error {
  constructor(
    readonly codigo:
      'motivo-curto' | 'estado-incoerente' | 'manifestacao-em-declaracao' | 'manifestacoes-demais',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const ordenados = (ids: readonly number[]): number[] => [...new Set(ids)].sort((a, b) => a - b);

/**
 * O evento a gravar para a mudança. Recusa: inativação ou reativação sem motivo de pelo menos 10 caracteres; estado
 * incoerente com o evento (inativação com a alergia ainda ativa, reativação ou inclusão com ela inativa).
 */
export function eventoDaAlergia(
  evento: EventoAlergia,
  estado: EstadoAlergia,
  motivo?: string | null,
): EventoAlergiaGravavel {
  const m = motivo?.trim() ? motivo.trim() : null;
  if (
    (evento === 'inativacao' || evento === 'reativacao') &&
    (m === null || m.length < MOTIVO_MINIMO_ALERGIA)
  )
    throw new RecusaHistoricoAlergia(
      'motivo-curto',
      `Informe o motivo (pelo menos ${MOTIVO_MINIMO_ALERGIA} caracteres) para ${evento === 'inativacao' ? 'retirar' : 'reativar'} a alergia.`,
    );
  const declaracao = estado.tipoRegistro === 'nega_alergias' || estado.tipoRegistro === 'desconhece_alergias';
  if (
    (evento === 'inativacao' && estado.ativa) ||
    ((evento === 'reativacao' || evento === 'inclusao') && !estado.ativa && !declaracao)
  )
    throw new RecusaHistoricoAlergia('estado-incoerente', 'O estado da alergia não confere com a mudança.');
  return {
    operacao: evento === 'inclusao' ? 'inclusao' : 'alteracao',
    evento,
    motivo: m,
    dados: JSON.stringify({
      tipoRegistro: estado.tipoRegistro,
      alergeno: estado.alergeno,
      descricaoLivre: estado.descricaoLivre,
      gravidade: estado.gravidade,
      certeza: estado.certeza,
      fonte: estado.fonte,
      ativa: estado.ativa,
      principios: ordenados(estado.principios),
      manifestacoes: ordenados(estado.manifestacoes),
    }),
  };
}

/**
 * As manifestações pedidas, sem repetição e em ordem. A declaração "nega/desconhece alergias" não tem manifestação;
 * mais de 10 é recusado.
 */
export function manifestacoesDoPedido(nega: boolean, ids: readonly number[] | undefined): number[] {
  const lista = ordenados(ids ?? []);
  if (nega && lista.length > 0)
    throw new RecusaHistoricoAlergia(
      'manifestacao-em-declaracao',
      'A declaração de que o paciente nega alergias não tem manifestação.',
    );
  if (lista.length > MAX_MANIFESTACOES_ALERGIA)
    throw new RecusaHistoricoAlergia(
      'manifestacoes-demais',
      `No máximo ${MAX_MANIFESTACOES_ALERGIA} manifestações por alergia.`,
    );
  return lista;
}

export interface EventoAlergiaLido {
  readonly id: number;
  readonly evento: string;
  readonly ocorridoEm: string | null;
  readonly profissional: string | null;
  readonly motivo: string | null;
}

export interface PassoDoHistoricoAlergia {
  readonly id: number;
  readonly quando: string | null;
  readonly titulo: string;
  readonly quem: string | null;
  readonly motivo: string | null;
}

const TITULOS: Readonly<Record<EventoAlergia, string>> = {
  inclusao: 'Registrada',
  confirmacao: 'Confirmada',
  alteracao: 'Alterada',
  inativacao: 'Retirada da lista',
  reativacao: 'Reativada',
};

/** A linha do tempo da alergia, da mais antiga para a mais recente (empate pela ordem de gravação). */
export function linhaDoTempoDaAlergia(eventos: readonly EventoAlergiaLido[]): PassoDoHistoricoAlergia[] {
  return [...eventos]
    .sort((a, b) => (a.ocorridoEm ?? '').localeCompare(b.ocorridoEm ?? '') || a.id - b.id)
    .map((e) => ({
      id: e.id,
      quando: e.ocorridoEm,
      titulo: TITULOS[e.evento as EventoAlergia] ?? 'Alterada',
      quem: e.profissional,
      motivo: e.motivo,
    }));
}
