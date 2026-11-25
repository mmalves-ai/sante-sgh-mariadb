// Remuneração variável do profissional (F8, 07-FIN linha 157): o que a apuração do repasse acrescenta ou desconta além
// da produção calculada pelas regras de percentual e valor fixo. Prática de mercado adotada:
//   - mínimo garantido mensal: quando a produção da apuração não alcança o mínimo vigente na competência, entra o
//     complemento (mínimo − produção) como evento próprio; nunca reduz a produção que passou do mínimo;
//   - percentual do resultado: percentual sobre a margem (receita − custo) do centro de custo já apurada pelo custeio
//     (ou do estabelecimento inteiro); margem zero ou negativa não gera valor (o profissional não divide prejuízo);
//   - produtividade por meta: o valor apurado do indicador na competência cai numa faixa; a faixa dá o prêmio
//     (percentual da produção ou valor fixo), multiplicado pelo peso da meta; fora de toda faixa, nada;
//   - custo do prestador: a regra de custo vigente (valor ou percentual da produção, só dentro da faixa de produção
//     quando há faixa) vira desconto na apuração; a de frequência "única" só desconta uma vez.
// Tudo em centavos inteiros (dinheiro.ts). Datas AAAA-MM-DD; competência é sempre o dia 1.
import { aplicarPercentual, centavos } from './dinheiro.js';

export interface Problema {
  readonly campo: string;
  readonly mensagem: string;
}

export interface Vigencia {
  readonly inicio: string;
  readonly fim: string | null;
}

export const FORMAS_PREMIO = ['percentual_producao', 'valor_fixo'] as const;
export type FormaPremio = (typeof FORMAS_PREMIO)[number];

export interface FaixaMeta {
  /** Limite inferior do valor apurado do indicador (inclusive). */
  readonly de: number;
  /** Limite superior (inclusive); nulo: sem teto. */
  readonly ate: number | null;
  /** Percentual da produção (0 a 100) ou valor em reais, conforme a forma do prêmio. */
  readonly premio: number;
}

/** A regra vale em algum dia da competência (mês de `competencia`, dia 1). */
export function vigenteNaCompetencia(v: Vigencia, competencia: string): boolean {
  const fimMes = ultimoDiaDoMes(competencia);
  return v.inicio <= fimMes && (v.fim === null || v.fim >= competencia);
}

export function ultimoDiaDoMes(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${competencia.slice(0, 7)}-${String(d).padStart(2, '0')}`;
}

export function ehCompetencia(d: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-01$/.test(d);
}

function validarVigencia(v: Vigencia): Problema[] {
  return v.fim !== null && v.fim < v.inicio
    ? [{ campo: 'fim', mensagem: 'O fim da vigência é anterior ao início.' }]
    : [];
}

/** Duas vigências se cruzam em algum dia. */
export function vigenciasSeCruzam(a: Vigencia, b: Vigencia): boolean {
  return (a.fim === null || a.fim >= b.inicio) && (b.fim === null || b.fim >= a.inicio);
}

/** Sem duas regras do mesmo alvo vigentes no mesmo dia: o profissional sabe sempre qual vale. */
export function conflitoDeVigencia(nova: Vigencia, existentes: readonly Vigencia[]): Problema[] {
  return existentes.some((e) => vigenciasSeCruzam(nova, e))
    ? [
        {
          campo: 'inicio',
          mensagem: 'Já existe regra vigente neste período para o mesmo profissional; encerre-a antes.',
        },
      ]
    : [];
}

export function validarMinimoGarantido(r: { valorMinimo: number } & Vigencia): Problema[] {
  const p = validarVigencia(r);
  if (!(r.valorMinimo > 0)) p.push({ campo: 'valorMinimo', mensagem: 'Informe o valor mínimo mensal.' });
  return p;
}

export function validarRegraResultado(r: { percentual: number } & Vigencia): Problema[] {
  const p = validarVigencia(r);
  if (!(r.percentual > 0 && r.percentual <= 100))
    p.push({ campo: 'percentual', mensagem: 'O percentual do resultado fica entre 0 (exclusive) e 100.' });
  return p;
}

/** As faixas da meta: ao menos uma, limites em ordem e sem sobreposição; percentual entre 0 e 100. */
export function validarMeta(
  m: { forma: FormaPremio; peso: number; faixas: readonly FaixaMeta[] } & Vigencia,
): Problema[] {
  const p = validarVigencia(m);
  if (!(m.peso > 0 && m.peso <= 100))
    p.push({ campo: 'peso', mensagem: 'O peso da meta fica entre 0 (exclusive) e 100.' });
  if (!m.faixas.length) p.push({ campo: 'faixas', mensagem: 'Informe ao menos uma faixa da meta.' });
  const ord = [...m.faixas].sort((a, b) => a.de - b.de);
  ord.forEach((f, i) => {
    if (f.ate !== null && f.ate < f.de)
      p.push({ campo: `faixas.${i}`, mensagem: `A faixa ${i + 1} termina antes de começar.` });
    if (!(f.premio > 0))
      p.push({ campo: `faixas.${i}`, mensagem: `A faixa ${i + 1} precisa de prêmio maior que zero.` });
    if (m.forma === 'percentual_producao' && f.premio > 100)
      p.push({ campo: `faixas.${i}`, mensagem: `A faixa ${i + 1} passa de 100% da produção.` });
    const ant = ord[i - 1];
    if (ant && (ant.ate === null || ant.ate >= f.de))
      p.push({ campo: `faixas.${i}`, mensagem: `As faixas ${i} e ${i + 1} se sobrepõem.` });
  });
  return p;
}

/** A faixa em que o valor apurado cai, ou nula. */
export function faixaDoValor(faixas: readonly FaixaMeta[], valor: number): FaixaMeta | null {
  return faixas.find((f) => valor >= f.de && (f.ate === null || valor <= f.ate)) ?? null;
}

// ── Cálculo ───────────────────────────────────────────────────────────────────────────────────────────

export interface EntradaRemuneracaoVariavel {
  readonly competencia: string;
  /** Produção do profissional na apuração (soma do repasse calculado), em centavos. */
  readonly producaoCentavos: number;
  readonly minimo: {
    readonly id: number;
    readonly valorMinimo: number;
    readonly evento: number | null;
  } | null;
  readonly resultados: readonly {
    readonly id: number;
    readonly percentual: number;
    readonly evento: number | null;
    readonly centroCusto: number | null;
    /** Margem já apurada (receita − custo) em centavos; nula: o custeio da competência não está apurado. */
    readonly margemCentavos: number | null;
  }[];
  readonly metas: readonly {
    readonly id: number;
    readonly indicador: string;
    readonly forma: FormaPremio;
    readonly peso: number;
    readonly evento: number | null;
    readonly faixas: readonly FaixaMeta[];
    /** Valor apurado do indicador na competência; nulo: não apurado. */
    readonly valorApurado: number | null;
  }[];
  readonly custos: readonly {
    readonly id: number;
    readonly tipoDesconto: number;
    readonly descricao: string | null;
    readonly natureza: 'desconto' | 'acrescimo';
    readonly forma: 'valor' | 'percentual';
    readonly valor: number | null;
    readonly percentual: number | null;
    readonly faixaInicial: number | null;
    readonly faixaFinal: number | null;
    readonly frequencia: 'mensal' | 'por_apuracao' | 'unica';
    /** Já descontada em alguma apuração anterior. */
    readonly jaDescontada: boolean;
  }[];
}

export type TipoItemVariavel = 'complemento_minimo' | 'resultado' | 'produtividade' | 'custo';

export interface ItemVariavel {
  readonly tipo: TipoItemVariavel;
  readonly regra: number;
  readonly evento: number | null;
  /** Tipo do desconto (só no custo). */
  readonly tipoDesconto: number | null;
  /** Crédito (soma ao repasse) ou débito (desconta). */
  readonly sentido: 'credito' | 'debito';
  readonly valorCentavos: number;
  /** A conta mostrada ao usuário (sem dado de pessoa). */
  readonly memoria: string;
  /** Texto do lançamento; também identifica o item para não lançar duas vezes. */
  readonly referente: string;
}

export interface RemuneracaoVariavel {
  readonly itens: readonly ItemVariavel[];
  readonly pendencias: readonly string[];
  readonly creditoCentavos: number;
  readonly debitoCentavos: number;
}

const brl = (c: number) => (c / 100).toFixed(2).replace('.', ',');

/** Calcula os itens da remuneração variável do profissional numa apuração. */
export function calcularRemuneracaoVariavel(e: EntradaRemuneracaoVariavel): RemuneracaoVariavel {
  const itens: ItemVariavel[] = [];
  const pendencias: string[] = [];
  const prod = e.producaoCentavos;
  const comp = e.competencia.slice(0, 7);

  if (e.minimo) {
    const minimo = centavos(e.minimo.valorMinimo);
    const falta = minimo - prod;
    if (falta > 0) {
      if (e.minimo.evento === null)
        pendencias.push('O mínimo garantido não tem evento do complemento: defina o evento na regra.');
      itens.push({
        tipo: 'complemento_minimo',
        regra: e.minimo.id,
        evento: e.minimo.evento,
        tipoDesconto: null,
        sentido: 'credito',
        valorCentavos: falta,
        memoria: `mínimo ${brl(minimo)} − produção ${brl(prod)} = ${brl(falta)}`,
        referente: `Complemento do mínimo garantido ${comp} (regra ${e.minimo.id})`,
      });
    }
  }

  for (const r of e.resultados) {
    if (r.margemCentavos === null) {
      pendencias.push(`O resultado do centro de custo da regra ${r.id} não está apurado na competência.`);
      continue;
    }
    if (r.margemCentavos <= 0) continue;
    const v = aplicarPercentual(r.margemCentavos, r.percentual);
    if (v <= 0) continue;
    if (r.evento === null) pendencias.push(`A regra de resultado ${r.id} não tem evento: defina o evento.`);
    itens.push({
      tipo: 'resultado',
      regra: r.id,
      evento: r.evento,
      tipoDesconto: null,
      sentido: 'credito',
      valorCentavos: v,
      memoria: `${r.percentual}% de margem ${brl(r.margemCentavos)} = ${brl(v)}`,
      referente: `Percentual do resultado ${comp} (regra ${r.id})`,
    });
  }

  for (const m of e.metas) {
    if (m.valorApurado === null) {
      pendencias.push(`O indicador ${m.indicador} não tem valor apurado na competência.`);
      continue;
    }
    const f = faixaDoValor(m.faixas, m.valorApurado);
    if (!f) continue;
    const cheio = m.forma === 'percentual_producao' ? aplicarPercentual(prod, f.premio) : centavos(f.premio);
    const v = aplicarPercentual(cheio, m.peso);
    if (v <= 0) continue;
    if (m.evento === null) pendencias.push(`A meta ${m.id} não tem evento: defina o evento.`);
    itens.push({
      tipo: 'produtividade',
      regra: m.id,
      evento: m.evento,
      tipoDesconto: null,
      sentido: 'credito',
      valorCentavos: v,
      memoria:
        (m.forma === 'percentual_producao'
          ? `${m.indicador} ${m.valorApurado} → ${f.premio}% de ${brl(prod)}`
          : `${m.indicador} ${m.valorApurado} → ${brl(cheio)}`) + ` × peso ${m.peso}% = ${brl(v)}`,
      referente: `Produtividade por meta ${comp} (meta ${m.id})`,
    });
  }

  for (const c of e.custos) {
    if (c.natureza !== 'desconto') continue;
    if (c.frequencia === 'unica' && c.jaDescontada) continue;
    const reaisProd = prod / 100;
    if (c.faixaInicial !== null && reaisProd < c.faixaInicial) continue;
    if (c.faixaFinal !== null && reaisProd > c.faixaFinal) continue;
    const v = c.forma === 'valor' ? centavos(c.valor ?? 0) : aplicarPercentual(prod, c.percentual ?? 0);
    if (v <= 0) continue;
    itens.push({
      tipo: 'custo',
      regra: c.id,
      evento: null,
      tipoDesconto: c.tipoDesconto,
      sentido: 'debito',
      valorCentavos: v,
      memoria:
        c.forma === 'valor'
          ? `valor fixo ${brl(v)}`
          : `${c.percentual}% da produção ${brl(prod)} = ${brl(v)}`,
      referente: `Custo do prestador ${comp} (regra ${c.id})${c.descricao ? `: ${c.descricao}` : ''}`.slice(
        0,
        150,
      ),
    });
  }

  const soma = (s: 'credito' | 'debito') =>
    itens.filter((i) => i.sentido === s).reduce((t, i) => t + i.valorCentavos, 0);
  return { itens, pendencias, creditoCentavos: soma('credito'), debitoCentavos: soma('debito') };
}
