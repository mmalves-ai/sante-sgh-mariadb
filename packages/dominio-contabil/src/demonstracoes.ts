// Demonstrações contábeis (M54-F3; ficha, seção 2 e regra 5): balancete, DRE, balanço, a conferência do diário e o
// plano da apuração do resultado do exercício. Regras puras sobre as somas lidas das partidas gravadas
// (SGH_CTB_PARTIDA), sem banco:
//   - balancete: cada conta analítica com saldo anterior, débitos, créditos e saldo final (sinal devedor: D − C); a
//     sintética soma as analíticas de baixo dela; os totais somam SÓ as analíticas (as parcelas), com a conferência
//     débitos = créditos e saldos devedores = saldos credores impressa;
//   - DRE: receita bruta (receitas de natureza credora), deduções (receitas de natureza devedora, as redutoras),
//     custos e despesas, com as parcelas pela conta de nível 2 (a aglutinação, a mesma da ECD);
//   - balanço: ativo, passivo e patrimônio líquido acumulados até a data, mais o resultado ainda não apurado (o do
//     exercício e o de exercícios anteriores, que deveria ser zero depois das apurações); ativo = passivo + PL +
//     resultado (as contas de compensação à parte);
//   - apuração: um lançamento que zera cada conta de resultado (por centro de custo) contra a conta do patrimônio
//     líquido escolhida; o resultado (superávit ou déficit) vai a ela.
import {
  type ContaPlano,
  type GrupoConta,
  type ImpedimentoContabil,
  type LinhaBalancete,
  type LinhaDre,
  type ParcelaDemonstracao,
  type PartidaGerada,
  type SecaoBalanco,
  type TotaisBalancete,
  GRUPOS_CONTA,
} from '@sgh/contratos';
import { compararCodigos, nivelDoCodigo, paiDoCodigo } from './plano.js';

/** Débitos e créditos somados de uma conta (e, quando a leitura separa, de um centro de custo). */
export interface SomaConta {
  readonly conta: string;
  readonly debitos: number;
  readonly creditos: number;
}

export interface SomaContaCentro extends SomaConta {
  readonly centroCusto: number | null;
}

/** Valor em reais com o separador de milhar (para as conferências impressas). */
export const reaisBr = (c: number): string => {
  const s = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${s}${Math.trunc(a / 100).toLocaleString('pt-BR')},${String(a % 100).padStart(2, '0')}`;
};

const somar = (lista: readonly SomaConta[]) => {
  const m = new Map<string, { d: number; c: number }>();
  for (const s of lista) {
    const x = m.get(s.conta) ?? { d: 0, c: 0 };
    x.d += s.debitos;
    x.c += s.creditos;
    m.set(s.conta, x);
  }
  return m;
};

/** O código e os ancestrais que existem no plano (a própria conta primeiro). */
function cadeia(codigo: string, noPlano: ReadonlyMap<string, ContaPlano>): string[] {
  const r = [codigo];
  let p = paiDoCodigo(codigo);
  while (p) {
    if (noPlano.has(p)) r.push(p);
    p = paiDoCodigo(p);
  }
  return r;
}

/** A conta de nível 2 acima (a aglutinação), ou a própria conta quando ela é de nível 1 ou 2. */
export function aglutinacaoDe(codigo: string): string {
  const partes = codigo.split('.');
  return partes.length <= 2 ? codigo : partes.slice(0, 2).join('.');
}

// ── Balancete ────────────────────────────────────────────────────────────────────────────────────

export interface OpcoesBalancete {
  readonly nivel: number | null;
  readonly incluirZeradas: boolean;
  /** Com filtro de centro de custo a conferência não fecha sozinha (o resultado é nulo). */
  readonly filtrado: boolean;
}

export function montarBalancete(
  plano: readonly ContaPlano[],
  anteriores: readonly SomaConta[],
  movimento: readonly SomaConta[],
  o: OpcoesBalancete,
): {
  linhas: LinhaBalancete[];
  totais: TotaisBalancete;
  equilibrado: boolean | null;
  conferencia: string[];
} {
  const noPlano = new Map(plano.map((c) => [c.codigo, c]));
  const ant = somar(anteriores);
  const mov = somar(movimento);
  type Acc = { ant: number; d: number; c: number };
  const acc = new Map<string, Acc>();
  const pegar = (k: string) => {
    let x = acc.get(k);
    if (!x) {
      x = { ant: 0, d: 0, c: 0 };
      acc.set(k, x);
    }
    return x;
  };
  const analiticas = new Set<string>();
  const contas = new Set<string>([...ant.keys(), ...mov.keys()]);
  for (const c of plano) if (c.tipo === 'analitica') analiticas.add(c.codigo);
  for (const k of contas) {
    const conta = noPlano.get(k);
    if (!conta || conta.tipo === 'analitica') analiticas.add(k);
    const a = ant.get(k) ?? { d: 0, c: 0 };
    const m = mov.get(k) ?? { d: 0, c: 0 };
    for (const alvo of cadeia(k, noPlano)) {
      const x = pegar(alvo);
      x.ant += a.d - a.c;
      x.d += m.d;
      x.c += m.c;
    }
  }
  // Os totais: só as analíticas (inclusive as fora do plano), cada uma uma vez.
  const t = { antD: 0, antC: 0, d: 0, c: 0, finD: 0, finC: 0 };
  for (const k of analiticas) {
    const x = acc.get(k);
    if (!x) continue;
    const fin = x.ant + x.d - x.c;
    if (x.ant > 0) t.antD += x.ant;
    else t.antC -= x.ant;
    t.d += x.d;
    t.c += x.c;
    if (fin > 0) t.finD += fin;
    else t.finC -= fin;
  }
  const codigos = new Set<string>([...noPlano.keys(), ...acc.keys()]);
  const linhas: LinhaBalancete[] = [];
  for (const k of [...codigos].sort(compararCodigos)) {
    const conta = noPlano.get(k);
    const nivel = nivelDoCodigo(k);
    if (o.nivel !== null && nivel > o.nivel) continue;
    const x = acc.get(k) ?? { ant: 0, d: 0, c: 0 };
    const fin = x.ant + x.d - x.c;
    if (!o.incluirZeradas && x.ant === 0 && x.d === 0 && x.c === 0) continue;
    const grupo: GrupoConta = conta?.grupo ?? grupoPeloCodigo(plano, k);
    linhas.push({
      codigo: k,
      nome: conta?.nome ?? 'Conta fora do plano',
      nivel,
      tipo: conta?.tipo ?? 'analitica',
      grupo,
      natureza: conta?.natureza ?? GRUPOS_CONTA[grupo].natureza,
      saldoAnteriorCentavos: x.ant,
      debitosCentavos: x.d,
      creditosCentavos: x.c,
      saldoFinalCentavos: fin,
      foraDoPlano: !conta,
    });
  }
  const conferencia = [
    `Débitos ${reaisBr(t.d)} = créditos ${reaisBr(t.c)} (soma das contas analíticas)`,
    `Saldos anteriores: devedores ${reaisBr(t.antD)} = credores ${reaisBr(t.antC)}`,
    `Saldos finais: devedores ${reaisBr(t.finD)} = credores ${reaisBr(t.finC)}`,
    `Conferência do saldo final: ${reaisBr(t.antD - t.antC)} (anterior) + ${reaisBr(t.d)} (débitos) − ${reaisBr(t.c)} (créditos) = ${reaisBr(t.finD - t.finC)}`,
  ];
  if (o.filtrado)
    conferencia.push('Com o filtro de centro de custo, débitos e créditos de um centro não precisam fechar.');
  return {
    linhas,
    totais: {
      saldoAnteriorDevedorCentavos: t.antD,
      saldoAnteriorCredorCentavos: t.antC,
      debitosCentavos: t.d,
      creditosCentavos: t.c,
      saldoFinalDevedorCentavos: t.finD,
      saldoFinalCredorCentavos: t.finC,
    },
    equilibrado: o.filtrado ? null : t.d === t.c && t.antD === t.antC && t.finD === t.finC,
    conferencia,
  };
}

/** Grupo de uma conta fora do plano: o da conta de nível 1 com o mesmo primeiro código, ou ativo. */
function grupoPeloCodigo(plano: readonly ContaPlano[], codigo: string): GrupoConta {
  const raiz = codigo.split('.')[0];
  return plano.find((c) => c.codigo === raiz)?.grupo ?? 'ativo';
}

// ── DRE ──────────────────────────────────────────────────────────────────────────────────────────

const GRUPOS_RESULTADO: ReadonlySet<GrupoConta> = new Set(['receita', 'custo', 'despesa']);
export const eGrupoDeResultado = (g: GrupoConta): boolean => GRUPOS_RESULTADO.has(g);

function parcelas(
  plano: ReadonlyMap<string, ContaPlano>,
  valores: ReadonlyMap<string, number>,
): ParcelaDemonstracao[] {
  const r = new Map<string, number>();
  for (const [k, v] of valores) {
    const a = aglutinacaoDe(k);
    r.set(a, (r.get(a) ?? 0) + v);
  }
  return [...r]
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => compararCodigos(a, b))
    .map(([codigo, valorCentavos]) => ({
      codigo,
      nome: plano.get(codigo)?.nome ?? 'Conta fora do plano',
      valorCentavos,
    }));
}

const soma = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

/**
 * A DRE do intervalo: o movimento (débitos e créditos) das contas de resultado, sem o lançamento de apuração. Os
 * valores negativos são as deduções, os custos e as despesas; o resultado é a soma.
 */
export function montarDre(
  plano: readonly ContaPlano[],
  movimento: readonly SomaConta[],
): { linhas: LinhaDre[]; resultadoCentavos: number; rotuloResultado: string; conferencia: string } {
  const noPlano = new Map(plano.map((c) => [c.codigo, c]));
  const bruta = new Map<string, number>();
  const deducoes = new Map<string, number>();
  const custos = new Map<string, number>();
  const despesas = new Map<string, number>();
  for (const [k, x] of somar(movimento)) {
    const conta = noPlano.get(k);
    const grupo = conta?.grupo ?? grupoPeloCodigo(plano, k);
    if (!eGrupoDeResultado(grupo)) continue;
    if (grupo === 'receita') {
      if ((conta?.natureza ?? 'credora') === 'credora') bruta.set(k, (bruta.get(k) ?? 0) + x.c - x.d);
      else deducoes.set(k, (deducoes.get(k) ?? 0) + x.c - x.d);
    } else if (grupo === 'custo') custos.set(k, (custos.get(k) ?? 0) + x.c - x.d);
    else despesas.set(k, (despesas.get(k) ?? 0) + x.c - x.d);
  }
  const rb = soma(bruta);
  const de = soma(deducoes);
  const cu = soma(custos);
  const ds = soma(despesas);
  const rl = rb + de;
  const bruto = rl + cu;
  const resultado = bruto + ds;
  const rotuloResultado = resultado < 0 ? 'Déficit do período' : 'Superávit do período';
  const linhas: LinhaDre[] = [
    {
      chave: 'receitaBruta',
      rotulo: 'Receita bruta',
      valorCentavos: rb,
      total: false,
      parcelas: parcelas(noPlano, bruta),
    },
    {
      chave: 'deducoes',
      rotulo: '(−) Deduções da receita',
      valorCentavos: de,
      total: false,
      parcelas: parcelas(noPlano, deducoes),
    },
    { chave: 'receitaLiquida', rotulo: '= Receita líquida', valorCentavos: rl, total: true, parcelas: [] },
    {
      chave: 'custos',
      rotulo: '(−) Custos',
      valorCentavos: cu,
      total: false,
      parcelas: parcelas(noPlano, custos),
    },
    { chave: 'resultadoBruto', rotulo: '= Resultado bruto', valorCentavos: bruto, total: true, parcelas: [] },
    {
      chave: 'despesas',
      rotulo: '(−) Despesas',
      valorCentavos: ds,
      total: false,
      parcelas: parcelas(noPlano, despesas),
    },
    {
      chave: 'resultado',
      rotulo: `= ${rotuloResultado}`,
      valorCentavos: resultado,
      total: true,
      parcelas: [],
    },
  ];
  const conferencia = `${reaisBr(rb)} (receita bruta) − ${reaisBr(-de)} (deduções) − ${reaisBr(-cu)} (custos) − ${reaisBr(-ds)} (despesas) = ${reaisBr(resultado)}`;
  return { linhas, resultadoCentavos: resultado, rotuloResultado, conferencia };
}

// ── Balanço ──────────────────────────────────────────────────────────────────────────────────────

/**
 * O balanço na data: `acumulado` é a soma de TODAS as partidas até a data (todas as contas); `doExercicio` é a das
 * contas de resultado do primeiro dia do exercício até a data (o resultado ainda não apurado do exercício).
 */
export function montarBalanco(
  plano: readonly ContaPlano[],
  acumulado: readonly SomaConta[],
  doExercicio: readonly SomaConta[],
): {
  ativo: SecaoBalanco;
  passivo: SecaoBalanco;
  patrimonioLiquido: SecaoBalanco;
  compensacao: SecaoBalanco | null;
  resultadoExercicioCentavos: number;
  resultadoAnterioresCentavos: number;
  totalAtivoCentavos: number;
  totalPassivoPlCentavos: number;
  equilibrado: boolean;
  conferencia: string;
} {
  const noPlano = new Map(plano.map((c) => [c.codigo, c]));
  const por: Record<'ativo' | 'passivo' | 'patrimonioLiquido' | 'compensacao', Map<string, number>> = {
    ativo: new Map(),
    passivo: new Map(),
    patrimonioLiquido: new Map(),
    compensacao: new Map(),
  };
  let resultadoTotal = 0;
  for (const [k, x] of somar(acumulado)) {
    const g = noPlano.get(k)?.grupo ?? grupoPeloCodigo(plano, k);
    if (eGrupoDeResultado(g)) resultadoTotal += x.c - x.d;
    else if (g === 'ativo' || g === 'compensacao') por[g].set(k, (por[g].get(k) ?? 0) + x.d - x.c);
    else if (g === 'passivo' || g === 'patrimonioLiquido') por[g].set(k, (por[g].get(k) ?? 0) + x.c - x.d);
  }
  let resultadoExercicio = 0;
  for (const [k, x] of somar(doExercicio)) {
    const g = noPlano.get(k)?.grupo ?? grupoPeloCodigo(plano, k);
    if (eGrupoDeResultado(g)) resultadoExercicio += x.c - x.d;
  }
  const resultadoAnteriores = resultadoTotal - resultadoExercicio;
  const secao = (rotulo: string, m: Map<string, number>): SecaoBalanco => ({
    rotulo,
    totalCentavos: soma(m),
    parcelas: parcelas(noPlano, m),
  });
  const ativo = secao('Ativo', por.ativo);
  const passivo = secao('Passivo', por.passivo);
  const pl = secao('Patrimônio líquido', por.patrimonioLiquido);
  const comp = secao('Contas de compensação', por.compensacao);
  const totalPassivoPl = passivo.totalCentavos + pl.totalCentavos + resultadoTotal;
  // Partidas dobradas: ativo + compensação (lado devedor) = passivo + PL + resultado.
  const equilibrado = ativo.totalCentavos + comp.totalCentavos === totalPassivoPl;
  let conferencia = `Ativo ${reaisBr(ativo.totalCentavos)} = passivo ${reaisBr(passivo.totalCentavos)} + patrimônio líquido ${reaisBr(pl.totalCentavos)} + resultado do exercício ${reaisBr(resultadoExercicio)} + resultado de exercícios anteriores não apurado ${reaisBr(resultadoAnteriores)} = ${reaisBr(totalPassivoPl)}`;
  if (comp.totalCentavos !== 0)
    conferencia += `; as contas de compensação têm saldo de ${reaisBr(comp.totalCentavos)} (deveriam se anular)`;
  return {
    ativo,
    passivo,
    patrimonioLiquido: pl,
    compensacao: comp.parcelas.length > 0 || comp.totalCentavos !== 0 ? comp : null,
    resultadoExercicioCentavos: resultadoExercicio,
    resultadoAnterioresCentavos: resultadoAnteriores,
    totalAtivoCentavos: ativo.totalCentavos,
    totalPassivoPlCentavos: totalPassivoPl,
    equilibrado,
    conferencia,
  };
}

// ── Diário ───────────────────────────────────────────────────────────────────────────────────────

export function conferenciaDoDiario(
  parcelas: readonly {
    readonly tipo: string;
    readonly lancamentos: number;
    readonly debitosCentavos: number;
  }[],
  totais: {
    readonly lancamentos: number;
    readonly debitosCentavos: number;
    readonly creditosCentavos: number;
  },
): string {
  const partes = parcelas.map((p) => `${reaisBr(p.debitosCentavos)} (${p.tipo}, ${p.lancamentos})`);
  const eq = totais.debitosCentavos === totais.creditosCentavos ? '=' : '≠';
  return `${partes.join(' + ') || '0,00'} = débitos ${reaisBr(totais.debitosCentavos)} ${eq} créditos ${reaisBr(totais.creditosCentavos)} em ${totais.lancamentos} lançamento(s)`;
}

// ── Apuração do resultado do exercício ───────────────────────────────────────────────────────────

/** A chave do lançamento de apuração: empresa, exercício e o número da apuração (1 = a primeira). */
export const chaveApuracao = (empresa: number, exercicio: number, numero: number): string =>
  `apuracao:${empresa}:${exercicio}:${numero}`;
export const dataDaApuracao = (exercicio: number): string => `${exercicio}-12-31`;

export interface EntradaApuracao {
  readonly exercicio: number;
  readonly plano: readonly ContaPlano[];
  /** Saldo de cada conta de resultado e centro de custo no exercício (até 31/12, sem apuração ativa). */
  readonly saldos: readonly SomaContaCentro[];
  readonly contaDestino: string | null;
  readonly hoje: string;
  /** Dezembro do exercício encerrado (a apuração vai na data de 31/12). */
  readonly dezembroEncerrado: boolean;
  /** A apuração do exercício que ainda vale (não estornada). */
  readonly apuracaoAtiva: number | null;
}

export interface PlanoApuracao {
  readonly receitas: number;
  readonly custos: number;
  readonly despesas: number;
  readonly resultado: number;
  readonly conferencia: string;
  readonly partidas: PartidaGerada[];
  readonly impedimentos: ImpedimentoContabil[];
}

/**
 * As partidas da apuração: cada conta de resultado com saldo (por centro de custo) recebe o lado oposto ao saldo, e a
 * diferença (o resultado) vai à conta de destino do patrimônio líquido. Débitos = créditos por construção.
 */
export function planoDaApuracao(e: EntradaApuracao): PlanoApuracao {
  const noPlano = new Map(e.plano.map((c) => [c.codigo, c]));
  const historico = `Apuração do resultado do exercício de ${e.exercicio}`;
  const impedimentos: ImpedimentoContabil[] = [];
  const imp = (codigo: string, mensagem: string, quantidade = 1) =>
    impedimentos.push({ codigo, mensagem, quantidade });
  const por = new Map<string, { conta: string; centro: number | null; s: number }>();
  for (const x of e.saldos) {
    const g = noPlano.get(x.conta)?.grupo ?? grupoPeloCodigo(e.plano, x.conta);
    if (!eGrupoDeResultado(g)) continue;
    const k = `${x.conta}|${x.centroCusto ?? ''}`;
    const y = por.get(k) ?? { conta: x.conta, centro: x.centroCusto, s: 0 };
    y.s += x.debitos - x.creditos;
    por.set(k, y);
  }
  let receitas = 0;
  let custos = 0;
  let despesas = 0;
  const partidas: PartidaGerada[] = [];
  const ordenadas = [...por.values()]
    .filter((y) => y.s !== 0)
    .sort((a, b) => compararCodigos(a.conta, b.conta) || (a.centro ?? 0) - (b.centro ?? 0));
  for (const y of ordenadas) {
    const g = noPlano.get(y.conta)?.grupo ?? grupoPeloCodigo(e.plano, y.conta);
    if (g === 'receita') receitas -= y.s;
    else if (g === 'custo') custos += y.s;
    else despesas += y.s;
    partidas.push({
      lado: y.s > 0 ? 'C' : 'D',
      conta: y.conta,
      valorCentavos: Math.abs(y.s),
      centroCusto: y.centro,
      historico,
    });
  }
  const resultado = receitas - custos - despesas;
  const destino = e.contaDestino ? noPlano.get(e.contaDestino) : undefined;
  if (e.contaDestino !== null) {
    if (!destino) imp('destino-inexistente', `A conta ${e.contaDestino} não existe no plano.`);
    else if (destino.grupo !== 'patrimonioLiquido' || destino.tipo !== 'analitica' || !destino.ativa)
      imp(
        'destino-invalido',
        `A conta ${e.contaDestino} não é uma conta analítica ativa do patrimônio líquido: o resultado vai ao patrimônio líquido.`,
      );
  }
  if (e.apuracaoAtiva !== null)
    imp(
      'ja-apurado',
      `O resultado de ${e.exercicio} já foi apurado (lançamento ${e.apuracaoAtiva}). Para apurar de novo, estorne esse lançamento.`,
    );
  if (e.dezembroEncerrado)
    imp(
      'dezembro-encerrado',
      `O período 12/${e.exercicio} está encerrado: reabra-o para apurar o resultado.`,
    );
  if (dataDaApuracao(e.exercicio) > e.hoje)
    imp(
      'exercicio-em-curso',
      `O exercício de ${e.exercicio} ainda não terminou: a apuração é no último dia.`,
    );
  if (partidas.length === 0)
    imp('sem-saldo', `As contas de resultado de ${e.exercicio} não têm saldo: nada a apurar.`, 0);
  if (resultado !== 0 && e.contaDestino !== null)
    partidas.push({
      lado: resultado > 0 ? 'C' : 'D',
      conta: e.contaDestino,
      valorCentavos: Math.abs(resultado),
      centroCusto: null,
      historico,
    });
  const conferencia = `${reaisBr(receitas)} (receitas) − ${reaisBr(custos)} (custos) − ${reaisBr(despesas)} (despesas) = ${reaisBr(resultado)} (${resultado < 0 ? 'déficit' : 'superávit'})`;
  return { receitas, custos, despesas, resultado, conferencia, partidas, impedimentos };
}
