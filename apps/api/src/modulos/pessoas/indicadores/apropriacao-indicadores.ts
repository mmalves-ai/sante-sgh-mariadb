// Regras puras do painel de indicadores de pessoas (sem banco, sem I/O): o que conta como ausência no ponto apurado,
// as horas de um fechamento do ponto, a lotação do vínculo na data do fato (com o rateio das lotações simultâneas) e
// os limites de um período civil no fuso do estabelecimento. A porta própria só lê as linhas e chama estas regras.
// Lugar definitivo: packages/dominio-pessoas/src/indicadores/ (pedido na saída do lote 03-08; o lote não edita o índice
// do pacote). Até a mudança, este arquivo é o domínio da regra e tem o seu spec de unidade.
// Melhoria: ausência = débitos (atraso, saída antecipada) e faltas, abonadas ou não, pela natureza do tipo de hora e
//   pelo destino do item apurado (lista branca), não por códigos de classe; o informativo nunca conta.
// Melhoria: o fato do vínculo vai ao setor da lotação vigente na data do fato (histórico de lotação), rateado pelo
//   percentual das lotações simultâneas; contagens (vínculo, acidente) vão inteiras à lotação principal.

/** Naturezas de tipo de hora que são ausência: o débito e a falta (natureza `falta`) e a falta abonada (`abono`). */
export const NATUREZAS_AUSENCIA: ReadonlySet<string> = new Set(['falta', 'abono']);
/** Destinos do item apurado que contam (o `informativo` é só registro e não conta). */
export const DESTINOS_AUSENCIA: ReadonlySet<string> = new Set([
  'folha',
  'banco_horas',
  'abonado',
  'descontado',
]);

/** O item apurado conta como ausência? (natureza do tipo de hora e destino na lista branca) */
export function contaComoAusencia(natureza: string, destino: string): boolean {
  return NATUREZAS_AUSENCIA.has(natureza) && DESTINOS_AUSENCIA.has(destino);
}

/** Um fechamento do ponto lido: horas decimais consolidadas e, se houver, a apuração diária ligada a ele. */
export interface FechamentoPontoLido {
  readonly horasTrabalhadas: number;
  readonly horasExtras: number;
  readonly horasFalta: number;
  /** Dias de apuração ligados ao fechamento (0 = fechamento sem apuração diária, ex.: carga importada). */
  readonly diasApurados: number;
  readonly minutosPrevistos: number;
  /** Minutos dos itens apurados que contam como ausência (`contaComoAusencia`). */
  readonly minutosAusencia: number;
}

export interface HorasDoFechamento {
  readonly previstas: number;
  readonly trabalhadas: number;
  readonly ausencia: number;
  readonly extras: number;
  /** true quando previstas e ausência vieram da apuração diária; false = estimadas pelas horas do fechamento. */
  readonly apurado: boolean;
}

/**
 * As horas de um fechamento para o painel. Com apuração diária: previstas = Σ minutos previstos dos dias; ausência =
 * Σ minutos dos itens de ausência (atrasos, faltas e faltas abonadas). Sem apuração diária (fechamento consolidado,
 * sem os dias): previstas = trabalhadas − extras + faltas e ausência = faltas (estimativa pelas horas consolidadas
 * do fechamento), marcado `apurado: false`.
 */
export function horasDoFechamento(f: FechamentoPontoLido): HorasDoFechamento {
  if (f.diasApurados > 0)
    return {
      previstas: f.minutosPrevistos / 60,
      trabalhadas: f.horasTrabalhadas,
      ausencia: f.minutosAusencia / 60,
      extras: f.horasExtras,
      apurado: true,
    };
  return {
    previstas: f.horasTrabalhadas - f.horasExtras + f.horasFalta,
    trabalhadas: f.horasTrabalhadas,
    ausencia: f.horasFalta,
    extras: f.horasExtras,
    apurado: false,
  };
}

/** Uma lotação vigente (última operação da lotação, não excluída). Datas ISO; fim nulo = em aberto. */
export interface LotacaoVigente {
  readonly vinculo: number;
  readonly setor: number;
  readonly inicio: string;
  readonly fim: string | null;
  /** Percentual de rateio (0 < p ≤ 100). */
  readonly percentual: number;
}

export interface SetorComPeso {
  readonly setor: number | null;
  readonly peso: number;
}

export type IndiceLotacoes = ReadonlyMap<number, readonly LotacaoVigente[]>;

export function indexarLotacoes(ls: readonly LotacaoVigente[]): IndiceLotacoes {
  const m = new Map<number, LotacaoVigente[]>();
  for (const l of ls) {
    const xs = m.get(l.vinculo) ?? [];
    xs.push(l);
    m.set(l.vinculo, xs);
  }
  return m;
}

const vigentes = (idx: IndiceLotacoes, vinculo: number | null, data: string) =>
  vinculo === null
    ? []
    : (idx.get(vinculo) ?? []).filter((l) => l.inicio <= data && (l.fim === null || l.fim >= data));

/**
 * Os setores do vínculo na data, com o peso de cada um (soma 1). Lotações simultâneas no mesmo setor somam; o peso é o
 * percentual normalizado. Sem lotação vigente (vínculo sem histórico de lotação ou sem vínculo), cai no setor do
 * cadastro do vínculo (`setorAtual`), peso 1.
 */
export function setoresNaData(
  idx: IndiceLotacoes,
  vinculo: number | null,
  data: string,
  setorAtual: number | null,
): SetorComPeso[] {
  const ls = vigentes(idx, vinculo, data);
  const total = ls.reduce((s, l) => s + l.percentual, 0);
  if (!ls.length || total <= 0) return [{ setor: setorAtual, peso: 1 }];
  const por = new Map<number, number>();
  for (const l of ls) por.set(l.setor, (por.get(l.setor) ?? 0) + l.percentual);
  return [...por].sort((a, b) => a[0] - b[0]).map(([setor, p]) => ({ setor, peso: p / total }));
}

/** O setor principal na data (contagens inteiras): o de maior percentual; empate, o de início mais antigo e menor id. */
export function setorPrincipalNaData(
  idx: IndiceLotacoes,
  vinculo: number | null,
  data: string,
  setorAtual: number | null,
): number | null {
  const ps = setoresNaData(idx, vinculo, data, setorAtual);
  const inicio = (s: number | null) =>
    vigentes(idx, vinculo, data)
      .filter((l) => l.setor === s)
      .map((l) => l.inicio)
      .sort()[0] ?? '';
  return [...ps].sort(
    (a, b) =>
      b.peso - a.peso || inicio(a.setor).localeCompare(inicio(b.setor)) || Number(a.setor) - Number(b.setor),
  )[0]!.setor;
}

/** Soma valores por setor, cada fato repartido pelos pesos dos seus setores; `filtro` (setor pedido) recorta. */
export function somarPorSetor<K extends string>(
  fatos: readonly { setores: readonly SetorComPeso[]; valores: Readonly<Record<K, number>> }[],
  chaves: readonly K[],
  filtro: number | null,
): Map<number | null, Record<K, number>> {
  const m = new Map<number | null, Record<K, number>>();
  for (const f of fatos)
    for (const { setor, peso } of f.setores) {
      if (filtro !== null && setor !== filtro) continue;
      const a = m.get(setor) ?? (Object.fromEntries(chaves.map((k) => [k, 0])) as Record<K, number>);
      for (const k of chaves) a[k] += f.valores[k] * peso;
      m.set(setor, a);
    }
  return m;
}

const FUSO_PADRAO = 'America/Sao_Paulo';

const zona = (fuso: string | null): string => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso || FUSO_PADRAO });
    return fuso || FUSO_PADRAO;
  } catch {
    return FUSO_PADRAO;
  }
};

/** A data civil de um instante num fuso IANA (fuso inválido cai no padrão). */
export function dataNoFuso(instante: Date, fuso: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona(fuso),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** Deslocamento (ms) do fuso em relação ao UTC num instante. */
function deslocamento(instante: number, fuso: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instante))
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(
    Number(p['year']),
    Number(p['month']) - 1,
    Number(p['day']),
    Number(p['hour']),
    Number(p['minute']),
    Number(p['second']),
  );
  return local - Math.floor(instante / 1000) * 1000;
}

/** O instante (UTC) da meia-noite local da data ISO no fuso do estabelecimento (horário de verão considerado). */
export function inicioDoDiaNoFuso(data: string, fuso: string | null): Date {
  const z = zona(fuso);
  const ingenuo = Date.parse(`${data}T00:00:00Z`);
  let t = ingenuo - deslocamento(ingenuo, z);
  t = ingenuo - deslocamento(t, z);
  return new Date(t);
}
