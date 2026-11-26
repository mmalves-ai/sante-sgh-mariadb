// F7, 07-FIN linha 115 (C3-023): o LALUR e o LACS do lucro real (e-LALUR e e-LACS da ECF) e a apuração e a provisão
// do IRPJ e da CSLL. Regras puras, valores em centavos:
//   parte A: adições e exclusões do período sobre o lucro antes dos tributos, por tributo (IRPJ, CSLL ou os dois);
//   compensação do prejuízo fiscal (IRPJ) e da base negativa (CSLL) limitada a 30% do lucro ajustado (Lei 9.065/1995,
//   arts. 15 e 16), tirada do saldo da conta da parte B;
//   parte B: contas com saldo controlado entre exercícios (prejuízo, base negativa, diferenças temporárias), cada
//   lançamento constitui ou baixa o saldo na natureza da conta, e a baixa não passa do saldo;
//   IRPJ 15% sobre a base, adicional de 10% sobre o que passa do limite mensal vezes os meses do período (Lei
//   9.249/1995, art. 3º), CSLL na alíquota configurada (9% em geral); deduções (incentivos, retenções e estimativas
//   pagas) não deixam o valor a recolher negativo (IN RFB 1.700/2017);
//   o ciclo da apuração: aberta e apurada aceitam ajustes e nova apuração; a provisão (lançamento contábil) só na
//   apurada; o fechamento na provisionada, ou na apurada sem tributo a recolher;
//   os registros do bloco M da ECF (M010, M300, M350, M410, M500) saem das linhas gravadas.
// Os imunes e isentos continuam pelas formas 8 e 9 da ECF (sped.ts).
import type { PartidaGerada } from '@sgh/contratos';

export const FORMAS_APURACAO_LUCRO_REAL = ['trimestral', 'anual', 'estimativa_mensal'] as const;
export type FormaApuracaoLucroReal = (typeof FORMAS_APURACAO_LUCRO_REAL)[number];
export const TIPOS_AJUSTE_LALUR = ['adicao', 'exclusao'] as const;
export type TipoAjusteLalur = (typeof TIPOS_AJUSTE_LALUR)[number] | 'compensacao_prejuizo';
export const SITUACOES_APURACAO_LUCRO_REAL = [
  'aberta',
  'apurada',
  'provisionada',
  'fechada',
  'retificada',
] as const;
export type SituacaoApuracaoLucroReal = (typeof SITUACOES_APURACAO_LUCRO_REAL)[number];
export type TributoParteB = 'irpj' | 'csll' | 'ambos';
export type NaturezaSaldoParteB = 'devedor' | 'credor';
export type EfeitoParteB = 'constitui' | 'baixa';
export type AcaoApuracaoLucroReal = 'ajustar' | 'apurar' | 'provisionar' | 'estornar' | 'fechar';

export interface RecusaLalur {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos: readonly string[];
}
const recusa = (codigo: string, mensagem: string, campos: string[] = []): RecusaLalur => ({
  codigo,
  mensagem,
  campos,
});

const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ultimoDiaDoMes = (ano: number, mes: number): string =>
  new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);

/** Quantos meses o período cobre (o primeiro ao último dia de meses inteiros). */
export function mesesDoPeriodo(inicio: string, fim: string): number {
  const [ai, mi] = inicio.split('-').map(Number) as [number, number];
  const [af, mf] = fim.split('-').map(Number) as [number, number];
  return (af - ai) * 12 + (mf - mi) + 1;
}

/** O período da forma de apuração: trimestre civil, ano civil ou um mês, do primeiro ao último dia. */
export function conferirPeriodoApuracao(forma: string, inicio: string, fim: string): RecusaLalur | null {
  if (!(FORMAS_APURACAO_LUCRO_REAL as readonly string[]).includes(forma))
    return recusa('forma-invalida', 'Forma de apuração desconhecida.', ['forma']);
  if (!DATA.test(inicio) || !DATA.test(fim))
    return recusa('periodo-invalido', 'Informe o início e o fim do período (AAAA-MM-DD).', ['inicio', 'fim']);
  const [a, m, d] = inicio.split('-').map(Number) as [number, number, number];
  const meses = forma === 'anual' ? 12 : forma === 'trimestral' ? 3 : 1;
  if (d !== 1) return recusa('periodo-invalido', 'O período começa no primeiro dia do mês.', ['inicio']);
  if (forma === 'anual' && m !== 1)
    return recusa('periodo-invalido', 'A apuração anual vai de janeiro a dezembro.', ['inicio']);
  if (forma === 'trimestral' && (m - 1) % 3 !== 0)
    return recusa('periodo-invalido', 'O trimestre é o civil: começa em janeiro, abril, julho ou outubro.', [
      'inicio',
    ]);
  const mesFim = m + meses - 1;
  if (fim !== ultimoDiaDoMes(a, mesFim))
    return recusa(
      'periodo-invalido',
      `O período ${forma === 'estimativa_mensal' ? 'mensal' : forma} termina em ${ultimoDiaDoMes(a, mesFim)}.`,
      ['fim'],
    );
  return null;
}

/** O que cada situação permite. */
export function conferirAcaoApuracao(
  situacao: SituacaoApuracaoLucroReal,
  acao: AcaoApuracaoLucroReal,
  aRecolherCentavos = 0,
): RecusaLalur | null {
  if (acao === 'ajustar' || acao === 'apurar')
    return situacao === 'aberta' || situacao === 'apurada'
      ? null
      : recusa(
          'apuracao-travada',
          'A apuração já foi provisionada ou fechada: estorne a provisão para mudar os ajustes.',
          ['apuracao'],
        );
  if (acao === 'provisionar')
    return situacao === 'apurada'
      ? null
      : recusa('apuracao-nao-apurada', 'Só a apuração calculada (apurada) é provisionada.', ['apuracao']);
  if (acao === 'estornar')
    return situacao === 'provisionada'
      ? null
      : recusa(
          'apuracao-nao-provisionada',
          'Só a apuração provisionada (e ainda não fechada) tem a provisão estornada.',
          ['apuracao'],
        );
  if (situacao === 'provisionada' || (situacao === 'apurada' && aRecolherCentavos === 0)) return null;
  return recusa(
    'apuracao-sem-provisao',
    'Feche a apuração depois da provisão (ou apurada, quando não há tributo a recolher).',
    ['apuracao'],
  );
}

export interface AjusteLalurEntrada {
  readonly tipo: string;
  readonly descricao: string;
  readonly data: string;
  readonly valorCentavos: number;
  readonly irpj: boolean;
  readonly csll: boolean;
  readonly indicadorProcesso: 'judicial' | 'administrativo' | null;
  readonly numeroProcesso: string | null;
  readonly parteB: { readonly conta: number; readonly efeito: EfeitoParteB } | null;
}

/** O ajuste manual da parte A: adição ou exclusão, no período, com valor, tributo e o processo quando informado. */
export function conferirAjusteLalur(
  a: AjusteLalurEntrada,
  periodo: { readonly inicio: string; readonly fim: string },
): RecusaLalur | null {
  if (!(TIPOS_AJUSTE_LALUR as readonly string[]).includes(a.tipo))
    return recusa(
      'tipo-invalido',
      'O ajuste manual é adição ou exclusão; a compensação de prejuízo sai da apuração.',
      ['tipo'],
    );
  if (!a.descricao.trim()) return recusa('descricao-obrigatoria', 'Descreva o ajuste.', ['descricao']);
  if (!Number.isInteger(a.valorCentavos) || a.valorCentavos <= 0)
    return recusa('valor-invalido', 'O valor do ajuste é maior que zero.', ['valor']);
  if (!a.irpj && !a.csll)
    return recusa('sem-tributo', 'O ajuste vale para o IRPJ, para a CSLL ou para os dois.', ['irpj', 'csll']);
  if (!DATA.test(a.data) || a.data < periodo.inicio || a.data > periodo.fim)
    return recusa('data-fora-do-periodo', 'A data do ajuste fica dentro do período da apuração.', ['data']);
  if (a.indicadorProcesso && !a.numeroProcesso?.trim())
    return recusa('processo-sem-numero', 'Informe o número do processo judicial ou administrativo.', [
      'numeroProcesso',
    ]);
  return null;
}

export interface ContaParteB {
  readonly id: number;
  readonly codigo: string;
  readonly tributo: TributoParteB;
  readonly natureza: NaturezaSaldoParteB;
  /** O saldo atual (centavos, na natureza da conta, nunca negativo). */
  readonly saldoCentavos: number;
}

/** O lado do lançamento da parte B: constituir aumenta o saldo na natureza da conta; baixar diminui. */
export function ladoParteB(natureza: NaturezaSaldoParteB, efeito: EfeitoParteB): 'debito' | 'credito' {
  const aumenta = natureza === 'devedor' ? 'debito' : 'credito';
  const diminui = natureza === 'devedor' ? 'credito' : 'debito';
  return efeito === 'constitui' ? aumenta : diminui;
}

/** O lançamento na conta da parte B: tributo compatível e baixa sem passar do saldo. */
export function conferirLancamentoParteB(
  conta: ContaParteB,
  efeito: EfeitoParteB,
  valorCentavos: number,
  tributos: { readonly irpj: boolean; readonly csll: boolean },
): RecusaLalur | null {
  if (conta.tributo === 'irpj' && tributos.csll && !tributos.irpj)
    return recusa('tributo-da-conta', `A conta ${conta.codigo} da parte B controla só o IRPJ.`, ['parteB']);
  if (conta.tributo === 'csll' && tributos.irpj && !tributos.csll)
    return recusa('tributo-da-conta', `A conta ${conta.codigo} da parte B controla só a CSLL.`, ['parteB']);
  if (efeito === 'baixa' && valorCentavos > conta.saldoCentavos)
    return recusa(
      'baixa-acima-do-saldo',
      `A baixa passa do saldo da conta ${conta.codigo} da parte B (${conta.saldoCentavos / 100}).`,
      ['valor'],
    );
  return null;
}

/** O saldo da conta da parte B depois dos lançamentos (na natureza da conta). */
export function saldoParteB(
  natureza: NaturezaSaldoParteB,
  inicialCentavos: number,
  lancamentos: readonly { readonly natureza: 'debito' | 'credito'; readonly valorCentavos: number }[],
): number {
  const sinal = (n: 'debito' | 'credito') => (ladoParteB(natureza, 'constitui') === n ? 1 : -1);
  return lancamentos.reduce((s, l) => s + sinal(l.natureza) * l.valorCentavos, inicialCentavos);
}

export interface EntradaLucroReal {
  readonly forma: FormaApuracaoLucroReal;
  readonly inicio: string;
  readonly fim: string;
  /** O lucro (ou prejuízo, negativo) antes do IRPJ e da CSLL, da contabilidade. */
  readonly lucroAntesCentavos: number;
  readonly ajustes: readonly {
    readonly tipo: 'adicao' | 'exclusao';
    readonly valorCentavos: number;
    readonly irpj: boolean;
    readonly csll: boolean;
  }[];
  /** Saldo do prejuízo fiscal a compensar (parte B do IRPJ); null sem conta escolhida. */
  readonly saldoPrejuizoCentavos: number | null;
  /** Saldo da base negativa a compensar (parte B da CSLL); null sem conta escolhida. */
  readonly saldoBaseNegativaCentavos: number | null;
  readonly aliquotaIrpj: number;
  readonly aliquotaAdicional: number;
  readonly limiteAdicionalMensalCentavos: number;
  readonly aliquotaCsll: number;
  readonly deducoesIrpjCentavos: number;
  readonly deducoesCsllCentavos: number;
}

export interface ResultadoLucroReal {
  readonly meses: number;
  readonly adicoesIrpj: number;
  readonly exclusoesIrpj: number;
  readonly adicoesCsll: number;
  readonly exclusoesCsll: number;
  /** Lucro real antes da compensação (IRPJ) e resultado ajustado (CSLL). */
  readonly ajustadoIrpj: number;
  readonly ajustadoCsll: number;
  readonly compensacaoPrejuizo: number;
  readonly compensacaoBaseNegativa: number;
  /** Prejuízo fiscal e base negativa do período (a constituir na parte B no fechamento). */
  readonly prejuizoDoPeriodo: number;
  readonly baseNegativaDoPeriodo: number;
  readonly baseIrpj: number;
  readonly baseCsll: number;
  readonly limiteAdicional: number;
  readonly irpj: number;
  readonly adicional: number;
  readonly csll: number;
  readonly irpjRecolher: number;
  readonly csllRecolher: number;
  /** A conta impressa com as parcelas, linha a linha. */
  readonly memoria: readonly string[];
}

const LIMITE_COMPENSACAO = 0.3;
const pct = (base: number, aliquota: number): number => Math.round((base * aliquota) / 100);
const r$ = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A apuração do lucro real e da base da CSLL, com a compensação limitada a 30% e o adicional do IRPJ. */
export function apurarLucroReal(e: EntradaLucroReal): ResultadoLucroReal {
  const meses = mesesDoPeriodo(e.inicio, e.fim);
  const soma = (tipo: 'adicao' | 'exclusao', tributo: 'irpj' | 'csll') =>
    e.ajustes.filter((a) => a.tipo === tipo && a[tributo]).reduce((s, a) => s + a.valorCentavos, 0);
  const adicoesIrpj = soma('adicao', 'irpj');
  const exclusoesIrpj = soma('exclusao', 'irpj');
  const adicoesCsll = soma('adicao', 'csll');
  const exclusoesCsll = soma('exclusao', 'csll');
  const ajustadoIrpj = e.lucroAntesCentavos + adicoesIrpj - exclusoesIrpj;
  const ajustadoCsll = e.lucroAntesCentavos + adicoesCsll - exclusoesCsll;
  const compensar = (ajustado: number, saldo: number | null) =>
    ajustado > 0 && saldo ? Math.min(Math.floor(ajustado * LIMITE_COMPENSACAO), saldo) : 0;
  const compensacaoPrejuizo = compensar(ajustadoIrpj, e.saldoPrejuizoCentavos);
  const compensacaoBaseNegativa = compensar(ajustadoCsll, e.saldoBaseNegativaCentavos);
  const baseIrpj = Math.max(0, ajustadoIrpj - compensacaoPrejuizo);
  const baseCsll = Math.max(0, ajustadoCsll - compensacaoBaseNegativa);
  const limiteAdicional = e.limiteAdicionalMensalCentavos * meses;
  const irpj = pct(baseIrpj, e.aliquotaIrpj);
  const adicional = pct(Math.max(0, baseIrpj - limiteAdicional), e.aliquotaAdicional);
  const csll = pct(baseCsll, e.aliquotaCsll);
  const irpjRecolher = Math.max(0, irpj + adicional - e.deducoesIrpjCentavos);
  const csllRecolher = Math.max(0, csll - e.deducoesCsllCentavos);
  const memoria = [
    `Lucro real antes da compensação = ${r$(e.lucroAntesCentavos)} + adições ${r$(adicoesIrpj)} − exclusões ${r$(exclusoesIrpj)} = ${r$(ajustadoIrpj)}`,
    `Compensação do prejuízo fiscal = menor entre 30% de ${r$(Math.max(0, ajustadoIrpj))} e o saldo ${r$(e.saldoPrejuizoCentavos ?? 0)} = ${r$(compensacaoPrejuizo)}`,
    `Base do IRPJ = ${r$(Math.max(0, ajustadoIrpj))} − ${r$(compensacaoPrejuizo)} = ${r$(baseIrpj)}`,
    `IRPJ = ${r$(baseIrpj)} × ${e.aliquotaIrpj}% = ${r$(irpj)}`,
    `Adicional = (${r$(baseIrpj)} − limite ${r$(e.limiteAdicionalMensalCentavos)} × ${meses} mês(es)) × ${e.aliquotaAdicional}% = ${r$(adicional)}`,
    `IRPJ a recolher = ${r$(irpj)} + ${r$(adicional)} − deduções ${r$(e.deducoesIrpjCentavos)} = ${r$(irpjRecolher)}`,
    `Base da CSLL = ${r$(e.lucroAntesCentavos)} + ${r$(adicoesCsll)} − ${r$(exclusoesCsll)} − base negativa compensada ${r$(compensacaoBaseNegativa)} = ${r$(baseCsll)}`,
    `CSLL a recolher = ${r$(baseCsll)} × ${e.aliquotaCsll}% − deduções ${r$(e.deducoesCsllCentavos)} = ${r$(csllRecolher)}`,
  ];
  return {
    meses,
    adicoesIrpj,
    exclusoesIrpj,
    adicoesCsll,
    exclusoesCsll,
    ajustadoIrpj,
    ajustadoCsll,
    compensacaoPrejuizo,
    compensacaoBaseNegativa,
    prejuizoDoPeriodo: Math.max(0, -ajustadoIrpj),
    baseNegativaDoPeriodo: Math.max(0, -ajustadoCsll),
    baseIrpj,
    baseCsll,
    limiteAdicional,
    irpj,
    adicional,
    csll,
    irpjRecolher,
    csllRecolher,
    memoria,
  };
}

/**
 * O estorno da provisão: as mesmas partidas com os lados trocados. A apuração volta a apurada e os ajustes se
 * reabrem (prática do mercado: a provisão errada se estorna e se refaz; o lançamento original nunca se apaga).
 */
export function partidasEstornoProvisao(provisao: readonly PartidaGerada[]): PartidaGerada[] {
  return provisao.map((x) => ({
    ...x,
    lado: (x.lado === 'D' ? 'C' : 'D') as PartidaGerada['lado'],
    historico: `Estorno da ${x.historico.charAt(0).toLowerCase()}${x.historico.slice(1)}`,
  }));
}

export interface ContasProvisao {
  readonly irpjDebito: string;
  readonly irpjCredito: string;
  readonly csllDebito: string;
  readonly csllCredito: string;
}

/** As partidas da provisão: despesa de IRPJ e de CSLL contra o tributo a recolher (as de valor zero não entram). */
export function partidasProvisaoIrpjCsll(
  contas: ContasProvisao,
  valores: { readonly irpjCentavos: number; readonly csllCentavos: number },
  rotulo: string,
): PartidaGerada[] {
  const p: PartidaGerada[] = [];
  const par = (d: string, c: string, v: number, h: string) => {
    if (v <= 0) return;
    p.push({ lado: 'D', conta: d, valorCentavos: v, historico: h, centroCusto: null });
    p.push({ lado: 'C', conta: c, valorCentavos: v, historico: h, centroCusto: null });
  };
  par(contas.irpjDebito, contas.irpjCredito, valores.irpjCentavos, `Provisão do IRPJ ${rotulo}`);
  par(contas.csllDebito, contas.csllCredito, valores.csllCentavos, `Provisão da CSLL ${rotulo}`);
  return p;
}

export interface LinhaParteAEcf {
  readonly codigo: string | null;
  readonly descricao: string;
  readonly tipo: TipoAjusteLalur;
  readonly valorCentavos: number;
  readonly irpj: boolean;
  readonly csll: boolean;
  readonly contaParteB: string | null;
  readonly processo: string | null;
}
export interface ContaParteBEcf {
  readonly codigo: string;
  readonly descricao: string;
  readonly dataInicial: string;
  readonly tributo: TributoParteB;
  readonly natureza: NaturezaSaldoParteB;
  readonly saldoInicioCentavos: number;
  readonly movimentos: readonly {
    readonly natureza: 'debito' | 'credito';
    readonly valorCentavos: number;
    readonly historico: string;
    readonly daParteA: boolean;
  }[];
}

const v$ = (c: number): string => (Math.abs(c) / 100).toFixed(2).replace('.', ',');
const ddmmaaaa = (d: string): string => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`;
const linha = (campos: readonly (string | null)[]): string =>
  `|${campos.map((c) => (c ?? '').replace(/\|/g, ' ')).join('|')}|`;
const TIPO_M300: Record<TipoAjusteLalur, string> = { adicao: 'A', exclusao: 'E', compensacao_prejuizo: 'P' };

/**
 * Os registros do bloco M da ECF (e-LALUR e e-LACS): M010 (contas da parte B), M300 (IRPJ) e M350 (CSLL) com os
 * lançamentos da parte A, M410 (lançamentos só na parte B) e M500 (saldos da parte B). O código da tabela dinâmica
 * de cada ajuste é o informado no ajuste; sem ele, a linha leva o aviso.
 */
export function registrosBlocoMEcf(
  ajustes: readonly LinhaParteAEcf[],
  contas: readonly ContaParteBEcf[],
): { linhas: string[]; avisos: string[] } {
  const linhas: string[] = [];
  const avisos: string[] = [];
  for (const c of contas)
    for (const t of c.tributo === 'ambos' ? (['I', 'C'] as const) : [c.tributo === 'irpj' ? 'I' : 'C'])
      linhas.push(
        linha([
          'M010',
          c.codigo,
          c.descricao,
          ddmmaaaa(c.dataInicial),
          '',
          '',
          t,
          v$(c.saldoInicioCentavos),
          c.natureza === 'devedor' ? 'D' : 'C',
        ]),
      );
  for (const [reg, tributo] of [
    ['M300', 'irpj'],
    ['M350', 'csll'],
  ] as const)
    for (const a of ajustes.filter((x) => x[tributo])) {
      if (!a.codigo) avisos.push(`${reg}: "${a.descricao}" sem o código da tabela dinâmica.`);
      linhas.push(
        linha([
          reg,
          a.codigo,
          a.descricao,
          TIPO_M300[a.tipo],
          a.contaParteB ? '2' : '1',
          v$(a.valorCentavos),
          a.processo ? `${a.descricao} (processo ${a.processo})` : a.descricao,
        ]),
      );
    }
  for (const c of contas) {
    const t = c.tributo === 'csll' ? 'C' : 'I';
    for (const m of c.movimentos.filter((x) => !x.daParteA))
      linhas.push(
        linha([
          'M410',
          c.codigo,
          t,
          v$(m.valorCentavos),
          m.natureza === 'debito' ? 'DB' : 'CR',
          '',
          m.historico,
          'N',
        ]),
      );
    const parteA = c.movimentos.filter((x) => x.daParteA);
    const parteB = c.movimentos.filter((x) => !x.daParteA);
    const liquido = (ms: typeof parteA) => saldoParteB(c.natureza, 0, ms);
    const fim = saldoParteB(c.natureza, c.saldoInicioCentavos, c.movimentos);
    const ind = (v: number) => (v >= 0 === (c.natureza === 'devedor') ? 'D' : 'C');
    linhas.push(
      linha([
        'M500',
        c.codigo,
        t,
        v$(c.saldoInicioCentavos),
        c.natureza === 'devedor' ? 'D' : 'C',
        v$(liquido(parteA)),
        ind(liquido(parteA)),
        v$(liquido(parteB)),
        ind(liquido(parteB)),
        v$(fim),
        ind(fim),
      ]),
    );
  }
  return { linhas, avisos };
}
