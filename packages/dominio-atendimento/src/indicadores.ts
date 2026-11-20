// Indicadores do ambulatório e do PA (ficha do M20, seção 4 e regras 3 e 8): o denominador é o atendimento com
// consulta (ESPEC > 0): a requisição de laboratório (LAB = S, ESPEC = 0, valor 0) entra à parte (sem o filtro o
// denominador fica 41% maior). Porta → médico, porta → decisão e permanência saem SÓ das marcas do novo
// (SGH_PA_ETAPA): o outro sistema não guarda a hora da saída (cópia da entrada). Evasão = motivo 16 (desfecho
// evasao). Toda conta vai com as parcelas (os atendimentos sem marcas são contados à parte).
import {
  CARATERES,
  type Desfecho,
  DESFECHOS,
  type IndicadoresAtendimento,
  rotuloTipoAte,
  caraterLido,
} from '@sgh/contratos';

export interface AtendimentoParaIndicador {
  readonly tipoAte: number;
  readonly especialidade: number;
  readonly laboratorio: boolean;
  readonly carater: number | null;
  readonly desfecho: Desfecho | null;
  /** Marcas do novo (ISO, relógio do banco), quando houver. */
  readonly chegada?: string | null;
  readonly atendimentoMedico?: string | null;
  readonly decisao?: string | null;
  readonly saida?: string | null;
  readonly observacaoHoras?: number | null;
  /** Chave do paciente e hora da ficha (retorno ao PA em 72 horas). */
  readonly paciente?: string;
  readonly data?: string;
  readonly hora?: string;
  /** Encaminhado à internação a partir desta ficha (SGH_INT_ENCAMINHAMENTO). */
  readonly encaminhadoInternacao?: boolean;
}

const ms = (iso: string) => Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
const min = (a: string, b: string) => (ms(b) - ms(a)) / 60_000;

/** Mediana (minutos, inteiro) ou null sem amostra. */
export function mediana(v: readonly number[]): number | null {
  const x = v.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (x.length === 0) return null;
  const m = Math.floor(x.length / 2);
  const r = x.length % 2 ? (x[m] as number) : ((x[m - 1] as number) + (x[m] as number)) / 2;
  return Math.round(r);
}

/** Uma visita ao PA (paciente pela chave do prontuário; data e hora da ficha) para o retorno em 72 horas. */
export interface VisitaPa {
  readonly paciente: string;
  /** AAAA-MM-DD. */
  readonly data: string;
  /** HH:MM. */
  readonly hora: string;
}

/** Janela do retorno ao PA (horas). */
export const JANELA_RETORNO_PA_HORAS = 72;

/**
 * Retorno ao PA em 72 horas: numerador = visitas do período cujo paciente teve outra visita ao PA nas 72 horas
 * anteriores (de 1 minuto a 72 horas: a mesma ficha não conta); denominador = visitas ao PA do período. As visitas
 * anteriores ao início (até 3 dias) entram só como referência, nunca no denominador.
 */
export function retornoPa72h(
  periodo: { inicio: string; fim: string },
  visitas: readonly VisitaPa[],
): { retornos: number; atendimentos: number; taxa: number | null } {
  const quando = (v: VisitaPa) => Date.parse(`${v.data}T${v.hora || '00:00'}:00Z`);
  const porPaciente = new Map<string, number[]>();
  for (const v of visitas) {
    const t = quando(v);
    if (!Number.isFinite(t)) continue;
    (porPaciente.get(v.paciente) ?? porPaciente.set(v.paciente, []).get(v.paciente))?.push(t);
  }
  const janela = JANELA_RETORNO_PA_HORAS * 3_600_000;
  let atendimentos = 0;
  let retornos = 0;
  for (const v of visitas) {
    if (v.data < periodo.inicio || v.data > periodo.fim) continue;
    const t = quando(v);
    if (!Number.isFinite(t)) continue;
    atendimentos++;
    const outras = porPaciente.get(v.paciente) ?? [];
    if (outras.some((o) => t - o > 0 && t - o <= janela)) retornos++;
  }
  return { retornos, atendimentos, taxa: taxa(retornos, atendimentos) };
}

/** Percentual com uma casa (null sem denominador). */
export function taxa(numerador: number, denominador: number): number | null {
  return denominador > 0 ? Math.round((numerador / denominador) * 1000) / 10 : null;
}

/** Internações originadas no PA: pelo desfecho do novo ou pelo encaminhamento à internação (sem contar duas vezes). */
export interface InternacoesPa {
  readonly viaDesfecho: number;
  readonly viaEncaminhamento: number;
  /** Fichas do PA com pelo menos uma das duas marcas (o numerador). */
  readonly total: number;
}

function blocoMercadoPa(
  periodo: { inicio: string; fim: string },
  paAtendimentos: number,
  visitas: readonly VisitaPa[] | undefined,
  internacoes: InternacoesPa | undefined,
) {
  const r = visitas
    ? retornoPa72h(periodo, visitas)
    : { retornos: 0, atendimentos: paAtendimentos, taxa: taxa(0, paAtendimentos) };
  const i = internacoes ?? { viaDesfecho: 0, viaEncaminhamento: 0, total: 0 };
  return {
    retorno72h: r.retornos,
    retorno72hDenominador: r.atendimentos,
    taxaRetorno72h: r.taxa,
    internacoes: i.total,
    internacoesViaDesfecho: i.viaDesfecho,
    internacoesViaEncaminhamento: i.viaEncaminhamento,
    taxaInternacao: taxa(i.total, paAtendimentos),
  };
}

/** Requisição de laboratório (sem consulta): ESPEC 0 ou a marca LAB (regra 3). */
export function ehRequisicao(a: Pick<AtendimentoParaIndicador, 'especialidade' | 'laboratorio'>): boolean {
  return a.laboratorio || a.especialidade === 0;
}

export function calcularIndicadores(
  periodo: { inicio: string; fim: string },
  todos: readonly AtendimentoParaIndicador[],
): IndicadoresAtendimento {
  const consultas = todos.filter((a) => !ehRequisicao(a));
  const porTipo = new Map<number, number>();
  for (const a of consultas) porTipo.set(a.tipoAte, (porTipo.get(a.tipoAte) ?? 0) + 1);
  const porCarater = new Map<string, number>();
  for (const a of consultas) {
    const c = caraterLido(a.carater);
    const k = c ?? 'naoInformado';
    porCarater.set(k, (porCarater.get(k) ?? 0) + 1);
  }
  const pa = consultas.filter((a) => a.tipoAte === 11);
  const comMarcas = pa.filter((a) => a.chegada);
  const portaMedico = comMarcas.flatMap((a) =>
    a.chegada && a.atendimentoMedico ? [min(a.chegada, a.atendimentoMedico)] : [],
  );
  const portaDecisao = comMarcas.flatMap((a) => (a.chegada && a.decisao ? [min(a.chegada, a.decisao)] : []));
  const permanencia = comMarcas.flatMap((a) => (a.chegada && a.saida ? [min(a.chegada, a.saida)] : []));
  const evasoes = pa.filter((a) => a.desfecho === 'evasao').length;
  const comDesfecho = pa.filter((a) => a.desfecho !== null).length;
  const obs = pa.filter((a) => (a.observacaoHoras ?? null) !== null);
  const desfechos = new Map<string, number>();
  for (const a of consultas) if (a.desfecho) desfechos.set(a.desfecho, (desfechos.get(a.desfecho) ?? 0) + 1);
  return {
    inicio: periodo.inicio,
    fim: periodo.fim,
    atendimentos: consultas.length,
    requisicoesLaboratorio: todos.length - consultas.length,
    porTipo: [...porTipo.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([t, total]) => ({ tipo: String(t), rotulo: rotuloTipoAte(t), total })),
    porCarater: [
      ...CARATERES.map((c) => ({ carater: c.rotulo, total: porCarater.get(c.codigo) ?? 0 })),
      { carater: 'Não informado', total: porCarater.get('naoInformado') ?? 0 },
    ],
    pa: {
      atendimentos: pa.length,
      comMarcas: comMarcas.length,
      portaMedicoMedianaMin: mediana(portaMedico),
      portaDecisaoMedianaMin: mediana(portaDecisao),
      permanenciaMedianaMin: mediana(permanencia),
      evasoes,
      comDesfecho,
      taxaEvasao: taxa(evasoes, comDesfecho),
      observacoes: obs.length,
      observacoesAcima24h: obs.filter((a) => (a.observacaoHoras ?? 0) >= 24).length,
      ...blocoMercadoPa(
        periodo,
        pa.length,
        pa.flatMap((a) =>
          a.paciente && a.data ? [{ paciente: a.paciente, data: a.data, hora: a.hora ?? '00:00' }] : [],
        ),
        {
          viaDesfecho: pa.filter((a) => a.desfecho === 'internacao').length,
          viaEncaminhamento: pa.filter((a) => a.encaminhadoInternacao).length,
          total: pa.filter((a) => a.desfecho === 'internacao' || a.encaminhadoInternacao).length,
        },
      ),
    },
    desfechos: DESFECHOS.map((d) => ({
      desfecho: d.codigo,
      rotulo: d.rotulo,
      total: desfechos.get(d.codigo) ?? 0,
    })),
    semMarcas: pa.length - comMarcas.length,
  };
}

/** Os agregados lidos do banco (contagens por grupo e as marcas do novo por atendimento). */
export interface AgregadosAtendimento {
  readonly porTipo: readonly {
    readonly tipoAte: number;
    readonly laboratorio: boolean;
    readonly especialidadeZero: boolean;
    readonly caracters: number;
    readonly total: number;
  }[];
  readonly desfechos: readonly {
    readonly desfecho: string;
    readonly tipoAte: number;
    readonly total: number;
  }[];
  readonly marcasPa: readonly { readonly cabecalho: string; readonly etapa: string; readonly em: string }[];
  readonly observacoes: readonly { readonly cabecalho: string; readonly minutos: number }[];
  readonly paTotal: number;
  /** Visitas ao PA do período e dos 3 dias anteriores (retorno em 72 horas). */
  readonly visitasPa?: readonly VisitaPa[];
  readonly internacoesPa?: InternacoesPa;
}

/**
 * Os mesmos indicadores a partir dos agregados (sem uma linha por atendimento): as contagens por grupo do banco e as
 * marcas do novo por atendimento de PA. Mesmas regras do cálculo por atendimento (denominador ESPEC > 0; tempos só
 * das marcas; evasão sobre os desfechos registrados do PA).
 */
export function calcularIndicadoresAgregados(
  periodo: { inicio: string; fim: string },
  a: AgregadosAtendimento,
): IndicadoresAtendimento {
  const consultas = a.porTipo.filter((g) => !(g.laboratorio || g.especialidadeZero));
  const soma = (xs: readonly { total: number }[]) => xs.reduce((t, x) => t + x.total, 0);
  const porTipo = new Map<number, number>();
  for (const g of consultas) porTipo.set(g.tipoAte, (porTipo.get(g.tipoAte) ?? 0) + g.total);
  const porCarater = new Map<string, number>();
  for (const g of consultas) {
    const k = caraterLido(g.caracters) ?? 'naoInformado';
    porCarater.set(k, (porCarater.get(k) ?? 0) + g.total);
  }
  const marcas = new Map<string, Map<string, string>>();
  for (const m of a.marcasPa) {
    const x = marcas.get(m.cabecalho) ?? new Map<string, string>();
    const atual = x.get(m.etapa);
    if (!atual || m.em < atual) x.set(m.etapa, m.em);
    marcas.set(m.cabecalho, x);
  }
  const portaMedico: number[] = [];
  const portaDecisao: number[] = [];
  const permanencia: number[] = [];
  let comMarcas = 0;
  for (const x of marcas.values()) {
    const chegada = x.get('chegada') ?? x.get('abertura');
    if (!chegada) continue;
    comMarcas++;
    const medico = x.get('atendimentoMedico');
    const decisao = x.get('decisao');
    const saida = x.get('saida');
    if (medico) portaMedico.push(min(chegada, medico));
    if (decisao) portaDecisao.push(min(chegada, decisao));
    if (saida) permanencia.push(min(chegada, saida));
  }
  const desfechosPa = a.desfechos.filter((d) => d.tipoAte === 11);
  const evasoes = soma(desfechosPa.filter((d) => d.desfecho === 'evasao'));
  const comDesfecho = soma(desfechosPa);
  const desfechos = new Map<string, number>();
  for (const d of a.desfechos) desfechos.set(d.desfecho, (desfechos.get(d.desfecho) ?? 0) + d.total);
  const atendimentos = soma(consultas);
  return {
    inicio: periodo.inicio,
    fim: periodo.fim,
    atendimentos,
    requisicoesLaboratorio: soma(a.porTipo) - atendimentos,
    porTipo: [...porTipo.entries()]
      .sort((x, y) => y[1] - x[1] || x[0] - y[0])
      .map(([t, total]) => ({ tipo: String(t), rotulo: rotuloTipoAte(t), total })),
    porCarater: [
      ...CARATERES.map((c) => ({ carater: c.rotulo, total: porCarater.get(c.codigo) ?? 0 })),
      { carater: 'Não informado', total: porCarater.get('naoInformado') ?? 0 },
    ],
    pa: {
      atendimentos: a.paTotal,
      comMarcas,
      portaMedicoMedianaMin: mediana(portaMedico),
      portaDecisaoMedianaMin: mediana(portaDecisao),
      permanenciaMedianaMin: mediana(permanencia),
      evasoes,
      comDesfecho,
      taxaEvasao: taxa(evasoes, comDesfecho),
      observacoes: a.observacoes.length,
      observacoesAcima24h: a.observacoes.filter((o) => o.minutos >= 24 * 60).length,
      ...blocoMercadoPa(periodo, a.paTotal, a.visitasPa, a.internacoesPa),
    },
    desfechos: DESFECHOS.map((d) => ({
      desfecho: d.codigo,
      rotulo: d.rotulo,
      total: desfechos.get(d.codigo) ?? 0,
    })),
    semMarcas: Math.max(0, a.paTotal - comMarcas),
  };
}

/** Uma linha exportável: o indicador com numerador, denominador e a taxa (%). */
export interface LinhaIndicadorPa {
  readonly indicador: string;
  readonly numerador: number;
  readonly denominador: number;
  readonly taxa: number | null;
}

/** Os indicadores do PA com numerador e denominador (evasão, retorno em 72 h, internação via PA, observação > 24 h). */
export function linhasIndicadoresPa(i: IndicadoresAtendimento): LinhaIndicadorPa[] {
  const p = i.pa;
  return [
    { indicador: 'Retorno ao PA em 72 horas', numerador: p.retorno72h, denominador: p.retorno72hDenominador },
    { indicador: 'Taxa de internação via PA', numerador: p.internacoes, denominador: p.atendimentos },
    {
      indicador: 'Internação via PA: pelo desfecho',
      numerador: p.internacoesViaDesfecho,
      denominador: p.atendimentos,
    },
    {
      indicador: 'Internação via PA: pelo encaminhamento',
      numerador: p.internacoesViaEncaminhamento,
      denominador: p.atendimentos,
    },
    { indicador: 'Evasão', numerador: p.evasoes, denominador: p.comDesfecho },
    {
      indicador: 'Observação acima de 24 horas',
      numerador: p.observacoesAcima24h,
      denominador: p.observacoes,
    },
  ].map((l) => ({ ...l, taxa: taxa(l.numerador, l.denominador) }));
}

/** Os indicadores do PA com ficha no catálogo de indicadores da qualidade (W0-07, critério 6). */
export const INDICADORES_PA_CATALOGO = ['retornoPa72h', 'internacaoViaPa'] as const;
export type CodigoIndicadorPaCatalogo = (typeof INDICADORES_PA_CATALOGO)[number];

/**
 * O numerador e o denominador de cada indicador do PA do catálogo: as mesmas parcelas das duas primeiras linhas de
 * linhasIndicadoresPa (retorno em 72 h; internação via PA sobre os atendimentos do PA).
 */
export function totaisIndicadoresPaCatalogo(
  i: IndicadoresAtendimento,
): Map<CodigoIndicadorPaCatalogo, { numerador: number; denominador: number }> {
  return new Map<CodigoIndicadorPaCatalogo, { numerador: number; denominador: number }>([
    ['retornoPa72h', { numerador: i.pa.retorno72h, denominador: i.pa.retorno72hDenominador }],
    ['internacaoViaPa', { numerador: i.pa.internacoes, denominador: i.pa.atendimentos }],
  ]);
}

/** O CSV dos indicadores do PA (ponto e vírgula, vírgula decimal, CRLF), com o período na primeira coluna. */
export function csvIndicadoresPa(i: IndicadoresAtendimento): string {
  const cel = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const linhas = [
    ['Início', 'Fim', 'Indicador', 'Numerador', 'Denominador', 'Taxa (%)'],
    ...linhasIndicadoresPa(i).map((l) => [
      i.inicio,
      i.fim,
      l.indicador,
      String(l.numerador),
      String(l.denominador),
      l.taxa === null ? '' : String(l.taxa).replace('.', ','),
    ]),
  ];
  return linhas.map((l) => `${l.map(cel).join(';')}\r\n`).join('');
}
