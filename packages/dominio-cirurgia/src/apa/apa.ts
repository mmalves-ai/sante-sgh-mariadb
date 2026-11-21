// Avaliação pré-anestésica (ficha do M46, operação cirurgia.registrarApa; cap-05a §5.5; Resolução CFM 2.174/2017,
// art. 1º: a APA antes de toda anestesia eletiva). Regras puras: jejum pela tabela ASA 2017, índice de Lee, rótulo
// ASA com o "E", a conferência antes de gravar e as pendências do agendamento (M18) que a APA fecha.
import {
  CLASSES_ASA,
  CRITERIOS_LEE,
  JEJUM_MINIMO_HORAS,
  TIPOS_INGESTAO,
  type ClasseAsa,
  type ConclusaoApa,
  type JejumAvaliado,
  type RecusaAnestesia,
  type TipoIngestao,
  type TipoPendencia,
} from '@sgh/contratos';
import type { EstadoAgendamento } from '../estados.js';
import { minutosDoInstante } from '../ficha/instante.js';

/** Horas desde cada ingestão até o início previsto da cirurgia; null (não ingeriu) conta como suficiente. */
export function avaliarJejum(
  ultimaIngestao: Readonly<Partial<Record<TipoIngestao, string | null>>>,
  inicioPrevisto: string,
): JejumAvaliado[] {
  const inicio = minutosDoInstante(inicioPrevisto);
  return TIPOS_INGESTAO.map((tipo) => {
    const minimo = JEJUM_MINIMO_HORAS[tipo];
    const em = ultimaIngestao[tipo] ?? null;
    if (em === null) return { tipo, horas: null, minimo, suficiente: true };
    const horas = Math.floor(((inicio - minutosDoInstante(em)) / 60) * 10) / 10;
    return { tipo, horas, minimo, suficiente: horas >= minimo };
  });
}

export function jejumSuficiente(jejum: readonly JejumAvaliado[]): boolean {
  return jejum.every((j) => j.suficiente);
}

const CLASSES_LEE = ['I', 'II', 'III', 'IV'] as const;

/** Índice de risco cardíaco revisado de Lee: pontos e classe (I = 0, II = 1, III = 2, IV = 3 ou mais). */
export function indiceLee(criterios: readonly string[]): {
  pontos: number;
  classe: (typeof CLASSES_LEE)[number];
} {
  const validos = new Set(CRITERIOS_LEE.map((c) => c.codigo as string));
  const pontos = new Set(criterios.filter((c) => validos.has(c))).size;
  return { pontos, classe: CLASSES_LEE[Math.min(pontos, 3)]! };
}

/** "ASA II", "ASA III E". */
export function rotuloAsa(asa: ClasseAsa, emergencia: boolean): string {
  const r = CLASSES_ASA.find((c) => c.classe === asa)?.rotulo ?? `ASA ${asa}`;
  return emergencia ? `${r} E` : r;
}

/** Conclusões que liberam a cirurgia do ponto de vista da anestesia. */
export function conclusaoLibera(c: ConclusaoApa): boolean {
  return c === 'apto' || c === 'apto-ressalvas';
}

const ESTADOS_FECHADOS: readonly EstadoAgendamento[] = ['realizado', 'cancelado'];

export interface ApaParaConferir {
  readonly asa: ClasseAsa;
  readonly emergencia: boolean;
  readonly alergiasConferidas: boolean;
  readonly conclusao: ConclusaoApa;
  readonly jejum: Readonly<Partial<Record<TipoIngestao, string | null>>>;
  readonly criteriosLee: readonly string[];
}

export interface ConferenciaApa {
  readonly recusas: readonly RecusaAnestesia[];
  readonly jejum: readonly JejumAvaliado[];
  readonly lee: ReturnType<typeof indiceLee>;
  /** Pendências do agendamento (pendencia_agendamento_cirurgico, M18) que a APA resolve ao gravar. */
  readonly pendenciasResolvidas: readonly TipoPendencia[];
  /**
   * Revisão do M46.1: as que esta versão deixa (ou devolve a) pendente. A pendência segue a versão vigente: uma nova
   * versão "reavaliar" ou "inapto" reabre a APA e a ASA que a anterior fechou, e o jejum insuficiente reabre o jejum.
   */
  readonly pendenciasAbertas: readonly TipoPendencia[];
}

/**
 * Conferência antes de gravar a APA:
 *   - agendamento realizado ou cancelado não recebe APA nova (a retificação de uma APA já gravada é outra versão);
 *   - a lista de alergias precisa ter sido conferida;
 *   - ASA VI não é "emergência" (doador de órgãos);
 *   - "apto" com jejum insuficiente, fora da emergência, é recusado: conclua "reavaliar" ou "apto com ressalvas".
 * Gravada com conclusão que libera, fecha as pendências de APA e de ASA (e a de jejum, se o jejum for suficiente); sem
 * ela, essas voltam a pendente (a versão nova manda: revisão do M46.1).
 */
export function conferirApa(
  apa: ApaParaConferir,
  inicioPrevisto: string,
  estado: EstadoAgendamento,
): ConferenciaApa {
  const jejum = avaliarJejum(apa.jejum, inicioPrevisto);
  const lee = indiceLee(apa.criteriosLee);
  const recusas: RecusaAnestesia[] = [];
  if (ESTADOS_FECHADOS.includes(estado)) recusas.push('apa-agendamento-fechado');
  if (!apa.alergiasConferidas) recusas.push('apa-alergias-nao-conferidas');
  if (apa.emergencia && apa.asa === 6) recusas.push('apa-asa-emergencia');
  const jejumOk = jejumSuficiente(jejum);
  if (apa.conclusao === 'apto' && !jejumOk && !apa.emergencia) recusas.push('apa-jejum-insuficiente');
  const pendenciasResolvidas: TipoPendencia[] = [];
  const pendenciasAbertas: TipoPendencia[] = [];
  if (recusas.length === 0) {
    const libera = conclusaoLibera(apa.conclusao);
    (libera ? pendenciasResolvidas : pendenciasAbertas).push('apa', 'asa');
    (libera && jejumOk ? pendenciasResolvidas : pendenciasAbertas).push('jejum');
  }
  return { recusas, jejum, lee, pendenciasResolvidas, pendenciasAbertas };
}
