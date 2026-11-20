// Rescisão do contrato de trabalho (M53-F4; ficha do M53, seções 1 e 8, regras 7 e 8; CLT arts. 146, 477 a 487, Lei
// 12.506/2011, Lei 4.090/1962, Lei 8.036/1990 art. 18): a regra de cada modalidade, os dias do aviso prévio e a
// projeção, o saldo de salário do mês, as férias vencidas e proporcionais, o 13º proporcional e o termo com a memória
// por rubrica. Regra pura: quem chama lê o vínculo desligado, o salário, o histórico das folhas mensais calculadas, os
// afastamentos, o ponto fechado do mês, as férias registradas, o adiantamento do 13º, o FGTS já depositado, a tabela
// legal, os parâmetros e as rubricas.
//
// Decisões (POL-5, dono confirma; registradas nas evidências do M53.5):
// - D-MODALIDADE-535: a modalidade (o que define as verbas) é escolhida no cálculo; o tipo de rescisão do desligamento
//   (cadastro do outro sistema, sem o motivo do eSocial preenchido) só a sugere, pelo código de saque do FGTS e pela
//   causa da rescisão (`modalidadeSugerida`).
// - D-LEI-535: os números fixos da lei ficam no código, como a escala do art. 130 (D-ESCALA-534): aviso de 30 dias + 3
//   por ano completo até 90 (Lei 12.506/2011), prazo de pagamento de 10 dias (art. 477 §6), multa do FGTS de 40% e 20%
//   (Lei 8.036/1990 art. 18; art. 484-A). As alíquotas, faixas e tetos seguem só das vigências (regra 7).
// - D-AVISO-535: dias do aviso pelos anos completos de serviço até o desligamento; o pedido de demissão tem sempre 30.
//   Trabalhado: os 30 dias estão no saldo de salário e os dias da Lei 12.506/2011 além dos 30 saem indenizados.
//   Acordo e culpa recíproca: metade dos dias indenizados (arredondada para baixo).
// - D-PROJECAO-535: os dias indenizados projetam o contrato (OJ 82 e 83 da SDI-1): a projeção dá os avos a mais do 13º
//   (`decimoAviso`) e das férias (`feriasAviso`); o pedido de demissão não cumprido desconta 30 dias da remuneração fixa,
//   limitado ao que há para receber (art. 477 §5).
// - D-SALDO-535: saldo de salário no mês comercial: dias até o desligamento (o último dia do mês vale 30) menos os dias
//   antes da admissão, os de afastamento além dos que a empresa paga e os de gozo de férias com recibo. As variáveis do
//   mês entram só com o ponto fechado (sem ele, aviso e nada de horas, faltas ou atrasos).
// - D-MEDIAS-535: as médias das variáveis do aviso e das férias indenizadas são as das 12 competências antes do mês do
//   desligamento (÷ 12); as do 13º, as dos meses com avo do ano até o mês anterior (÷ os avos), × os avos ÷ 12.
// - D-FERIAS-535: férias vencidas (períodos completos com saldo) com o terço, em dobro quando o período concessivo
//   terminou antes do desligamento (art. 137); proporcionais em avos do período em aquisição (mês de serviço ou fração
//   de 15 dias; art. 146 parágrafo único) × o direito pelas faltas do período ÷ 12; justa causa sem proporcionais
//   (Súmula 171 do TST); culpa recíproca com metade (Súmula 14).
// - D-DECIMO-535: 13º proporcional = remuneração fixa × avos ÷ 12 (avos do ano até o desligamento) + as médias − o
//   adiantamento pago no ano; justa causa sem 13º (o adiantamento é descontado); INSS do 13º em separado e IRRF exclusivo
//   (D-IRRF13-534); FGTS sobre o 13º menos o já depositado no adiantamento. Paga a parcela final do ano (desligamento em
//   dezembro), o 13º do ano não entra de novo.
// - D-MULTA-535: multa do FGTS sobre o saldo para fins rescisórios (o do extrato, informado pelo DP; sem ele, a soma dos
//   depósitos registrados aqui, com aviso) + o FGTS desta rescisão; linha informativa (a multa vai pela guia, não pelo
//   líquido).
// - D-479-535: indenização do art. 479 na antecipação do termo pelo empregador: metade da remuneração dos dias que
//   faltavam até o termo.
import type {
  AvisoPrevio,
  AvisoRescisao,
  DiasAfastamentoFolha,
  LinhaCalculoFolha,
  ModalidadeRescisao,
  PapelCalculoFolha,
  ParametrosFolha,
  PendenciaCalculo,
  RecusaRescisao,
  RubricaFolha,
  TabelaLegalFolha,
} from '@sgh/contratos';
import { AVISOS_DA_MODALIDADE, TIPO_DO_PAPEL } from '@sgh/contratos';
import { diaUtc } from '../datas.js';
import { somarMeses } from '../sesmt/aso.js';
import {
  type AfastamentoParaCalculo,
  type Bruta,
  cotaSalarioFamilia,
  DIAS_MES_COMERCIAL,
  diasDoMes,
  type FeriasNoMesParaCalculo,
  incide,
  linhaInformativa,
  multiplicarDividir,
  pct,
  type PontoFechadoParaCalculo,
  proventosDoVinculo,
  reais,
  rubricaServeAoPapel,
  type SalarioParaCalculo,
  type VinculoParaCalculo,
} from './calculo.js';
import { type FeriasRegistrada, remuneracaoFixa, saldoDosPeriodos } from './ferias.js';
import {
  avosDoAno,
  competenciasSemCalculo,
  type HistoricoFolha,
  maisCompetencias,
  maisDias,
  mediaDasVariaveis,
  somarAnos,
} from './medias.js';
import { fecharRecibo, papeisSemRubrica, type ReciboFechado, rubricasDosParametros } from './recibo.js';
import { conferirTabelaLegal, vigenteNaCompetencia, vigenteNaData } from './vigencia.js';

/** Aviso prévio da Lei 12.506/2011 (D-LEI-535). */
export const DIAS_AVISO_BASE = 30;
export const DIAS_AVISO_POR_ANO = 3;
export const DIAS_AVISO_MAXIMO = 90;
/** Prazo do pagamento da rescisão (art. 477 §6). */
export const PRAZO_PAGAMENTO_RESCISAO = 10;

/** As verbas que cada modalidade paga (D-MODALIDADE-535). */
export interface RegraDaModalidade {
  /** Quem dá o aviso: o empregador (Lei 12.506/2011), o empregado (30 dias) ou ninguém. */
  readonly aviso: 'empregador' | 'empregado' | null;
  /** Metade dos dias indenizados (acordo, culpa recíproca). */
  readonly metadeDoAviso: boolean;
  readonly decimo: boolean;
  readonly feriasProporcionais: boolean;
  /** Metade do 13º e das férias proporcionais (culpa recíproca). */
  readonly metadeDosProporcionais: boolean;
  readonly indenizacao479: boolean;
  /** Multa do FGTS em centésimos de ponto. */
  readonly multaFgts: number;
}

const R = (x: Partial<RegraDaModalidade>): RegraDaModalidade => ({
  aviso: null,
  metadeDoAviso: false,
  decimo: true,
  feriasProporcionais: true,
  metadeDosProporcionais: false,
  indenizacao479: false,
  multaFgts: 0,
  ...x,
});

export const REGRA_DA_MODALIDADE: Readonly<Record<ModalidadeRescisao, RegraDaModalidade>> = {
  'sem-justa-causa': R({ aviso: 'empregador', multaFgts: 4000 }),
  'justa-causa': R({ decimo: false, feriasProporcionais: false }),
  'pedido-demissao': R({ aviso: 'empregado' }),
  acordo: R({ aviso: 'empregador', metadeDoAviso: true, multaFgts: 2000 }),
  'termino-contrato': R({}),
  'antecipada-empregador': R({ indenizacao479: true, multaFgts: 4000 }),
  'antecipada-empregado': R({}),
  'culpa-reciproca': R({
    aviso: 'empregador',
    metadeDoAviso: true,
    metadeDosProporcionais: true,
    multaFgts: 2000,
  }),
  'rescisao-indireta': R({ aviso: 'empregador', multaFgts: 4000 }),
  falecimento: R({}),
};

/**
 * A modalidade que o tipo de rescisão do cadastro sugere (D-MODALIDADE-535), pelo código de saque do FGTS (01 despedida
 * sem justa causa, 02 culpa recíproca, 04 fim do contrato a termo, 23 falecimento) e, sem saque, pela causa da rescisão
 * (1 justa causa, 5 pedido do empregado). null: o DP escolhe.
 */
export function modalidadeSugerida(t: {
  readonly saque: string | null;
  readonly causa: number | null;
}): ModalidadeRescisao | null {
  switch ((t.saque ?? '').trim()) {
    case '01':
      return 'sem-justa-causa';
    case '02':
      return 'culpa-reciproca';
    case '04':
      return 'termino-contrato';
    case '23':
      return 'falecimento';
    default:
      break;
  }
  if (t.causa === 1) return 'justa-causa';
  if (t.causa === 5) return 'pedido-demissao';
  return null;
}

/** Anos completos de serviço de `admissao` até `data`. */
export function anosCompletos(admissao: string, data: string): number {
  let k = 0;
  while (k < 200 && diaUtc(somarAnos(admissao, k + 1)) <= diaUtc(data) + 1) k++;
  return k;
}

/** Os dias de aviso devidos (D-AVISO-535). */
export function diasDeAviso(
  modalidade: ModalidadeRescisao,
  admissao: string,
  desligamento: string,
): { devidos: number; anos: number } {
  const quem = REGRA_DA_MODALIDADE[modalidade].aviso;
  const anos = anosCompletos(admissao, desligamento);
  if (quem === 'empregador')
    return { devidos: Math.min(DIAS_AVISO_MAXIMO, DIAS_AVISO_BASE + DIAS_AVISO_POR_ANO * anos), anos };
  if (quem === 'empregado') return { devidos: DIAS_AVISO_BASE, anos };
  return { devidos: 0, anos };
}

/** Os dias de aviso pagos como indenização (projetam o contrato). */
export function diasIndenizados(modalidade: ModalidadeRescisao, aviso: AvisoPrevio, devidos: number): number {
  const r = REGRA_DA_MODALIDADE[modalidade];
  if (r.aviso !== 'empregador') return 0;
  const base =
    aviso === 'indenizado' ? devidos : aviso === 'trabalhado' ? Math.max(0, devidos - DIAS_AVISO_BASE) : 0;
  return r.metadeDoAviso ? Math.floor(base / 2) : base;
}

/** Recusas antes da conta (o vínculo, o aviso da modalidade, o termo e o pagamento). */
export function conferirRescisao(e: {
  readonly vinculo: Pick<VinculoParaCalculo, 'tipo' | 'desligamento'>;
  readonly modalidade: ModalidadeRescisao;
  readonly aviso: AvisoPrevio;
  readonly termo: string | null;
  readonly pagamento: string | null;
}): RecusaRescisao[] {
  const out: RecusaRescisao[] = [];
  const d = e.vinculo.desligamento;
  if (d === null) return ['vinculo-ativo'];
  if (e.vinculo.tipo !== 'clt') return ['vinculo-sem-rescisao'];
  if (!AVISOS_DA_MODALIDADE[e.modalidade].includes(e.aviso)) out.push('aviso-invalido');
  if (REGRA_DA_MODALIDADE[e.modalidade].indenizacao479 && e.termo === null) out.push('termo-obrigatorio');
  if (e.termo !== null && diaUtc(e.termo) <= diaUtc(d)) out.push('termo-invalido');
  if (e.pagamento !== null && diaUtc(e.pagamento) < diaUtc(d)) out.push('pagamento-antes');
  return out;
}

/** Avos de férias do período que começa em `inicio` até `ate` inclusive (mês de serviço ou fração de 15 dias). */
export function avosDeFerias(inicio: string, ate: string): number {
  const fim = diaUtc(ate) + 1;
  if (fim <= diaUtc(inicio)) return 0;
  let k = 0;
  while (k < 12 && diaUtc(somarMeses(inicio, k + 1)) <= fim) k++;
  if (k >= 12) return 12;
  return fim - diaUtc(somarMeses(inicio, k)) >= 15 ? k + 1 : k;
}

/** Os dias do saldo de salário no mês do desligamento (D-SALDO-535). */
export function diasDoSaldo(
  v: Pick<VinculoParaCalculo, 'admissao'> & { readonly desligamento: string },
  afastamentos: readonly AfastamentoParaCalculo[],
  diasEmpresa: number,
  diasDeFerias: number,
): { dias: number; naoPagos: number; antesDaAdmissao: number; afastado: number } {
  const d = v.desligamento;
  const competencia = d.slice(0, 7);
  const dia = Number(d.slice(8, 10));
  const ate = dia === diasDoMes(competencia) ? DIAS_MES_COMERCIAL : Math.min(dia, DIAS_MES_COMERCIAL);
  const ini = diaUtc(`${competencia}-01`);
  const antes = diaUtc(v.admissao) > ini ? Math.min(ate, diaUtc(v.admissao) - ini) : 0;
  let afastado = 0;
  for (const a of afastamentos) {
    if (a.situacao !== 'ativo') continue;
    const desde = Math.max(diaUtc(a.inicio) + diasEmpresa, ini);
    const fim = Math.min(a.fim === null ? Number.MAX_SAFE_INTEGER : diaUtc(a.fim), diaUtc(d));
    if (fim >= desde) afastado += fim - desde + 1;
  }
  const naoPagos = Math.min(ate, antes + afastado + diasDeFerias);
  return { dias: Math.max(0, ate - naoPagos), naoPagos, antesDaAdmissao: antes, afastado };
}

interface FeriasNaData {
  readonly vencidas: readonly { inicio: string; concessivoFim: string; saldo: number }[];
  readonly proporcional: { inicio: string; avos: number; direito: number } | null;
}

/** Os períodos vencidos (completos com saldo) e o proporcional em aquisição na data (D-FERIAS-535). */
function feriasNaData(
  v: VinculoParaCalculo,
  data: string,
  historico: readonly HistoricoFolha[],
  afastamentos: readonly AfastamentoParaCalculo[],
  diasEmpresa: number,
  ferias: readonly FeriasRegistrada[],
): FeriasNaData {
  const ps = saldoDosPeriodos({
    vinculo: { admissao: v.admissao, desligamento: data, cargaSemanal: v.cargaSemanal, tipo: v.tipo },
    hoje: data,
    historico,
    afastamentos,
    diasEmpresa,
    ferias,
  });
  const vencidas = ps
    .filter((p) => p.situacao !== 'em-aquisicao' && p.saldo > 0)
    .map((p) => ({ inicio: p.inicio, concessivoFim: p.concessivoFim, saldo: p.saldo }));
  const em = ps.find((p) => p.situacao === 'em-aquisicao');
  return {
    vencidas,
    proporcional: em ? { inicio: em.inicio, avos: avosDeFerias(em.inicio, data), direito: em.direito } : null,
  };
}

/** Os dias de férias da data em doze avos (vencidas × 12 + direito × avos do proporcional). */
const dozeAvos = (f: FeriasNaData, comProporcional: boolean) =>
  f.vencidas.reduce((s, x) => s + x.saldo * 12, 0) +
  (comProporcional && f.proporcional ? f.proporcional.direito * f.proporcional.avos : 0);

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export interface EntradaCalculoRescisao {
  readonly empresa: number;
  /** O vínculo desligado (desligamento preenchido). */
  readonly vinculo: VinculoParaCalculo;
  readonly modalidade: ModalidadeRescisao;
  readonly aviso: AvisoPrevio;
  readonly termo: string | null;
  /** null: desligamento + 10 dias. */
  readonly pagamento: string | null;
  /** Saldo do FGTS do extrato (null: `fgtsDepositado`). */
  readonly saldoFgts: number | null;
  /** A soma dos depósitos de FGTS registrados nas folhas deste sistema (sem a rescisão). */
  readonly fgtsDepositado: number;
  readonly salarios: readonly SalarioParaCalculo[];
  /** O histórico das folhas mensais calculadas do vínculo (das 12 competências antes do desligamento e do ano). */
  readonly historico: readonly HistoricoFolha[];
  readonly afastamentos: readonly AfastamentoParaCalculo[];
  readonly diasAfastamento: readonly DiasAfastamentoFolha[];
  /** O ponto fechado do mês do desligamento (null: não fechado). */
  readonly ponto: PontoFechadoParaCalculo | null;
  /** Minutos de sobreaviso realizados e aprovados no mês. */
  readonly sobreaviso: number;
  /** As frações de férias do vínculo (as programadas sem recibo não contam como gozadas). */
  readonly ferias: readonly FeriasRegistrada[];
  /** As férias com recibo no mês do desligamento (dias de gozo até o desligamento e o INSS do recibo). */
  readonly feriasNoMes: FeriasNoMesParaCalculo | null;
  /** O adiantamento do 13º pago no ano do desligamento (1ª parcela ou com as férias). */
  readonly adiantamentoDecimo: number;
  /** A parcela final do 13º do ano do desligamento já pagou o colaborador. */
  readonly decimoPago: boolean;
  /** O colaborador está na folha mensal calculada da competência do desligamento. */
  readonly naFolhaMensal: boolean;
  readonly tabelasLegais: readonly TabelaLegalFolha[];
  readonly parametros: readonly ParametrosFolha[];
  readonly rubricas: readonly RubricaFolha[];
}

export interface ApuracaoRescisaoPura {
  readonly desligamento: string;
  readonly competencia: string;
  readonly diasAviso: number;
  readonly diasIndenizados: number;
  readonly projecao: string;
  readonly anosCompletos: number;
  readonly diasSaldo: number;
  readonly avosDecimo: number;
  readonly avosDecimoAviso: number;
  readonly saldoFgts: number;
  readonly saldoFgtsInformado: boolean;
  /** O FGTS desta rescisão (mês e 13º), que entra na base da multa junto com o saldo. */
  readonly fgtsRescisao: number;
  readonly percentualMulta: number;
  readonly multaFgts: number;
  readonly pagamento: string;
}

export interface ResultadoCalculoRescisaoPuro {
  readonly competencia: string;
  readonly recusas: readonly RecusaRescisao[];
  readonly pendencias: readonly PendenciaCalculo[];
  readonly avisos: readonly { readonly codigo: AvisoRescisao; readonly competencias: readonly string[] }[];
  readonly apuracao: ApuracaoRescisaoPura | null;
  readonly recibo: ReciboFechado | null;
  readonly tabelaLegal: string | null;
  readonly parametros: string | null;
}

/** Os papéis de base e informativos que os dois fechamentos (mês e 13º) somam numa linha só. */
const PAPEIS_SOMADOS = new Set([
  'fgts',
  'baseInss',
  'baseIrrf',
  'baseFgts',
  'inssPatronal',
  'rat',
  'terceiros',
]);

/** Junta o fechamento do mês e o do 13º num termo só (uma linha por papel; as bases e encargos somados). */
export function juntarRecibos(a: ReciboFechado, b: ReciboFechado): ReciboFechado {
  const verbas: LinhaCalculoFolha[] = [];
  const somadas = new Map<string, LinhaCalculoFolha>();
  for (const [origem, l] of [
    ...a.linhas.map((x) => ['mes', x] as const),
    ...b.linhas.map((x) => ['decimo', x] as const),
  ]) {
    if (!PAPEIS_SOMADOS.has(l.papel)) {
      verbas.push(l);
      continue;
    }
    const ja = somadas.get(l.papel);
    if (!ja) {
      somadas.set(l.papel, origem === 'decimo' && l.valor > 0 ? { ...l, memoria: `13º: ${l.memoria}` } : l);
      continue;
    }
    const memoria =
      l.valor > 0 ? (ja.valor > 0 ? `${ja.memoria} | 13º: ${l.memoria}` : `13º: ${l.memoria}`) : ja.memoria;
    somadas.set(l.papel, {
      ...ja,
      quantidade: ja.quantidade || l.quantidade,
      unidade: ja.quantidade ? ja.unidade : l.unidade,
      valor: ja.valor + l.valor,
      memoria: memoria.slice(0, 400),
    });
  }
  const linhas = [
    ...verbas.filter((l) => l.tipo === 'provento' || l.tipo === 'desconto'),
    ...verbas.filter((l) => l.tipo !== 'provento' && l.tipo !== 'desconto'),
    ...somadas.values(),
  ];
  const soma = (t: 'provento' | 'desconto') =>
    linhas.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0);
  const proventos = soma('provento');
  const descontos = soma('desconto');
  const ra = a.resumo;
  const rb = b.resumo;
  return {
    resumo: {
      vinculo: ra.vinculo,
      matricula: ra.matricula,
      centroCusto: ra.centroCusto,
      diasPagos: ra.diasPagos,
      proventos,
      descontos,
      liquido: Math.max(0, proventos - descontos),
      baseInss: ra.baseInss + rb.baseInss,
      baseIrrf: ra.baseIrrf + rb.baseIrrf,
      baseFgts: ra.baseFgts + rb.baseFgts,
      inss: ra.inss + rb.inss,
      irrf: ra.irrf + rb.irrf,
      fgts: ra.fgts + rb.fgts,
      encargos: ra.encargos + rb.encargos,
    },
    linhas,
  };
}

const pend = (
  codigo: PendenciaCalculo['codigo'],
  vinculo: number | null,
  papel: PapelCalculoFolha | null = null,
): PendenciaCalculo => ({ codigo, vinculos: vinculo === null ? [] : [vinculo], papel });

/** Calcula a rescisão do vínculo desligado (o termo com a memória; quem chama não grava com pendência). */
export function calcularRescisao(e: EntradaCalculoRescisao): ResultadoCalculoRescisaoPuro {
  const v = e.vinculo;
  const vazio = {
    competencia: (v.desligamento ?? '').slice(0, 7),
    pendencias: [] as PendenciaCalculo[],
    avisos: [] as { codigo: AvisoRescisao; competencias: string[] }[],
    apuracao: null,
    recibo: null,
    tabelaLegal: null,
    parametros: null,
  };
  const recusas = conferirRescisao({
    vinculo: v,
    modalidade: e.modalidade,
    aviso: e.aviso,
    termo: e.termo,
    pagamento: e.pagamento,
  });
  if (recusas.length > 0 || v.desligamento === null) return { ...vazio, recusas };
  const deslig = v.desligamento;
  const competencia = deslig.slice(0, 7);
  const ano = Number(deslig.slice(0, 4));
  const mes = Number(deslig.slice(5, 7));
  const regra = REGRA_DA_MODALIDADE[e.modalidade];
  const pendencias: PendenciaCalculo[] = [];
  const avisos: { codigo: AvisoRescisao; competencias: string[] }[] = [];

  const tabela = vigenteNaCompetencia(e.tabelasLegais, competencia);
  if (!tabela) pendencias.push(pend('sem-tabela-legal', null));
  else if (conferirTabelaLegal(tabela).length > 0) pendencias.push(pend('tabela-legal-divergente', null));
  const parametros = vigenteNaCompetencia(
    e.parametros.filter((p) => p.empresa === e.empresa),
    competencia,
  );
  if (!parametros) pendencias.push(pend('sem-parametros', null));
  const salario = vigenteNaData(
    e.salarios.filter((s) => s.vinculo === v.id),
    deslig,
  );
  if (!salario) pendencias.push(pend('sem-salario', v.id));
  if (e.naFolhaMensal) pendencias.push(pend('na-folha-mensal', v.id));

  // Aviso, projeção e pagamento.
  const { devidos, anos } = diasDeAviso(e.modalidade, v.admissao, deslig);
  const indenizados = diasIndenizados(e.modalidade, e.aviso, devidos);
  const projecao = maisDias(deslig, indenizados);
  const pagamento = e.pagamento ?? maisDias(deslig, PRAZO_PAGAMENTO_RESCISAO);
  if (diaUtc(pagamento) > diaUtc(deslig) + PRAZO_PAGAMENTO_RESCISAO)
    avisos.push({ codigo: 'pagamento-fora-do-prazo', competencias: [] });
  if (e.ponto === null) avisos.push({ codigo: 'ponto-nao-fechado', competencias: [competencia] });
  if (e.saldoFgts === null) avisos.push({ codigo: 'saldo-fgts-estimado', competencias: [] });
  if (e.ferias.some((f) => f.situacao === 'programada'))
    avisos.push({ codigo: 'ferias-programadas', competencias: [] });
  if (e.decimoPago) avisos.push({ codigo: 'decimo-ja-pago', competencias: [`${ano}-12`] });
  const anteriores = Array.from({ length: 12 }, (_, i) => maisCompetencias(competencia, i - 12)).filter(
    (c) => c >= v.admissao.slice(0, 7),
  );
  const semCalculo = competenciasSemCalculo(e.historico, anteriores);
  if (semCalculo.length > 0) avisos.push({ codigo: 'competencias-sem-calculo', competencias: semCalculo });

  const base = {
    competencia,
    recusas: [] as RecusaRescisao[],
    avisos,
    tabelaLegal: tabela?.inicio ?? null,
    parametros: parametros?.inicio ?? null,
  };
  if (!tabela || !parametros || !salario || pendencias.some((p) => p.codigo !== 'na-folha-mensal'))
    return { ...base, pendencias, apuracao: null, recibo: null };

  const diasEmpresa = vigenteNaCompetencia(e.diasAfastamento, competencia)?.dias ?? 0;
  const afast = e.afastamentos.filter((a) => a.vinculo === v.id && a.situacao === 'ativo');
  const { mapa, invalidas } = rubricasDosParametros(
    parametros,
    e.rubricas,
    e.empresa,
    competencia,
    rubricaServeAoPapel,
  );
  const divisor = parametros.divisorHoras ?? v.cargaSemanal * 5;
  const fixa = remuneracaoFixa(salario, tabela, parametros);
  const media = mediaDasVariaveis(e.historico, new Set(anteriores), 12, salario.salario, divisor, parametros);
  const remun = fixa.valor + media.valor;
  const remunMemo = `(${fixa.memoria}) = ${reais(fixa.valor)} + média ${reais(media.valor)}`;

  // ── Mês: saldo de salário, variáveis e salário-família (D-SALDO-535) ──
  const dias = diasDoSaldo(
    { admissao: v.admissao, desligamento: deslig },
    afast,
    diasEmpresa,
    e.feriasNoMes?.dias ?? 0,
  );
  const mesBrutas: Bruta[] = proventosDoVinculo(v, {
    competencia,
    salario,
    ponto: e.ponto ?? { eventos: {}, horas: {} },
    sobreaviso: e.ponto ? e.sobreaviso : 0,
    dias,
    tabela,
    parametros,
    ...(e.feriasNoMes ? { ferias: e.feriasNoMes } : {}),
  });
  const salarioLinha = mesBrutas.find((b) => b.papel === 'salario');
  if (salarioLinha) salarioLinha.memoria = `saldo de salário: ${salarioLinha.memoria}`;
  const baseInssMes = mesBrutas.reduce(
    (s, b) =>
      incide(mapa.get(b.papel), 'inss')
        ? s + (TIPO_DO_PAPEL[b.papel] === 'desconto' ? -b.valor : b.valor)
        : s,
    0,
  );
  const cota = cotaSalarioFamilia(Math.max(0, baseInssMes), tabela.salarioFamilia);
  if (cota > 0 && salario.dependentesSalarioFamilia > 0) {
    const valor = multiplicarDividir(
      [cota, salario.dependentesSalarioFamilia, dias.dias],
      [DIAS_MES_COMERCIAL],
    );
    if (valor > 0)
      mesBrutas.push({
        papel: 'salarioFamilia',
        quantidade: salario.dependentesSalarioFamilia,
        unidade: 'dependentes',
        valor,
        memoria: `${salario.dependentesSalarioFamilia} dependente(s) × ${reais(cota)} × ${dias.dias}/${DIAS_MES_COMERCIAL} dias`,
      });
  }

  // ── Aviso e art. 479 ──
  if (indenizados > 0)
    mesBrutas.push({
      papel: 'avisoIndenizado',
      quantidade: indenizados,
      unidade: 'dias',
      valor: multiplicarDividir([remun, indenizados], [DIAS_MES_COMERCIAL]),
      memoria: `${remunMemo} × ${indenizados}/${DIAS_MES_COMERCIAL} dias (aviso de ${devidos} dias: ${DIAS_AVISO_BASE} + ${DIAS_AVISO_POR_ANO} × ${anos} ano(s)${
        e.aviso === 'trabalhado' ? `; ${DIAS_AVISO_BASE} trabalhados` : ''
      }${regra.metadeDoAviso ? '; metade' : ''}; projeção até ${dataBr(projecao)})`,
    });
  if (regra.indenizacao479 && e.termo !== null) {
    const faltam = diaUtc(e.termo) - diaUtc(deslig);
    mesBrutas.push({
      papel: 'indenizacao479',
      quantidade: faltam,
      unidade: 'dias',
      valor: multiplicarDividir([remun, faltam], [DIAS_MES_COMERCIAL, 2]),
      memoria: `${remunMemo} × ${faltam}/${DIAS_MES_COMERCIAL} dias até o termo ${dataBr(e.termo)} ÷ 2 (art. 479)`,
    });
  }

  // ── Férias (D-FERIAS-535) ──
  const registradas = e.ferias.filter((f) => f.situacao === 'calculada');
  const real = feriasNaData(v, deslig, e.historico, afast, diasEmpresa, registradas);
  const proj =
    indenizados > 0 ? feriasNaData(v, projecao, e.historico, afast, diasEmpresa, registradas) : real;
  const metade: [number, number] = regra.metadeDosProporcionais ? [1, 2] : [1, 1];
  const feriasBrutas: Bruta[] = [];
  const diasVencidos = real.vencidas.reduce((s, x) => s + x.saldo, 0);
  if (diasVencidos > 0)
    feriasBrutas.push({
      papel: 'feriasVencidas',
      quantidade: diasVencidos,
      unidade: 'dias',
      valor: multiplicarDividir([remun, diasVencidos], [DIAS_MES_COMERCIAL]),
      memoria: `${remunMemo} × ${diasVencidos}/${DIAS_MES_COMERCIAL} dias (períodos ${real.vencidas
        .map((x) => `${dataBr(x.inicio)}: ${x.saldo}`)
        .join('; ')})`,
    });
  const dobradas = real.vencidas.filter((x) => diaUtc(deslig) > diaUtc(x.concessivoFim));
  const diasDobra = dobradas.reduce((s, x) => s + x.saldo, 0);
  if (diasDobra > 0)
    feriasBrutas.push({
      papel: 'feriasVencidasDobra',
      quantidade: diasDobra,
      unidade: 'dias',
      valor: multiplicarDividir([remun, diasDobra], [DIAS_MES_COMERCIAL]),
      memoria: `${remunMemo} × ${diasDobra}/${DIAS_MES_COMERCIAL} dias (período concessivo vencido: em dobro, art. 137)`,
    });
  if (regra.feriasProporcionais) {
    const pr = real.proporcional;
    if (pr && pr.avos > 0 && pr.direito > 0)
      feriasBrutas.push({
        papel: 'feriasProporcionais',
        quantidade: pr.avos,
        unidade: 'valor',
        valor: multiplicarDividir(
          [remun, pr.direito, pr.avos, metade[0]],
          [DIAS_MES_COMERCIAL, 12, metade[1]],
        ),
        memoria: `${remunMemo} × ${pr.direito}/${DIAS_MES_COMERCIAL} dias × ${pr.avos}/12 avos (período desde ${dataBr(pr.inicio)})${
          metade[1] === 2 ? ' ÷ 2' : ''
        }`,
      });
    const a12 = dozeAvos(proj, true) - dozeAvos(real, true);
    if (a12 > 0)
      feriasBrutas.push({
        papel: 'feriasAviso',
        quantidade: Math.round(a12 / Math.max(1, proj.proporcional?.direito ?? 30)),
        unidade: 'valor',
        valor: multiplicarDividir([remun, a12, metade[0]], [DIAS_MES_COMERCIAL, 12, metade[1]]),
        memoria: `${remunMemo} × ${a12}/${DIAS_MES_COMERCIAL * 12} (avos de férias da projeção do aviso até ${dataBr(projecao)})${
          metade[1] === 2 ? ' ÷ 2' : ''
        }`,
      });
  }
  const totalFerias = feriasBrutas.reduce((s, b) => s + b.valor, 0);
  if (totalFerias > 0)
    feriasBrutas.push({
      papel: 'feriasRescisaoTerco',
      quantidade: 0,
      unidade: 'valor',
      valor: multiplicarDividir([totalFerias], [3]),
      memoria: `${reais(totalFerias)} ÷ 3 (terço constitucional das férias indenizadas)`,
    });
  mesBrutas.push(...feriasBrutas);

  // ── 13º (D-DECIMO-535) ──
  const decBrutas: Bruta[] = [];
  const vReal = { admissao: v.admissao, desligamento: deslig };
  const vProj = { admissao: v.admissao, desligamento: projecao };
  let avos = 0;
  let avosAviso = 0;
  if (regra.decimo) {
    if (!e.decimoPago) {
      avos = avosDoAno(vReal, afast, ano, diasEmpresa, mes).avos;
      avosAviso = avosDoAno(vProj, afast, ano, diasEmpresa, 12).avos - avos;
    }
    const anoProj = Number(projecao.slice(0, 4));
    if (anoProj > ano)
      avosAviso += avosDoAno(vProj, afast, anoProj, diasEmpresa, Number(projecao.slice(5, 7))).avos;
    avosAviso = Math.max(0, avosAviso);
    if (avos > 0)
      decBrutas.push({
        papel: 'decimoProporcional',
        quantidade: avos,
        unidade: 'valor',
        valor: multiplicarDividir([fixa.valor, avos, metade[0]], [12, metade[1]]),
        memoria: `(${fixa.memoria}) = ${reais(fixa.valor)} × ${avos}/12 avos${metade[1] === 2 ? ' ÷ 2' : ''}`,
      });
    if (avosAviso > 0)
      decBrutas.push({
        papel: 'decimoAviso',
        quantidade: avosAviso,
        unidade: 'valor',
        valor: multiplicarDividir([fixa.valor, avosAviso, metade[0]], [12, metade[1]]),
        memoria: `${reais(fixa.valor)} × ${avosAviso}/12 avos da projeção do aviso até ${dataBr(projecao)}${
          metade[1] === 2 ? ' ÷ 2' : ''
        }`,
      });
    const total = avos + avosAviso;
    if (total > 0) {
      const ate = avosDoAno(vReal, afast, ano, diasEmpresa, Math.max(0, mes - 1));
      const md = mediaDasVariaveis(
        e.historico,
        new Set(ate.meses),
        ate.avos,
        salario.salario,
        divisor,
        parametros,
        [total * metade[0], 12 * metade[1]],
      );
      decBrutas.push({
        papel: 'decimoMedias',
        quantidade: ate.avos,
        unidade: 'valor',
        valor: md.valor,
        memoria: `médias do ano: ${md.memoria}`,
      });
    }
  }
  if (e.adiantamentoDecimo > 0)
    decBrutas.push({
      papel: 'decimoDesconto',
      quantidade: 0,
      unidade: 'valor',
      valor: e.adiantamentoDecimo,
      memoria: `adiantamento do 13º pago no ano ${reais(e.adiantamentoDecimo)}`,
    });

  // ── Aviso não cumprido: desconto limitado ao que há a receber (D-PROJECAO-535) ──
  if (REGRA_DA_MODALIDADE[e.modalidade].aviso === 'empregado' && e.aviso === 'nao-cumprido') {
    const sinal = (b: Bruta) => (TIPO_DO_PAPEL[b.papel] === 'desconto' ? -b.valor : b.valor);
    const disponivel = [...mesBrutas, ...decBrutas].reduce((s, b) => s + sinal(b), 0);
    const cheio = multiplicarDividir([fixa.valor, DIAS_AVISO_BASE], [DIAS_MES_COMERCIAL]);
    const valor = Math.max(0, Math.min(cheio, disponivel));
    if (valor > 0)
      mesBrutas.push({
        papel: 'avisoDescontado',
        quantidade: DIAS_AVISO_BASE,
        unidade: 'dias',
        valor,
        memoria: `${reais(fixa.valor)} × ${DIAS_AVISO_BASE}/${DIAS_MES_COMERCIAL} dias (aviso não cumprido, art. 487 §2)${
          valor < cheio ? `, limitado a ${reais(disponivel)} a receber (art. 477 §5)` : ''
        }`,
      });
  }

  const ctx = { tabela, parametros, rubricas: mapa, dependentesIrrf: salario.dependentesIrrf };
  const doMes = fecharRecibo(v, dias.dias, mesBrutas, ctx, {
    papelInss: 'inss',
    papelIrrf: 'irrf',
    irrf: 'mensal',
    foraDoInssIrrf: new Set<PapelCalculoFolha>(),
    fgtsJaDepositado: 0,
    encargos: true,
    ...(e.feriasNoMes ? { feriasNoMes: e.feriasNoMes } : {}),
  });
  const doDecimo = fecharRecibo(v, dias.dias, decBrutas, ctx, {
    papelInss: 'inssDecimo',
    papelIrrf: 'irrfDecimo',
    irrf: 'exclusiva',
    foraDoInssIrrf: new Set<PapelCalculoFolha>(),
    foraDasBases: new Set<PapelCalculoFolha>(['decimoDesconto']),
    fgtsJaDepositado: regra.decimo ? e.adiantamentoDecimo : 0,
    encargos: true,
  });
  const junto = juntarRecibos(doMes, doDecimo);

  // ── Multa do FGTS (D-MULTA-535) ──
  const saldoFgts = e.saldoFgts ?? e.fgtsDepositado;
  const baseMulta = saldoFgts + junto.resumo.fgts;
  const multa = regra.multaFgts > 0 ? multiplicarDividir([baseMulta, regra.multaFgts], [10_000]) : 0;
  const linhas =
    regra.multaFgts > 0
      ? [
          ...junto.linhas,
          linhaInformativa(
            'multaFgts',
            multa,
            `(${reais(saldoFgts)} ${e.saldoFgts === null ? 'depositados aqui' : 'do extrato'} + ${reais(
              junto.resumo.fgts,
            )} desta rescisão) × ${pct(regra.multaFgts)}`,
            regra.multaFgts,
          ),
        ]
      : junto.linhas;
  const recibo: ReciboFechado = { resumo: junto.resumo, linhas };

  for (const p of papeisSemRubrica(
    recibo.linhas.filter((l) => l.papel !== 'multaFgts'),
    mapa,
  ))
    pendencias.push(pend(invalidas.has(p) ? 'rubrica-invalida' : 'papel-sem-rubrica', v.id, p));
  if (recibo.resumo.descontos > recibo.resumo.proventos) pendencias.push(pend('liquido-negativo', v.id));
  return {
    ...base,
    pendencias,
    apuracao: {
      desligamento: deslig,
      competencia,
      diasAviso: devidos,
      diasIndenizados: indenizados,
      projecao,
      anosCompletos: anos,
      diasSaldo: dias.dias,
      avosDecimo: avos,
      avosDecimoAviso: avosAviso,
      saldoFgts,
      saldoFgtsInformado: e.saldoFgts !== null,
      fgtsRescisao: junto.resumo.fgts,
      percentualMulta: regra.multaFgts,
      multaFgts: multa,
      pagamento,
    },
    recibo,
  };
}
