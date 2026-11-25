// Remuneração variável por faixa (F8, 06-FAT linha 48): a regra mede um indicador do profissional ou da equipe no
// período (quantidade de cirurgias, de procedimentos, valor produzido, valor recebido ou o resultado do
// estabelecimento), enquadra a medida numa faixa escalonada e a faixa dá o ajuste. Prática de mercado adotada:
//   - faixas em ordem, sem sobreposição; a última pode ficar sem teto;
//   - a faixa traz percentual sobre a base, valor fixo, ou os dois; o "incremento progressivo" faz o percentual subir
//     em linha reta dentro da faixa: no início vale o percentual, no fim vale percentual + incremento (só em faixa
//     com teto, para a conta ter fim);
//   - a base do percentual é a produção do repasse do beneficiário (bruta, ou líquida dos descontos quando a faixa
//     pede); no indicador "resultado" a base é a margem do estabelecimento, e margem zero ou negativa não gera valor
//     (o profissional não divide prejuízo);
//   - "desconto" é ajuste para menos (o valor sai negativo); o líquido da regra é o que se lança;
//   - período mensal, trimestral, semestral ou anual: a medida soma as competências do período e o ajuste só entra na
//     competência que fecha o período (março, junho, setembro e dezembro no trimestral; junho e dezembro no
//     semestral; dezembro no anual);
//   - equipe: o valor da regra é dividido pelas cotas dos membros vigentes no fim do período; as cotas somam 100%, há
//     no máximo um chefe e a sobra do arredondamento vai ao chefe (ou ao primeiro membro).
// Tudo em centavos inteiros (dinheiro.ts). Datas AAAA-MM-DD; competência é sempre o dia 1.
import { aplicarPercentual, centavos } from './dinheiro.js';
import { type Problema, vigenciasSeCruzam, type Vigencia } from './remuneracao-variavel.js';

export const INDICADORES_VARIAVEL = [
  'quantidade_cirurgias',
  'quantidade_procedimentos',
  'valor_produzido',
  'valor_recebido',
  'resultado',
] as const;
export type IndicadorVariavel = (typeof INDICADORES_VARIAVEL)[number];

export const PERIODOS_VARIAVEL = ['mensal', 'trimestral', 'semestral', 'anual'] as const;
export type PeriodoVariavel = (typeof PERIODOS_VARIAVEL)[number];

export const AJUSTES_FAIXA = ['acrescimo', 'desconto'] as const;
export type AjusteFaixa = (typeof AJUSTES_FAIXA)[number];

const MESES_DO_PERIODO: Record<PeriodoVariavel, number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

/** Indicadores medidos em reais (os demais são contagens). */
export function indicadorEmReais(i: IndicadorVariavel): boolean {
  return i === 'valor_produzido' || i === 'valor_recebido' || i === 'resultado';
}

export interface FaixaVariavel {
  /** Início da faixa (inclusive), na unidade do indicador. */
  readonly de: number;
  /** Fim da faixa (inclusive); nulo: sem teto. */
  readonly ate: number | null;
  readonly ajuste: AjusteFaixa;
  /** Percentual sobre a base (0 a 100). */
  readonly percentual: number | null;
  /** Valor fixo em reais. */
  readonly valorFixo: number | null;
  /** Pontos percentuais somados ao percentual no fim da faixa (crescimento linear dentro dela). */
  readonly incremento: number | null;
  /** A base é a produção líquida dos descontos. */
  readonly sobreLiquido: boolean;
}

export interface RegraVariavelFaixa extends Vigencia {
  readonly codigo: string;
  readonly descricao: string;
  readonly profissional: number | null;
  readonly equipe: number | null;
  readonly indicador: IndicadorVariavel;
  readonly periodo: PeriodoVariavel;
  readonly considerarPacote: boolean;
  readonly percentualPacote: number | null;
  readonly faixas: readonly FaixaVariavel[];
}

function vigencia(v: Vigencia): Problema[] {
  return v.fim !== null && v.fim < v.inicio
    ? [{ campo: 'fim', mensagem: 'O fim da vigência é anterior ao início.' }]
    : [];
}

/** Tudo o que a regra precisa para ser gravada, conferido na hora (a tela mostra cada problema no campo). */
export function validarRegraVariavelFaixa(r: RegraVariavelFaixa): Problema[] {
  const p = vigencia(r);
  if (!r.codigo.trim()) p.push({ campo: 'codigo', mensagem: 'Informe o código da regra.' });
  if (!r.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Descreva a regra.' });
  if ((r.profissional === null) === (r.equipe === null))
    p.push({
      campo: 'beneficiario',
      mensagem: 'A regra vale para um profissional ou para uma equipe, não os dois.',
    });
  if (r.considerarPacote) {
    const pp = r.percentualPacote;
    if (pp === null || !(pp > 0 && pp <= 100))
      p.push({
        campo: 'percentualPacote',
        mensagem: 'Informe quanto do item de pacote conta (de 0, exclusive, a 100%).',
      });
  } else if (r.percentualPacote !== null)
    p.push({
      campo: 'percentualPacote',
      mensagem: 'O percentual do pacote só vale quando o pacote é considerado.',
    });
  if (!r.faixas.length) p.push({ campo: 'faixas', mensagem: 'Informe ao menos uma faixa.' });
  const contagem = !indicadorEmReais(r.indicador);
  const ord = [...r.faixas].sort((a, b) => a.de - b.de);
  ord.forEach((f, i) => {
    const n = i + 1;
    const campo = `faixas.${i}`;
    if (!(f.de >= 0)) p.push({ campo, mensagem: `A faixa ${n} começa abaixo de zero.` });
    if (contagem && (!Number.isInteger(f.de) || (f.ate !== null && !Number.isInteger(f.ate))))
      p.push({ campo, mensagem: `A faixa ${n} conta quantidades: use números inteiros.` });
    if (f.ate !== null && f.ate < f.de) p.push({ campo, mensagem: `A faixa ${n} termina antes de começar.` });
    if (f.percentual === null && f.valorFixo === null && f.incremento === null)
      p.push({ campo, mensagem: `A faixa ${n} precisa de percentual, valor fixo ou incremento.` });
    if (f.percentual !== null && !(f.percentual > 0 && f.percentual <= 100))
      p.push({ campo, mensagem: `O percentual da faixa ${n} fica entre 0 (exclusive) e 100.` });
    if (f.valorFixo !== null && !(f.valorFixo > 0))
      p.push({ campo, mensagem: `O valor fixo da faixa ${n} precisa ser maior que zero.` });
    if (f.incremento !== null) {
      if (!(f.incremento > 0))
        p.push({ campo, mensagem: `O incremento da faixa ${n} precisa ser maior que zero.` });
      if (f.ate === null)
        p.push({ campo, mensagem: `A faixa ${n} sem teto não admite incremento progressivo.` });
      if ((f.percentual ?? 0) + f.incremento > 100)
        p.push({ campo, mensagem: `Na faixa ${n}, percentual mais incremento passa de 100%.` });
    }
    const ant = ord[i - 1];
    if (ant && (ant.ate === null || ant.ate >= f.de))
      p.push({ campo, mensagem: `As faixas ${i} e ${n} se sobrepõem.` });
  });
  return p;
}

/** Duas regras do mesmo beneficiário e indicador não ficam vigentes no mesmo dia. */
export function conflitoRegraVariavel(nova: Vigencia, existentes: readonly Vigencia[]): Problema[] {
  return existentes.some((e) => vigenciasSeCruzam(nova, e))
    ? [
        {
          campo: 'inicio',
          mensagem:
            'Já existe regra vigente neste período para o mesmo beneficiário e indicador; encerre-a antes.',
        },
      ]
    : [];
}

export interface PeriodoApuracao {
  /** Primeira competência do período. */
  readonly inicio: string;
  /** Última competência do período (dia 1). */
  readonly fim: string;
  /** A competência informada fecha o período (só nela o ajuste entra). */
  readonly fecha: boolean;
  readonly competencias: readonly string[];
}

/** O período da regra a que a competência pertence. */
export function periodoDaCompetencia(periodo: PeriodoVariavel, competencia: string): PeriodoApuracao {
  const meses = MESES_DO_PERIODO[periodo];
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const primeiro = Math.floor((mes - 1) / meses) * meses + 1;
  const comp = (m: number) => `${ano}-${String(m).padStart(2, '0')}-01`;
  const competencias = Array.from({ length: meses }, (_, i) => comp(primeiro + i));
  return {
    inicio: competencias[0]!,
    fim: competencias[competencias.length - 1]!,
    fecha: mes === primeiro + meses - 1,
    competencias,
  };
}

/** A faixa em que a medida cai, ou nula. */
export function faixaVariavelDaMedida(
  faixas: readonly FaixaVariavel[],
  medida: number,
): FaixaVariavel | null {
  return faixas.find((f) => medida >= f.de && (f.ate === null || medida <= f.ate)) ?? null;
}

/** Percentual que vale para a medida dentro da faixa (com o incremento progressivo). */
export function percentualEfetivo(f: FaixaVariavel, medida: number): number {
  const base = f.percentual ?? 0;
  if (f.incremento === null || f.ate === null || f.ate <= f.de) return base;
  const fracao = Math.min(1, Math.max(0, (medida - f.de) / (f.ate - f.de)));
  return Math.round((base + f.incremento * fracao) * 10_000) / 10_000;
}

export interface EntradaVariavelFaixa {
  readonly indicador: IndicadorVariavel;
  readonly faixas: readonly FaixaVariavel[];
  /** Valor medido do indicador no período (contagem, ou reais). */
  readonly medida: number;
  /** Produção do repasse do beneficiário no período, em centavos. */
  readonly producaoBrutaCentavos: number;
  /** A mesma produção, líquida dos descontos, em centavos. */
  readonly producaoLiquidaCentavos: number;
  /** Margem do estabelecimento no período (só no indicador "resultado"), em centavos. */
  readonly margemCentavos: number | null;
}

export interface ResultadoVariavelFaixa {
  readonly faixa: FaixaVariavel | null;
  /** Ordem da faixa (1 em diante, pelas faixas ordenadas), ou nula. */
  readonly ordemFaixa: number | null;
  readonly percentual: number;
  readonly baseCentavos: number;
  /** Positivo no acréscimo, negativo no desconto, zero fora de faixa. */
  readonly valorCentavos: number;
  readonly memoria: string;
}

const brl = (c: number) => (c / 100).toFixed(2).replace('.', ',');

/** O ajuste da regra para a medida do período. */
export function calcularVariavelFaixa(e: EntradaVariavelFaixa): ResultadoVariavelFaixa {
  const ord = [...e.faixas].sort((a, b) => a.de - b.de);
  const faixa = faixaVariavelDaMedida(ord, e.medida);
  const medidaTxt = indicadorEmReais(e.indicador) ? `R$ ${brl(centavos(e.medida))}` : String(e.medida);
  if (!faixa)
    return {
      faixa: null,
      ordemFaixa: null,
      percentual: 0,
      baseCentavos: 0,
      valorCentavos: 0,
      memoria: `Medida ${medidaTxt} fora de todas as faixas.`,
    };
  const ordem = ord.indexOf(faixa) + 1;
  const base =
    e.indicador === 'resultado'
      ? Math.max(0, e.margemCentavos ?? 0)
      : Math.max(0, faixa.sobreLiquido ? e.producaoLiquidaCentavos : e.producaoBrutaCentavos);
  const pct = percentualEfetivo(faixa, e.medida);
  const bruto = aplicarPercentual(base, pct) + centavos(faixa.valorFixo ?? 0);
  const valor = faixa.ajuste === 'desconto' ? -bruto : bruto;
  const partes = [
    `Medida ${medidaTxt} na faixa ${ordem}`,
    pct > 0 ? `${String(pct).replace('.', ',')}% de R$ ${brl(base)}` : null,
    faixa.valorFixo ? `fixo R$ ${brl(centavos(faixa.valorFixo))}` : null,
    faixa.ajuste === 'desconto' ? 'desconto' : null,
  ].filter(Boolean);
  return {
    faixa,
    ordemFaixa: ordem,
    percentual: pct,
    baseCentavos: base,
    valorCentavos: valor,
    memoria: `${partes.join('; ')}.`,
  };
}

// ── Equipe ────────────────────────────────────────────────────────────────────────────────────────────

export interface MembroEquipeVariavel extends Vigencia {
  readonly profissional: number | null;
  readonly terceiro: number | null;
  readonly cota: number;
  readonly chefe: boolean;
}

/** Os membros vigentes na data. */
export function membrosVigentes<T extends Vigencia>(membros: readonly T[], data: string): T[] {
  return membros.filter((m) => m.inicio <= data && (m.fim === null || m.fim >= data));
}

/** Um membro novo: profissional ou terceiro (um só), cota de 0 a 100 e vigência em ordem. */
export function validarMembroEquipe(m: MembroEquipeVariavel): Problema[] {
  const p = vigencia(m);
  if ((m.profissional === null) === (m.terceiro === null))
    p.push({ campo: 'membro', mensagem: 'O membro é um profissional ou um prestador terceiro, um só.' });
  if (!(m.cota > 0 && m.cota <= 100))
    p.push({ campo: 'cota', mensagem: 'A cota fica entre 0 (exclusive) e 100%.' });
  return p;
}

/** A composição vigente na data: cotas somam 100%, um chefe no máximo e ninguém repetido. */
export function conferirComposicao(membros: readonly MembroEquipeVariavel[], data: string): Problema[] {
  const vig = membrosVigentes(membros, data);
  const p: Problema[] = [];
  if (!vig.length) return [{ campo: 'membros', mensagem: `A equipe não tem membro vigente em ${data}.` }];
  const soma = Math.round(vig.reduce((s, m) => s + m.cota, 0) * 10_000) / 10_000;
  if (soma !== 100)
    p.push({
      campo: 'membros',
      mensagem: `As cotas vigentes em ${data} somam ${String(soma).replace('.', ',')}%; precisam somar 100%.`,
    });
  if (vig.filter((m) => m.chefe).length > 1)
    p.push({ campo: 'chefe', mensagem: 'A equipe tem mais de um chefe vigente.' });
  const chaves = vig.map((m) => (m.profissional !== null ? `p${m.profissional}` : `t${m.terceiro}`));
  if (new Set(chaves).size !== chaves.length)
    p.push({ campo: 'membro', mensagem: 'O mesmo membro aparece duas vezes na equipe vigente.' });
  return p;
}

export interface ParteRateio<T> {
  readonly membro: T;
  readonly valorCentavos: number;
}

/** Divide o valor (centavos, com sinal) pelas cotas; a sobra do arredondamento vai ao chefe ou ao primeiro. */
export function ratearEquipe<T extends { cota: number; chefe: boolean }>(
  valorCentavos: number,
  membros: readonly T[],
): ParteRateio<T>[] {
  if (!membros.length) return [];
  const sinal = valorCentavos < 0 ? -1 : 1;
  const total = Math.abs(valorCentavos);
  const partes = membros.map((m) => ({ membro: m, valorCentavos: aplicarPercentual(total, m.cota) }));
  const sobra = total - partes.reduce((s, x) => s + x.valorCentavos, 0);
  const alvo = Math.max(
    0,
    partes.findIndex((x) => x.membro.chefe),
  );
  partes[alvo] = { membro: partes[alvo]!.membro, valorCentavos: partes[alvo]!.valorCentavos + sobra };
  return partes.map((x) => ({ membro: x.membro, valorCentavos: sinal * x.valorCentavos }));
}
