// Regra 7 do M33: retenções do RPA. INSS do contribuinte individual com teto do salário de contribuição e acúmulo
// entre as empresas que somam impostos (RPEMPCALCIMP); IRRF pela tabela progressiva vigente sobre o bruto menos o
// INSS; ISS do município sobre o bruto. As alíquotas e tabelas vêm dos parâmetros (nunca constante no código); sem
// elas, o RPA não é emitido. Líquido = bruto − INSS − IRRF − ISS, com as parcelas devolvidas.
import { aplicarPercentual, centavos } from './dinheiro.js';

export interface FaixaIrrf {
  /** Limite superior da faixa em centavos; null: sem limite (última faixa). */
  readonly ateCentavos: number | null;
  readonly aliquota: number;
  readonly deducaoCentavos: number;
}

export type Leitura<T> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly motivo: string };

/** Lê repasse.irrfTabela ("até:alíquota:dedução;…", a última com até 0). */
export function lerTabelaIrrf(texto: string): Leitura<FaixaIrrf[]> {
  if (!texto.trim()) return { ok: false, motivo: 'Tabela do IRRF vigente não definida.' };
  const faixas: FaixaIrrf[] = [];
  for (const parte of texto.split(';')) {
    const [ate, aliq, ded] = parte.split(':').map(Number);
    if ([ate, aliq, ded].some((n) => n === undefined || !Number.isFinite(n) || n < 0))
      return { ok: false, motivo: `Faixa do IRRF inválida: ${parte}` };
    faixas.push({
      ateCentavos: ate === 0 ? null : centavos(ate!),
      aliquota: aliq!,
      deducaoCentavos: centavos(ded!),
    });
  }
  for (let i = 0; i < faixas.length; i++) {
    const f = faixas[i]!;
    const ultima = i === faixas.length - 1;
    if ((f.ateCentavos === null) !== ultima)
      return { ok: false, motivo: 'Só a última faixa do IRRF fica sem limite.' };
    if (i > 0 && f.ateCentavos !== null && f.ateCentavos <= faixas[i - 1]!.ateCentavos!)
      return { ok: false, motivo: 'As faixas do IRRF vão em ordem crescente.' };
  }
  return { ok: true, valor: faixas };
}

/** Lê um percentual de parâmetro de texto ("11", "5.5"); vazio: não definido. */
export function lerAliquota(texto: string, nome: string): Leitura<number> {
  const n = Number(texto.trim());
  if (!texto.trim() || !Number.isFinite(n) || n < 0 || n > 100)
    return { ok: false, motivo: `${nome} vigente não definida.` };
  return { ok: true, valor: n };
}

export interface ParametrosRpa {
  readonly inssAliquota: number;
  readonly inssTetoCentavos: number;
  readonly irrf: readonly FaixaIrrf[];
  readonly issAliquota: number;
  /** Prestador com ISS retido pelo município (regra do evento; padrão: sim). */
  readonly reterIss: boolean;
  readonly reterInss: boolean;
  readonly reterIrrf: boolean;
}

export interface CalculoRpa {
  readonly brutoCentavos: number;
  /** Base do INSS depois do teto e do acúmulo. */
  readonly baseInssCentavos: number;
  readonly inssCentavos: number;
  readonly baseIrrfCentavos: number;
  readonly faixaIrrf: number | null;
  readonly irrfCentavos: number;
  readonly issCentavos: number;
  readonly liquidoCentavos: number;
}

export function calcularRpa(
  entrada: {
    readonly brutoCentavos: number;
    /** Base de INSS já usada no mês nas outras empresas que somam impostos (RPEMPCALCIMP). */
    readonly baseInssOutrasEmpresasCentavos: number;
  },
  p: ParametrosRpa,
): CalculoRpa {
  const bruto = entrada.brutoCentavos;
  const disponivel = Math.max(0, p.inssTetoCentavos - entrada.baseInssOutrasEmpresasCentavos);
  const baseInss = p.reterInss ? Math.min(bruto, disponivel) : 0;
  const inss = aplicarPercentual(baseInss, p.inssAliquota);
  const baseIrrf = Math.max(0, bruto - inss);
  let faixa: number | null = null;
  let irrf = 0;
  if (p.reterIrrf) {
    if (p.irrf.length === 0) throw new RangeError('Tabela do IRRF vazia.');
    const i = p.irrf.findIndex((f) => f.ateCentavos === null || baseIrrf <= f.ateCentavos);
    faixa = i;
    const f = p.irrf[i]!;
    irrf = Math.max(0, aplicarPercentual(baseIrrf, f.aliquota) - f.deducaoCentavos);
  }
  const iss = p.reterIss ? aplicarPercentual(bruto, p.issAliquota) : 0;
  return {
    brutoCentavos: bruto,
    baseInssCentavos: baseInss,
    inssCentavos: inss,
    baseIrrfCentavos: baseIrrf,
    faixaIrrf: faixa,
    irrfCentavos: irrf,
    issCentavos: iss,
    liquidoCentavos: bruto - inss - irrf - iss,
  };
}
