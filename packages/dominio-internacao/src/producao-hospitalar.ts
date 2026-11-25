// Produção hospitalar mensal e valor da categoria clínica (F8, 09-AREA linha 87). Regras puras, sem banco.
// Conceitos da Portaria MS 312/2002 (padronização da nomenclatura do censo hospitalar):
//   - paciente-dia: cada dia em que o paciente esteve internado; o dia da saída não conta, salvo entrada e saída no
//     mesmo dia (conta 1);
//   - leito-dia: leitos operacionais × dias do período;
//   - taxa de ocupação = paciente-dia / leito-dia × 100; média de permanência = paciente-dia / saídas;
//   - giro (rotatividade, produtividade do leito) = saídas / leitos operacionais;
//   - intervalo de substituição = (leito-dia − paciente-dia) / saídas;
//   - taxa de mortalidade = óbitos / saídas × 100 (saídas = altas, transferências externas, óbitos e evasões).
// Pontualidade da alta: saídas até a data prevista de alta sobre as saídas que tinham previsão (melhoria própria).
// O valor produzido soma, dia a dia, a diária da faixa vigente da categoria clínica em que o paciente estava; o dia
// sem faixa fica fora do valor e é contado à parte (dias sem faixa), nunca estimado.

export type TipoSaidaProducao = 'alta' | 'transferencia' | 'obito' | 'evasao' | 'outra';

export interface FaixaValorCategoria {
  readonly clinicaId: number;
  /** AAAA-MM-DD. */
  readonly inicio: string;
  readonly fim: string | null;
  readonly valorDiaria: number;
}

export interface PeriodoCategoria {
  readonly clinicaId: number | null;
  /** Instante ISO (AAAA-MM-DDTHH:MM...) ou data. */
  readonly inicio: string;
  readonly fim: string | null;
}

export interface InternacaoProducao {
  readonly entrada: string;
  readonly saida: string | null;
  readonly tipoSaida: TipoSaidaProducao | null;
  /** AAAA-MM-DD. */
  readonly previstaAlta: string | null;
  /** Clínica da internação quando não há período de categoria gravado. */
  readonly clinicaId: number | null;
  /** Períodos em ordem; vazio: a internação inteira na clinicaId. */
  readonly periodos: readonly PeriodoCategoria[];
}

export interface LeitosClinica {
  readonly clinicaId: number | null;
  readonly leitos: number;
}

export interface IndicadoresProducao {
  readonly leitosOperacionais: number;
  readonly entradas: number;
  readonly saidas: number;
  readonly obitos: number;
  readonly transferenciasExternas: number;
  readonly pacienteDia: number;
  readonly leitoDia: number;
  readonly taxaOcupacao: number | null;
  readonly mediaPermanencia: number | null;
  readonly giroLeito: number | null;
  readonly intervaloSubstituicao: number | null;
  readonly taxaMortalidade: number | null;
  readonly saidasComPrevisao: number;
  readonly saidasNoPrazo: number;
  readonly pontualidadeAlta: number | null;
  readonly valorProduzido: number;
  readonly diasSemFaixa: number;
}

export interface ProducaoMensal {
  readonly mes: string;
  readonly de: string;
  readonly ate: string;
  readonly dias: number;
  readonly total: IndicadoresProducao;
  readonly porClinica: readonly (IndicadoresProducao & { readonly clinicaId: number | null })[];
}

const DIA_MS = 86_400_000;
const dataDe = (iso: string): string => iso.slice(0, 10);
const diaNum = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / DIA_MS);
const numDia = (n: number): string => new Date(n * DIA_MS).toISOString().slice(0, 10);
const r2 = (v: number): number => Math.round(v * 100) / 100;
const razao = (a: number, b: number, fator = 1): number | null => (b > 0 ? r2((a / b) * fator) : null);

export function mesValido(mes: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
}

/** Primeiro e último dia do mês (AAAA-MM). */
export function limitesDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * Dias contados (paciente-dia) de um período dentro de [de, ate] (datas inclusivas): os dias de inicio até a véspera
 * do fim; período aberto vai até ate; entrada e saída no mesmo dia contam 1 (se o dia estiver no intervalo).
 */
export function diasDoPeriodo(
  inicio: string,
  fim: string | null,
  de: string,
  ate: string,
  mesmoDiaConta = true,
): string[] {
  const i = diaNum(dataDe(inicio));
  const f = fim === null ? diaNum(ate) + 1 : diaNum(dataDe(fim));
  const lo = diaNum(de);
  const hi = diaNum(ate);
  const dias: string[] = [];
  if (f <= i) {
    if (mesmoDiaConta && f === i && i >= lo && i <= hi) dias.push(numDia(i));
    return dias;
  }
  for (let d = Math.max(i, lo); d < f && d <= hi; d++) dias.push(numDia(d));
  return dias;
}

/** A faixa vigente da categoria no dia (a de início mais recente). */
export function faixaVigente(
  faixas: readonly FaixaValorCategoria[],
  clinicaId: number,
  dia: string,
): FaixaValorCategoria | null {
  let achada: FaixaValorCategoria | null = null;
  for (const f of faixas)
    if (f.clinicaId === clinicaId && f.inicio <= dia && (f.fim === null || f.fim >= dia))
      if (!achada || f.inicio > achada.inicio) achada = f;
  return achada;
}

export interface ValorPeriodo {
  readonly diarias: number;
  readonly valor: number;
  readonly diasSemFaixa: number;
  readonly faixas: readonly {
    readonly inicio: string;
    readonly valorDiaria: number;
    readonly dias: number;
  }[];
}

/** O valor de um período da categoria clínica pela faixa vigente em cada dia (dentro de [de, ate], se dado). */
export function valorDoPeriodo(
  p: PeriodoCategoria,
  faixas: readonly FaixaValorCategoria[],
  ate: string,
  de = '1900-01-01',
  mesmoDiaConta = true,
): ValorPeriodo {
  const dias = diasDoPeriodo(p.inicio, p.fim, de, ate, mesmoDiaConta);
  let valor = 0;
  let semFaixa = 0;
  const usadas = new Map<string, { inicio: string; valorDiaria: number; dias: number }>();
  for (const d of dias) {
    const f = p.clinicaId === null ? null : faixaVigente(faixas, p.clinicaId, d);
    if (!f) {
      semFaixa++;
      continue;
    }
    valor += f.valorDiaria;
    const u = usadas.get(f.inicio) ?? { inicio: f.inicio, valorDiaria: f.valorDiaria, dias: 0 };
    u.dias++;
    usadas.set(f.inicio, u);
  }
  return { diarias: dias.length, valor: r2(valor), diasSemFaixa: semFaixa, faixas: [...usadas.values()] };
}

export interface PedidoPeriodoCategoria {
  readonly entrada: string;
  readonly saida: string | null;
  /** Início do período vigente (o último), se houver. */
  readonly inicioVigente: string | null;
  readonly inicio: string;
  readonly agora: string;
}

/** Validação do novo período da categoria clínica; devolve os erros por campo. */
export function validarPeriodoCategoria(p: PedidoPeriodoCategoria): Record<string, string> {
  const erros: Record<string, string> = {};
  if (Number.isNaN(Date.parse(p.inicio))) erros['inicio'] = 'Informe a data e a hora de início.';
  else if (Date.parse(p.inicio) < Date.parse(p.entrada))
    erros['inicio'] = 'O início não pode ser antes da entrada do paciente.';
  else if (Date.parse(p.inicio) > Date.parse(p.agora)) erros['inicio'] = 'O início não pode ser no futuro.';
  else if (p.saida !== null && Date.parse(p.inicio) >= Date.parse(p.saida))
    erros['inicio'] = 'O início tem de ser antes da saída do paciente.';
  else if (p.inicioVigente !== null && Date.parse(p.inicio) <= Date.parse(p.inicioVigente))
    erros['inicio'] = 'O início tem de ser depois do início da categoria vigente (o histórico não muda).';
  return erros;
}

/** Validação da faixa de valor da categoria clínica. */
export function validarFaixaValor(f: {
  readonly valorDiaria: number;
  readonly inicio: string;
  readonly fim: string | null;
}): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!Number.isFinite(f.valorDiaria) || f.valorDiaria < 0)
    erros['valorDiaria'] = 'O valor da diária tem de ser zero ou maior.';
  else if (Math.round(f.valorDiaria * 100) !== f.valorDiaria * 100)
    erros['valorDiaria'] = 'O valor da diária tem no máximo dois decimais.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.inicio)) erros['inicio'] = 'Informe o início da vigência.';
  else if (f.fim !== null && f.fim < f.inicio)
    erros['fim'] = 'O fim da vigência não pode ser antes do início.';
  return erros;
}

/** Os períodos efetivos da internação: os gravados ou a internação inteira na clínica dela. */
function periodosDa(i: InternacaoProducao): PeriodoCategoria[] {
  if (i.periodos.length === 0) return [{ clinicaId: i.clinicaId, inicio: i.entrada, fim: i.saida }];
  const antes: PeriodoCategoria[] =
    Date.parse(i.periodos[0]!.inicio) > Date.parse(i.entrada)
      ? [{ clinicaId: i.clinicaId, inicio: i.entrada, fim: i.periodos[0]!.inicio }]
      : [];
  return antes.concat(
    i.periodos.map((p, k) => {
      const proximo = i.periodos[k + 1];
      const fim = proximo ? proximo.inicio : (p.fim ?? i.saida);
      return { clinicaId: p.clinicaId, inicio: p.inicio, fim };
    }),
  );
}

interface Acumulado {
  entradas: number;
  saidas: number;
  obitos: number;
  transferencias: number;
  pacienteDia: number;
  comPrevisao: number;
  noPrazo: number;
  valor: number;
  semFaixa: number;
}

const zero = (): Acumulado => ({
  entradas: 0,
  saidas: 0,
  obitos: 0,
  transferencias: 0,
  pacienteDia: 0,
  comPrevisao: 0,
  noPrazo: 0,
  valor: 0,
  semFaixa: 0,
});

function indicadores(a: Acumulado, leitos: number, dias: number): IndicadoresProducao {
  const leitoDia = leitos * dias;
  const ocupacao = razao(a.pacienteDia, leitoDia, 100);
  return {
    leitosOperacionais: leitos,
    entradas: a.entradas,
    saidas: a.saidas,
    obitos: a.obitos,
    transferenciasExternas: a.transferencias,
    pacienteDia: a.pacienteDia,
    leitoDia,
    taxaOcupacao: ocupacao,
    mediaPermanencia: razao(a.pacienteDia, a.saidas),
    giroLeito: razao(a.saidas, leitos),
    intervaloSubstituicao:
      a.saidas > 0 && leitoDia > 0 ? r2(Math.max(0, leitoDia - a.pacienteDia) / a.saidas) : null,
    taxaMortalidade: razao(a.obitos, a.saidas, 100),
    saidasComPrevisao: a.comPrevisao,
    saidasNoPrazo: a.noPrazo,
    pontualidadeAlta: razao(a.noPrazo, a.comPrevisao, 100),
    valorProduzido: r2(a.valor),
    diasSemFaixa: a.semFaixa,
  };
}

/**
 * Apuração do mês: movimento, paciente-dia, indicadores e valor por categoria clínica e o total. `ate` limita o
 * último dia contado (mês corrente: ontem); `ate` antes do início do mês é recusado por quem chama.
 */
export function apurarProducaoMensal(e: {
  readonly mes: string;
  readonly ate?: string;
  readonly leitos: readonly LeitosClinica[];
  readonly internacoes: readonly InternacaoProducao[];
  readonly faixas: readonly FaixaValorCategoria[];
}): ProducaoMensal {
  const { de, ate: fimMes } = limitesDoMes(e.mes);
  const ate = e.ate && e.ate < fimMes ? e.ate : fimMes;
  const dias = ate >= de ? diaNum(ate) - diaNum(de) + 1 : 0;
  const por = new Map<number | null, Acumulado>();
  const acc = (c: number | null): Acumulado => {
    const a = por.get(c) ?? zero();
    por.set(c, a);
    return a;
  };
  for (const c of e.leitos) acc(c.clinicaId);
  const noMes = (iso: string | null): boolean => iso !== null && dataDe(iso) >= de && dataDe(iso) <= ate;
  for (const i of e.internacoes) {
    const ps = periodosDa(i);
    if (noMes(i.entrada)) acc(ps[0]?.clinicaId ?? null).entradas++;
    if (noMes(i.saida)) {
      const a = acc(ps[ps.length - 1]?.clinicaId ?? null);
      a.saidas++;
      if (i.tipoSaida === 'obito') a.obitos++;
      if (i.tipoSaida === 'transferencia') a.transferencias++;
      if (i.previstaAlta) {
        a.comPrevisao++;
        if (dataDe(i.saida as string) <= i.previstaAlta) a.noPrazo++;
      }
    }
    for (const p of ps) {
      const v = valorDoPeriodo(p, e.faixas, ate, de, ps.length === 1);
      const a = acc(p.clinicaId);
      a.pacienteDia += v.diarias;
      a.valor += v.valor;
      a.semFaixa += v.diasSemFaixa;
    }
  }
  const leitosDe = (c: number | null): number => e.leitos.find((l) => l.clinicaId === c)?.leitos ?? 0;
  const total = zero();
  const porClinica = [...por.entries()]
    .sort(([a], [b]) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER))
    .map(([clinicaId, a]) => {
      (Object.keys(total) as (keyof Acumulado)[]).forEach((k) => (total[k] += a[k]));
      return { clinicaId, ...indicadores(a, leitosDe(clinicaId), dias) };
    });
  const leitosTotal = e.leitos.reduce((s, l) => s + l.leitos, 0);
  return { mes: e.mes, de, ate, dias, total: indicadores(total, leitosTotal, dias), porClinica };
}
