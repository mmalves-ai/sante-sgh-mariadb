// F3.8, 07-FIN linha 108: o lado das receitas da EFD-Contribuições: a receita de serviços da competência, tirada das
// notas de serviço emitidas, e a contribuição apurada do PIS e da COFINS (blocos M200/M210 e M600/M610). Regras puras,
// sem banco.
//   - Só a nota autorizada em produção é receita; a que ainda espera a autorização (RPS gerado ou enviada) é pendência e
//     impede a geração, porque a receita do mês ficaria incompleta. A cancelada e a substituída não entram.
//   - A base é o valor dos serviços menos o desconto incondicional (o desconto incondicional não é receita).
//   - O regime da receita: no não cumulativo, alíquota básica de 1,65% (PIS) e 7,6% (COFINS), código de contribuição
//     01; no cumulativo e no misto, 0,65% e 3%, código 51. No misto, a receita do serviço hospitalar fica no
//     cumulativo (Lei 10.833/2003, art. 10, XIII, e Lei 10.637/2002, art. 8º): o crédito das entradas só desconta a
//     contribuição não cumulativa, então nesse caso fica como saldo para os meses seguintes.
//   - Ordem dos descontos: a contribuição apurada, menos o crédito descontado (só no não cumulativo, até a apurada),
//     menos a retenção na fonte sofrida nas notas (até o que sobra), dá o valor a recolher.
import { centavos } from '@sgh/contratos/regras-financeiro';
import type { RegimeEfd } from './escrituracao-entrada.js';

export type RegimeReceita = 'cumulativo' | 'nao_cumulativo';

/** Alíquota básica (%) por regime da receita. */
export const ALIQUOTAS_RECEITA: Readonly<Record<RegimeReceita, { pis: number; cofins: number }>> = {
  cumulativo: { pis: 0.65, cofins: 3 },
  nao_cumulativo: { pis: 1.65, cofins: 7.6 },
};
/** Código da contribuição (tabela 4.3.5): 01 não cumulativa e 51 cumulativa, ambas à alíquota básica. */
export const CODIGO_CONTRIBUICAO: Readonly<Record<RegimeReceita, string>> = {
  cumulativo: '51',
  nao_cumulativo: '01',
};
/** CST de saída da receita tributada à alíquota básica. */
export const CST_RECEITA_TRIBUTADA = '01';

export const regimeDaReceita = (r: RegimeEfd): RegimeReceita =>
  r === 'nao_cumulativo' ? 'nao_cumulativo' : 'cumulativo';

export interface ReceitaServicoEfd {
  readonly id: number;
  readonly numero: string;
  readonly serie: string | null;
  readonly chave: string | null;
  /** AAAA-MM-DD. */
  readonly dataEmissao: string;
  readonly tipoTomador: 'pessoa_fisica' | 'pessoa_juridica' | 'estrangeiro';
  /** CNPJ do tomador pessoa jurídica (o da pessoa física não vai ao arquivo). */
  readonly tomadorDocumento: string | null;
  readonly tomadorNome: string;
  /** autorizada: é receita; aguardando: RPS gerado ou enviada, ainda sem autorização (pendência). */
  readonly situacao: 'autorizada' | 'aguardando';
  readonly valorServicos: number;
  readonly valorDesconto: number;
  readonly valorIss: number;
  /** PIS e COFINS retidos pelo tomador na nota. */
  readonly pisRetido: number;
  readonly cofinsRetido: number;
}

export interface ApuracaoTributo {
  readonly codigoContribuicao: string;
  readonly aliquota: number;
  readonly receitaBruta: number;
  readonly base: number;
  readonly apurada: number;
  readonly creditoDisponivel: number;
  readonly creditoDescontado: number;
  readonly saldoCredito: number;
  readonly retido: number;
  readonly retencaoDescontada: number;
  readonly aRecolher: number;
}
export interface ApuracaoReceitas {
  readonly regimeReceita: RegimeReceita;
  readonly notas: number;
  readonly aguardando: number;
  readonly pis: ApuracaoTributo;
  readonly cofins: ApuracaoTributo;
}

export const baseDaReceita = (r: ReceitaServicoEfd): number =>
  centavos(Math.max(0, r.valorServicos - r.valorDesconto));
export const contribuicaoDaNota = (r: ReceitaServicoEfd, aliquota: number): number =>
  centavos((baseDaReceita(r) * aliquota) / 100);

function apurarTributo(
  regime: RegimeReceita,
  autorizadas: readonly ReceitaServicoEfd[],
  aliquota: number,
  credito: number,
  retido: (r: ReceitaServicoEfd) => number,
): ApuracaoTributo {
  const receitaBruta = centavos(autorizadas.reduce((s, r) => s + r.valorServicos, 0));
  const base = centavos(autorizadas.reduce((s, r) => s + baseDaReceita(r), 0));
  const apurada = centavos((base * aliquota) / 100);
  const creditoDisponivel = centavos(Math.max(0, credito));
  const creditoDescontado = regime === 'nao_cumulativo' ? Math.min(creditoDisponivel, apurada) : 0;
  const devida = centavos(apurada - creditoDescontado);
  const totalRetido = centavos(autorizadas.reduce((s, r) => s + retido(r), 0));
  const retencaoDescontada = Math.min(totalRetido, devida);
  return {
    codigoContribuicao: CODIGO_CONTRIBUICAO[regime],
    aliquota,
    receitaBruta,
    base,
    apurada,
    creditoDisponivel,
    creditoDescontado,
    saldoCredito: centavos(creditoDisponivel - creditoDescontado),
    retido: totalRetido,
    retencaoDescontada,
    aRecolher: centavos(devida - retencaoDescontada),
  };
}

/** A contribuição da competência: a receita das notas autorizadas, o crédito das entradas e a retenção sofrida. */
export function apurarContribuicoes(
  regime: RegimeEfd,
  receitas: readonly ReceitaServicoEfd[],
  credito: { pis: number; cofins: number },
): ApuracaoReceitas {
  const r = regimeDaReceita(regime);
  const autorizadas = receitas.filter((x) => x.situacao === 'autorizada');
  const aliq = ALIQUOTAS_RECEITA[r];
  return {
    regimeReceita: r,
    notas: autorizadas.length,
    aguardando: receitas.length - autorizadas.length,
    pis: apurarTributo(r, autorizadas, aliq.pis, credito.pis, (x) => x.pisRetido),
    cofins: apurarTributo(r, autorizadas, aliq.cofins, credito.cofins, (x) => x.cofinsRetido),
  };
}

/**
 * Reparte o crédito descontado pelas linhas de apuração do crédito (M100/M500), na ordem delas: cada linha leva até o
 * próprio crédito; o que sobra fica como saldo da linha.
 */
export function repartirCreditoDescontado(
  creditos: readonly number[],
  descontado: number,
): { descontado: number; saldo: number }[] {
  let resta = centavos(descontado);
  return creditos.map((c) => {
    const d = centavos(Math.min(c, Math.max(0, resta)));
    resta = centavos(resta - d);
    return { descontado: d, saldo: centavos(c - d) };
  });
}
