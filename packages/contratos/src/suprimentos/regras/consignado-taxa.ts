// Taxa de comercialização do consignado por faixa de valor (05-SUP linha 24; prática de mercado do OPME consignado):
// sobre o valor do material consignado consumido, o hospital cobra um percentual que depende da faixa de valor em que o
// material cai (quanto mais caro, menor o percentual), com um teto opcional por faixa. A tabela é do fornecedor ou geral
// (vale para todos os fornecedores) e tem vigência: a tabela nova nunca apaga a anterior, só fecha a vigência dela na
// véspera do início da nova (o histórico da cobrança fica íntegro).
// Faixa semiaberta: vale para o valor de `valorInicial` (inclusive) até `valorFinal` (exclusive); a última pode não ter
// fim. As faixas de uma tabela começam em zero, são contíguas (o fim de uma é o começo da seguinte) e não se cruzam.
// Funções puras: a gravação confere de novo na transação.
import { recusa, reais, type RecusaSuprimentos } from './recusa.js';

/** Uma faixa como vem do pedido (a tela manda as faixas da tabela nova de uma vez). */
export interface FaixaTaxaConsignacaoEntrada {
  readonly valorInicial: number;
  readonly valorFinal: number | null;
  /** Percentual sobre o valor do material (0 a 1000). */
  readonly percentual: number;
  /** Teto da taxa em reais (nulo: sem teto). */
  readonly teto: number | null;
}

/** Uma faixa gravada, com a vigência e o escopo (fornecedor ou geral). */
export interface FaixaTaxaConsignacao extends FaixaTaxaConsignacaoEntrada {
  readonly id: number;
  /** Nulo: tabela geral, vale para todos os fornecedores. */
  readonly fornecedor: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface TabelaTaxaConsignacaoEntrada {
  readonly fornecedor: number | null;
  readonly inicio: string;
  readonly faixas: readonly FaixaTaxaConsignacaoEntrada[];
}

export const PERCENTUAL_MAXIMO_TAXA_CONSIGNACAO = 1000;
export const FAIXAS_MAXIMAS_TAXA_CONSIGNACAO = 30;

/** A véspera de uma data ISO (AAAA-MM-DD). */
export function vesperaIso(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Confere a tabela nova: ao menos uma faixa e no máximo 30; a primeira começa em zero; cada faixa termina depois de
 * começar; as faixas são contíguas (o fim de uma é o começo da próxima) e só a última pode ficar sem fim; percentual de
 * 0 a 1000 e teto positivo; o início da vigência não fica no passado (a cobrança já feita não muda).
 */
export function conferirTabelaTaxaConsignacao(
  t: TabelaTaxaConsignacaoEntrada,
  hoje: string,
): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.inicio))
    rs.push(recusa('inicio-invalido', 'Informe o início da vigência.', ['inicio']));
  else if (t.inicio < hoje)
    rs.push(
      recusa('inicio-no-passado', 'A tabela nova começa hoje ou depois: a taxa já cobrada não muda.', [
        'inicio',
      ]),
    );
  if (t.faixas.length === 0) {
    rs.push(recusa('sem-faixas', 'Informe ao menos uma faixa de valor.', ['faixas']));
    return rs;
  }
  if (t.faixas.length > FAIXAS_MAXIMAS_TAXA_CONSIGNACAO)
    rs.push(
      recusa('faixas-demais', `A tabela aceita até ${FAIXAS_MAXIMAS_TAXA_CONSIGNACAO} faixas.`, ['faixas']),
    );
  const fs = [...t.faixas].sort((a, b) => a.valorInicial - b.valorInicial);
  if (fs[0]!.valorInicial !== 0)
    rs.push(recusa('faixa-sem-zero', 'A primeira faixa começa em zero.', ['faixas']));
  fs.forEach((f, i) => {
    const n = i + 1;
    if (!(f.valorInicial >= 0))
      rs.push(recusa('faixa-negativa', `A faixa ${n} começa num valor negativo.`, ['faixas']));
    if (f.valorFinal !== null && !(f.valorFinal > f.valorInicial))
      rs.push(recusa('faixa-invertida', `A faixa ${n} tem de terminar depois de começar.`, ['faixas']));
    if (!(f.percentual >= 0 && f.percentual <= PERCENTUAL_MAXIMO_TAXA_CONSIGNACAO))
      rs.push(
        recusa(
          'percentual-invalido',
          `O percentual da faixa ${n} vai de 0 a ${PERCENTUAL_MAXIMO_TAXA_CONSIGNACAO}.`,
          ['faixas'],
        ),
      );
    if (f.teto !== null && !(f.teto > 0))
      rs.push(recusa('teto-invalido', `O teto da faixa ${n} tem de ser positivo.`, ['faixas']));
    const prox = fs[i + 1];
    if (prox) {
      if (f.valorFinal === null)
        rs.push(recusa('faixa-aberta-no-meio', `Só a última faixa pode ficar sem valor final.`, ['faixas']));
      else if (prox.valorInicial !== f.valorFinal)
        rs.push(
          recusa(
            prox.valorInicial < f.valorFinal ? 'faixas-cruzadas' : 'faixas-com-buraco',
            `A faixa ${n + 1} começa onde a faixa ${n} termina.`,
            ['faixas'],
          ),
        );
    }
  });
  return rs;
}

/** As faixas vigentes na data: as do fornecedor, se ele tem tabela vigente; senão, as da tabela geral. */
export function tabelaTaxaVigente(
  faixas: readonly FaixaTaxaConsignacao[],
  fornecedor: number | null,
  data: string,
): readonly FaixaTaxaConsignacao[] {
  const vigentes = faixas.filter((f) => f.inicio <= data && (f.fim === null || f.fim >= data));
  const doFornecedor = fornecedor === null ? [] : vigentes.filter((f) => f.fornecedor === fornecedor);
  const escolhidas = doFornecedor.length ? doFornecedor : vigentes.filter((f) => f.fornecedor === null);
  return [...escolhidas].sort((a, b) => a.valorInicial - b.valorInicial);
}

export interface CalculoTaxaConsignacao {
  readonly valor: number;
  /** A faixa usada; nulo quando não há tabela vigente para o fornecedor nem geral (taxa zero). */
  readonly faixa: FaixaTaxaConsignacao | null;
  readonly origem: 'fornecedor' | 'geral' | 'sem-tabela';
  readonly percentual: number;
  /** A taxa antes do teto (parcela impressa para a conferência). */
  readonly taxaBruta: number;
  readonly teto: number | null;
  readonly taxa: number;
  /** O valor do material com a taxa: valor + taxa. */
  readonly total: number;
}

/** A taxa de comercialização de um material consignado de `valor` reais do fornecedor na data. */
export function calcularTaxaConsignacao(
  faixas: readonly FaixaTaxaConsignacao[],
  fornecedor: number | null,
  valor: number,
  data: string,
): CalculoTaxaConsignacao {
  const v = reais(Math.max(0, valor));
  const tabela = tabelaTaxaVigente(faixas, fornecedor, data);
  const faixa =
    tabela.find((f) => v >= f.valorInicial && (f.valorFinal === null || v < f.valorFinal)) ?? null;
  if (!faixa)
    return {
      valor: v,
      faixa: null,
      origem: 'sem-tabela',
      percentual: 0,
      taxaBruta: 0,
      teto: null,
      taxa: 0,
      total: v,
    };
  const taxaBruta = reais((v * faixa.percentual) / 100);
  const taxa = faixa.teto !== null ? Math.min(taxaBruta, faixa.teto) : taxaBruta;
  return {
    valor: v,
    faixa,
    origem: faixa.fornecedor === null ? 'geral' : 'fornecedor',
    percentual: faixa.percentual,
    taxaBruta,
    teto: faixa.teto,
    taxa,
    total: reais(v + taxa),
  };
}

/**
 * O que a gravação da tabela nova faz com a vigente do mesmo escopo: as faixas que ainda valem no início da nova são
 * fechadas na véspera; a tabela do mesmo escopo que só começaria no mesmo dia ou depois é recusada (não se sobrepõe à
 * agenda futura em silêncio).
 */
export function planejarTabelaTaxaConsignacao(
  nova: TabelaTaxaConsignacaoEntrada,
  doEscopo: readonly FaixaTaxaConsignacao[],
  hoje: string,
): { readonly recusas: RecusaSuprimentos[]; readonly fechar: readonly number[]; readonly fim: string } {
  const recusas = conferirTabelaTaxaConsignacao(nova, hoje);
  const fim = vesperaIso(nova.inicio);
  const mesmo = doEscopo.filter((f) => f.fornecedor === nova.fornecedor);
  if (mesmo.some((f) => f.inicio >= nova.inicio))
    recusas.push(
      recusa('tabela-futura-existente', 'Já existe tabela deste fornecedor começando nesta data ou depois.', [
        'inicio',
      ]),
    );
  const fechar = mesmo.filter((f) => f.fim === null || f.fim >= nova.inicio).map((f) => f.id);
  return { recusas, fechar, fim };
}
