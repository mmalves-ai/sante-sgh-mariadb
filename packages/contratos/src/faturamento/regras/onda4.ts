// Regras puras da onda 4 (ficha do M42, campo 8; cap-15 §15.3.3; cap-14 §14.9.4 e §14.10.2; cap-16 §16.3.6):
//   - regra 1: a onda começa na abertura de uma competência (primeiro dia útil do mês);
//   - regra 4: sem versão nos dias de fechamento de competência nem em feriado prolongado; hotfix só para S1;
//   - regra 9: códigos de baixa confiança da onda (DP-46.3 a DP-46.5): grava só valor já visto, legenda "a confirmar";
//   - acompanhamento da competência: contas por situação e por sistema que fechou, com as parcelas impressas;
//   - conferência da competência: relatório de diferenças entre duas leituras da mesma competência (deve ser vazio).
// Datas são texto AAAA-MM-DD (o calendário do hospital, sem fuso). Os feriados são os nacionais de lei (abaixo,
// `feriadosNacionais`) somados aos do cadastro de feriados do estabelecimento. Os dias de fechamento são parâmetro
// (POL-1), com o padrão de mercado declarado abaixo.
import { A_CONFIRMAR } from '../../legendas/legendas.js';
import { centavos, recusaFat, type RecusaFaturamento } from './recusa.js';

// ── Calendário ────────────────────────────────────────────────────────────────────────────────────────────

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** O dia é válido no calendário (AAAA-MM-DD)? */
export function diaValido(d: string): boolean {
  const m = RE_DIA.exec(d);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toISOString().slice(0, 10) === d;
}

function paraData(d: string): Date {
  if (!diaValido(d)) throw new RangeError(`Dia inválido: ${d}`);
  return new Date(`${d}T00:00:00Z`);
}

const texto = (dt: Date): string => dt.toISOString().slice(0, 10);

/** Soma dias corridos (negativo volta). */
export function somarDias(d: string, n: number): string {
  const dt = paraData(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return texto(dt);
}

/** Domingo de Páscoa do ano (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function domingoDePascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Feriados nacionais fixos de lei (Leis 662/1949, 6.802/1980 e 14.759/2023), como MM-DD. */
export const FERIADOS_NACIONAIS_FIXOS = [
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Dia Nacional de Zumbi e da Consciência Negra (desde 2024)
  '12-25', // Natal
] as const;

/**
 * Feriados nacionais do ano (padrão de mercado, POL-1): os fixos de lei e a Sexta-feira da Paixão (Lei 9.093/1995,
 * dois dias antes da Páscoa). Carnaval e Corpus Christi são ponto facultativo nacional: entram pelo cadastro de feriados
 * do estabelecimento quando o hospital não trabalha neles.
 */
export function feriadosNacionais(ano: number): string[] {
  const fixos = FERIADOS_NACIONAIS_FIXOS.filter((d) => ano >= 2024 || d !== '11-20').map(
    (d) => `${ano}-${d}`,
  );
  return [...fixos, somarDias(domingoDePascoa(ano), -2)].sort();
}

/** Dia útil: segunda a sexta e fora da lista de feriados do hospital. */
export function diaUtil(d: string, feriados: ReadonlySet<string>): boolean {
  const s = paraData(d).getUTCDay();
  return s !== 0 && s !== 6 && !feriados.has(d);
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

function ultimoDiaDoMes(ano: number, mes: number): string {
  return texto(new Date(Date.UTC(ano, mes, 0)));
}

/** Primeiro dia útil da competência (ano, mês 1 a 12): a abertura da competência (regra 1). */
export function primeiroDiaUtil(ano: number, mes: number, feriados: ReadonlySet<string>): string {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new RangeError(`Mês inválido: ${mes}`);
  let d = `${ano}-${doisDigitos(mes)}-01`;
  while (!diaUtil(d, feriados)) d = somarDias(d, 1);
  return d;
}

/** Os n primeiros dias úteis do mês, em ordem. */
export function primeirosDiasUteis(
  ano: number,
  mes: number,
  n: number,
  feriados: ReadonlySet<string>,
): string[] {
  const r: string[] = [];
  let d = primeiroDiaUtil(ano, mes, feriados);
  const fim = ultimoDiaDoMes(ano, mes);
  while (r.length < n && d <= fim) {
    if (diaUtil(d, feriados)) r.push(d);
    d = somarDias(d, 1);
  }
  return r;
}

/** Os n últimos dias úteis do mês, em ordem. */
export function ultimosDiasUteis(
  ano: number,
  mes: number,
  n: number,
  feriados: ReadonlySet<string>,
): string[] {
  const r: string[] = [];
  const inicio = `${ano}-${doisDigitos(mes)}-01`;
  let d = ultimoDiaDoMes(ano, mes);
  while (r.length < n && d >= inicio) {
    if (diaUtil(d, feriados)) r.unshift(d);
    d = somarDias(d, -1);
  }
  return r;
}

// ── Regra 1: começa na abertura de uma competência ───────────────────────────────────────────────────────

export interface AberturaConferida {
  readonly ok: boolean;
  /** Competência AAAA-MM da data conferida. */
  readonly competencia: string;
  /** Primeiro dia útil da competência da data. */
  readonly abertura: string;
  /** Quando a data não é a abertura: a próxima abertura (a da competência seguinte). */
  readonly proximaAbertura: string | null;
  readonly recusa: RecusaFaturamento | null;
}

/**
 * Confere que a autorização (ou o início) de um setor da onda 4 cai na abertura de uma competência: o primeiro dia
 * útil do mês, para que a competência inteira seja feita no novo e conferida no outro sistema (cap-15 §15.3.3).
 */
export function conferirAberturaDaCompetencia(
  data: string,
  feriados: ReadonlySet<string>,
): AberturaConferida {
  const dt = paraData(data);
  const ano = dt.getUTCFullYear();
  const mes = dt.getUTCMonth() + 1;
  const abertura = primeiroDiaUtil(ano, mes, feriados);
  const competencia = `${ano}-${doisDigitos(mes)}`;
  if (data === abertura) return { ok: true, competencia, abertura, proximaAbertura: null, recusa: null };
  const seguinte = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  const proximaAbertura = primeiroDiaUtil(seguinte.ano, seguinte.mes, feriados);
  return {
    ok: false,
    competencia,
    abertura,
    proximaAbertura,
    recusa: recusaFat(
      'onda4-fora-da-abertura',
      `A onda da receita começa no primeiro dia útil de uma competência. A de ${doisDigitos(mes)}/${ano} abriu em ${abertura}; a próxima abre em ${proximaAbertura}.`,
      ['data'],
    ),
  };
}

// ── Regra 4: sem versão nos dias de fechamento ───────────────────────────────────────────────────────────

/**
 * Dias de fechamento da competência (parâmetro do hospital; POL-1). Padrão de mercado até a resposta do faturamento:
 * os 2 últimos dias úteis do mês da competência e os 5 primeiros dias úteis do mês seguinte (fechamento das contas,
 * montagem dos lotes e envio às operadoras).
 */
export interface ParametrosFechamento {
  readonly ultimosDiasUteisDoMes: number;
  readonly primeirosDiasUteisDoMesSeguinte: number;
}

export const FECHAMENTO_PADRAO: ParametrosFechamento = {
  ultimosDiasUteisDoMes: 2,
  primeirosDiasUteisDoMesSeguinte: 5,
};

/** Os dias de fechamento da competência (ano, mês), em ordem. */
export function diasDeFechamento(
  ano: number,
  mes: number,
  feriados: ReadonlySet<string>,
  p: ParametrosFechamento = FECHAMENTO_PADRAO,
): string[] {
  const seguinte = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  return [
    ...ultimosDiasUteis(ano, mes, p.ultimosDiasUteisDoMes, feriados),
    ...primeirosDiasUteis(seguinte.ano, seguinte.mes, p.primeirosDiasUteisDoMesSeguinte, feriados),
  ];
}

/**
 * O dia está num feriado prolongado: um bloco de 3 ou mais dias seguidos sem expediente que contenha feriado, ou o
 * dia útil que o antecede (a versão daria problema sem equipe no dia seguinte).
 */
export function emFeriadoProlongado(d: string, feriados: ReadonlySet<string>): boolean {
  const bloco = (inicio: string): string[] => {
    const r: string[] = [];
    let x = inicio;
    while (!diaUtil(x, feriados)) {
      r.push(x);
      x = somarDias(x, 1);
    }
    return r;
  };
  const prolongado = (b: readonly string[]) => b.length >= 3 && b.some((x) => feriados.has(x));
  if (diaUtil(d, feriados)) return prolongado(bloco(somarDias(d, 1)));
  let inicio = d;
  while (!diaUtil(somarDias(inicio, -1), feriados)) inicio = somarDias(inicio, -1);
  return prolongado(bloco(inicio));
}

export const SEVERIDADES = ['S1', 'S2', 'S3', 'S4'] as const;
export type Severidade = (typeof SEVERIDADES)[number];

export interface DecisaoVersao {
  readonly pode: boolean;
  readonly motivo: 'livre' | 'fechamento' | 'feriado-prolongado';
  /** Só hotfix de S1 passa nos dias bloqueados. */
  readonly soHotfixS1: boolean;
}

/**
 * Pode publicar versão neste dia (cap-14 §14.10.2)? Nos dias de fechamento de qualquer competência e nos feriados
 * prolongados, só hotfix de S1. A competência de referência é a do mês do dia e a do mês anterior (o fechamento
 * atravessa a virada do mês).
 */
export function podePublicarVersao(
  d: string,
  severidade: Severidade | null,
  feriados: ReadonlySet<string>,
  p: ParametrosFechamento = FECHAMENTO_PADRAO,
): DecisaoVersao {
  const dt = paraData(d);
  const ano = dt.getUTCFullYear();
  const mes = dt.getUTCMonth() + 1;
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const fechamento = [
    ...diasDeFechamento(anterior.ano, anterior.mes, feriados, p),
    ...diasDeFechamento(ano, mes, feriados, p),
  ].includes(d);
  const motivo: DecisaoVersao['motivo'] = fechamento
    ? 'fechamento'
    : emFeriadoProlongado(d, feriados)
      ? 'feriado-prolongado'
      : 'livre';
  if (motivo === 'livre') return { pode: true, motivo, soHotfixS1: false };
  return { pode: severidade === 'S1', motivo, soHotfixS1: true };
}

// ── Regra 9: códigos de baixa confiança da onda ──────────────────────────────────────────────────────────

export interface CodigoBaixaConfianca {
  /** Campo do produto que recebe o código (a correspondência com a origem fica no conector). */
  readonly coluna: string;
  /** Decisão pendente que confirma a legenda. */
  readonly dp: 'DP-46.3' | 'DP-46.4' | 'DP-46.5';
  /** Pergunta do questionário (respostas/fiscal.md). */
  readonly pergunta: string;
  /** Valores que a ficha cita (só referência: o que vale é o visto no banco). */
  readonly citados: readonly string[];
}

/** Os códigos da onda 4 (ficha do M42, regra 9; Anexo A; respostas/fiscal.md FIS-08 a FIS-10). */
export const CODIGOS_BAIXA_CONFIANCA_ONDA_4: readonly CodigoBaixaConfianca[] = [
  { coluna: 'contaPagar.situacao', dp: 'DP-46.3', pergunta: 'FIS-08', citados: [] },
  { coluna: 'contaPagar.formaPagamento', dp: 'DP-46.3', pergunta: 'FIS-08', citados: [] },
  { coluna: 'contaReceber.origem', dp: 'DP-46.4', pergunta: 'FIS-09', citados: ['F', 'E'] },
  {
    coluna: 'movimentoBancario.tipoTransferencia',
    dp: 'DP-46.4',
    pergunta: 'FIS-09',
    citados: ['I', 'T', 'C', 'D'],
  },
  { coluna: 'contaHospitalar.tipoNota', dp: 'DP-46.5', pergunta: 'FIS-10', citados: [] },
  { coluna: 'contaHospitalar.pacote', dp: 'DP-46.5', pergunta: 'FIS-10', citados: ['P', 'D', 'F'] },
  { coluna: 'itemConta.fpa', dp: 'DP-46.5', pergunta: 'FIS-10', citados: [] },
  { coluna: 'itemConta.origemLancamento', dp: 'DP-46.5', pergunta: 'FIS-10', citados: ['B', 'P', 'D'] },
];

export interface CodigoConferido {
  readonly aceito: boolean;
  /** Legenda da tela: a confirmada, ou o próprio valor com "(a confirmar)". */
  readonly legenda: string;
  readonly recusa: RecusaFaturamento | null;
}

/**
 * Confere um código de baixa confiança antes de gravar (regra 9): aceita só valor já visto no banco do hospital
 * (`dominios-vistos.json` do grupo); a legenda fica "a confirmar" até a DP ser respondida. Coluna fora da lista da
 * onda: só a regra geral dos domínios vistos (devolve aceito).
 */
export function conferirCodigoOnda4(
  coluna: string,
  valor: string,
  vistos: readonly string[],
  confirmadas: Readonly<Record<string, string>> = {},
): CodigoConferido {
  const def = CODIGOS_BAIXA_CONFIANCA_ONDA_4.find((c) => c.coluna === coluna);
  const legenda = confirmadas[valor] ?? (valor === '' ? A_CONFIRMAR : `${valor} ${A_CONFIRMAR}`);
  if (!def) return { aceito: true, legenda, recusa: null };
  if (vistos.includes(valor)) return { aceito: true, legenda, recusa: null };
  return {
    aceito: false,
    legenda,
    recusa: recusaFat(
      'codigo-nunca-visto',
      `O código "${valor}" de ${coluna} nunca foi visto neste hospital e ainda não tem a legenda confirmada (${def.dp}); nada foi gravado.`,
      [coluna],
    ),
  };
}

// ── Acompanhamento da competência ────────────────────────────────────────────────────────────────────────

/** Situação da conta no outro sistema: N aberta, S fechada, A apresentada (em lote). */
export const SITUACOES_CONTA_ONDA = ['N', 'S', 'A'] as const;
export type SituacaoContaOnda = (typeof SITUACOES_CONTA_ONDA)[number];

/** Linha agregada da leitura: convênio × situação, com as fechadas pelo novo e o valor. */
export interface LinhaContasCompetencia {
  readonly convenio: number;
  readonly situacao: string;
  readonly contas: number;
  /** Das contas da linha, quantas o novo fechou (a última fechada é a do novo pela trilha). */
  readonly fechadasPeloNovo: number;
  readonly valor: number;
}

export interface ParcelaSituacao {
  readonly situacao: SituacaoContaOnda | 'outra';
  readonly contas: number;
  readonly valor: number;
}

export interface ResumoContasCompetencia {
  readonly contas: number;
  readonly valor: number;
  /** As parcelas por situação, que somam o total (impressas na tela e no relatório). */
  readonly porSituacao: readonly ParcelaSituacao[];
  /** Fechadas (S ou A) e quem fechou: as parcelas somam `fechadas`. */
  readonly fechadas: number;
  readonly fechadasPeloNovo: number;
  readonly fechadasPeloOutro: number;
  /** Parcela do novo nas fechadas (0 a 1), ou nulo sem conta fechada. */
  readonly parcelaDoNovo: number | null;
  readonly porConvenio: readonly {
    readonly convenio: number;
    readonly contas: number;
    readonly fechadas: number;
    readonly fechadasPeloNovo: number;
    readonly valor: number;
  }[];
}

const situacaoConhecida = (s: string): s is SituacaoContaOnda =>
  (SITUACOES_CONTA_ONDA as readonly string[]).includes(s);

/** Agrega as linhas da leitura no resumo do painel; toda soma sai com as parcelas. */
export function resumirContasDaCompetencia(
  linhas: readonly LinhaContasCompetencia[],
): ResumoContasCompetencia {
  const sit = new Map<ParcelaSituacao['situacao'], { contas: number; valor: number }>();
  const conv = new Map<
    number,
    { contas: number; fechadas: number; fechadasPeloNovo: number; valor: number }
  >();
  let contas = 0;
  let valor = 0;
  let fechadas = 0;
  let novo = 0;
  for (const l of linhas) {
    const s = situacaoConhecida(l.situacao) ? l.situacao : 'outra';
    const fechada = s === 'S' || s === 'A';
    const doNovo = fechada ? Math.min(l.fechadasPeloNovo, l.contas) : 0;
    const a = sit.get(s) ?? { contas: 0, valor: 0 };
    sit.set(s, { contas: a.contas + l.contas, valor: a.valor + l.valor });
    const c = conv.get(l.convenio) ?? { contas: 0, fechadas: 0, fechadasPeloNovo: 0, valor: 0 };
    conv.set(l.convenio, {
      contas: c.contas + l.contas,
      fechadas: c.fechadas + (fechada ? l.contas : 0),
      fechadasPeloNovo: c.fechadasPeloNovo + doNovo,
      valor: c.valor + l.valor,
    });
    contas += l.contas;
    valor += l.valor;
    if (fechada) fechadas += l.contas;
    novo += doNovo;
  }
  const ordem: ParcelaSituacao['situacao'][] = [...SITUACOES_CONTA_ONDA, 'outra'];
  return {
    contas,
    valor: centavos(valor),
    porSituacao: ordem
      .filter((s) => sit.has(s))
      .map((s) => ({ situacao: s, contas: sit.get(s)!.contas, valor: centavos(sit.get(s)!.valor) })),
    fechadas,
    fechadasPeloNovo: novo,
    fechadasPeloOutro: fechadas - novo,
    parcelaDoNovo: fechadas === 0 ? null : novo / fechadas,
    porConvenio: [...conv.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([convenio, c]) => ({ convenio, ...c, valor: centavos(c.valor) })),
  };
}

// ── Conferência da competência: relatório de diferenças ──────────────────────────────────────────────────

/** Uma linha de retrato: chave (convênio, conta, lote, título…) e os valores comparados. */
export interface LinhaRetrato {
  readonly chave: string;
  readonly valores: Readonly<Record<string, number | string | null>>;
}

export interface DiferencaCompetencia {
  readonly chave: string;
  /** Campo divergente, ou `presenca` quando a chave só existe de um lado. */
  readonly campo: string;
  readonly novo: number | string | null;
  readonly outro: number | string | null;
}

const igual = (a: number | string | null | undefined, b: number | string | null | undefined): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005;
  return (a ?? null) === (b ?? null);
};

/**
 * Compara a mesma competência lida pelo novo e pelo outro sistema (as mesmas contas, lotes, títulos e RPAs): a lista
 * de diferenças deve ser vazia (ficha do M42, campo 4). Números comparam com tolerância de meio centavo.
 */
export function diferencasDaCompetencia(
  novo: readonly LinhaRetrato[],
  outro: readonly LinhaRetrato[],
): DiferencaCompetencia[] {
  const a = new Map(novo.map((l) => [l.chave, l.valores]));
  const b = new Map(outro.map((l) => [l.chave, l.valores]));
  const chaves = [...new Set([...a.keys(), ...b.keys()])].sort();
  const r: DiferencaCompetencia[] = [];
  for (const k of chaves) {
    const x = a.get(k);
    const y = b.get(k);
    if (!x || !y) {
      r.push({ chave: k, campo: 'presenca', novo: x ? 'presente' : null, outro: y ? 'presente' : null });
      continue;
    }
    for (const campo of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (!igual(x[campo], y[campo]))
        r.push({ chave: k, campo, novo: x[campo] ?? null, outro: y[campo] ?? null });
    }
  }
  return r;
}
