// F3.8, 07-FIN linha 108: a escrituração fiscal das entradas e a EFD-Contribuições (a escrituração digital das
// contribuições PIS e COFINS, entregue todo mês à Receita). Regras puras, sem banco:
//   - o dado fiscal do item da nota de entrada: CFOP (código fiscal da operação) de entrada, CST (código de situação
//     tributária) do PIS e da COFINS, base, alíquota, crédito e a natureza da base do crédito. O crédito é sempre a
//     base vezes a alíquota (ninguém digita o crédito); CST sem direito a crédito não leva base nem natureza;
//   - as pendências do que ainda não foi classificado (o que impede a geração do arquivo);
//   - a conferência das somas antes da entrega: item a item (crédito = base x alíquota), documento a documento (o
//     total do documento é a soma dos itens) e a apuração por natureza, CST e alíquota (blocos M100/M105 e M500/M505);
//   - o arquivo no leiaute de registros da EFD-Contribuições: bloco 0 (abertura, regime, estabelecimento e
//     participantes), bloco A (serviços tomados), bloco C (mercadorias), bloco M (apuração do crédito) e bloco 9
//     (contagem dos registros). A validação e a transmissão são feitas no programa da Receita, fora do sistema; aqui
//     se registra o recibo da entrega.
import { centavos, recusaFin, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';
import {
  apurarContribuicoes,
  baseDaReceita,
  contribuicaoDaNota,
  CST_RECEITA_TRIBUTADA,
  type ApuracaoReceitas,
  type ReceitaServicoEfd,
  repartirCreditoDescontado,
} from './escrituracao-receitas.js';

/** CST de entrada com direito a crédito (50 a 56: operação com crédito; 60 a 67: crédito presumido). */
export const CST_ENTRADA_COM_CREDITO = [
  '50',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '67',
] as const;
/** CST de entrada sem direito a crédito (70 a 75), outras entradas (98) e outras operações (99). */
export const CST_ENTRADA_SEM_CREDITO = ['70', '71', '72', '73', '74', '75', '98', '99'] as const;
/** Natureza da base de cálculo do crédito (tabela oficial 4.3.7): 01 a 18. */
export const NATUREZAS_BASE_CREDITO = Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, '0'));
export const REGIMES_EFD = ['cumulativo', 'nao_cumulativo', 'misto'] as const;
export type RegimeEfd = (typeof REGIMES_EFD)[number];

const COM_CREDITO: readonly string[] = CST_ENTRADA_COM_CREDITO;
const SEM_CREDITO: readonly string[] = CST_ENTRADA_SEM_CREDITO;
export const cstDaCredito = (cst: string | null): boolean => cst !== null && COM_CREDITO.includes(cst);
const cstValido = (cst: string | null): boolean =>
  cst !== null && (COM_CREDITO.includes(cst) || SEM_CREDITO.includes(cst));
/** CFOP de entrada: começa por 1 (no estado), 2 (de outro estado) ou 3 (do exterior). */
export const cfopDeEntrada = (cfop: string | null): boolean => cfop !== null && /^[123]\d{3}$/.test(cfop);

/** O crédito do item: a base vezes a alíquota (em %), em centavos. */
export const creditoDoItem = (base: number, aliquota: number | null): number =>
  centavos((base * (aliquota ?? 0)) / 100);

/** O que a tela informa do item: o crédito nunca é digitado. */
export interface ClassificacaoFiscalItem {
  readonly sequencia: number;
  readonly cfop: string | null;
  readonly cstPis: string | null;
  readonly basePis: number;
  readonly aliquotaPis: number | null;
  readonly cstCofins: string | null;
  readonly baseCofins: number;
  readonly aliquotaCofins: number | null;
  readonly naturezaCredito: string | null;
}
/** O item como está escriturado (o valor do item limita a base). */
export interface ItemFiscalEntrada extends ClassificacaoFiscalItem {
  readonly valorItem: number;
  readonly valorDesconto: number;
  readonly valorPis: number;
  readonly valorCofins: number;
}

function conferirTributo(
  nome: 'Pis' | 'Cofins',
  sigla: string,
  cst: string | null,
  base: number,
  aliquota: number | null,
  teto: number,
  seq: number,
): RecusaFinanceiro | null {
  const campos = [`cst${nome}`, `base${nome}`, `aliquota${nome}`];
  if (!cstValido(cst))
    return recusaFin(
      'cst-invalido',
      `Item ${seq}: o CST do ${sigla} da entrada vai de 50 a 56, 60 a 67, 70 a 75, 98 ou 99.`,
      [campos[0]!],
    );
  if (cstDaCredito(cst)) {
    if (!(base > 0))
      return recusaFin(
        'base-obrigatoria',
        `Item ${seq}: o CST ${cst} do ${sigla} dá crédito e pede a base.`,
        [campos[1]!],
      );
    if (base > teto + 0.005)
      return recusaFin(
        'base-maior-que-item',
        `Item ${seq}: a base do ${sigla} não passa do valor do item menos o desconto.`,
        [campos[1]!],
      );
    if (aliquota === null || !(aliquota > 0) || aliquota > 100)
      return recusaFin(
        'aliquota-obrigatoria',
        `Item ${seq}: informe a alíquota do ${sigla} (maior que zero, até 100%).`,
        [campos[2]!],
      );
    return null;
  }
  if (base !== 0 || (aliquota ?? 0) !== 0)
    return recusaFin(
      'credito-indevido',
      `Item ${seq}: o CST ${String(cst)} do ${sigla} não dá crédito: base e alíquota ficam zeradas.`,
      [campos[1]!, campos[2]!],
    );
  return null;
}

/** A classificação fiscal de um item, na gravação pela tela. */
export function conferirClassificacaoItem(
  i: ClassificacaoFiscalItem,
  valorItem: number,
  valorDesconto: number,
): RecusaFinanceiro | null {
  if (!cfopDeEntrada(i.cfop))
    return recusaFin(
      'cfop-nao-e-de-entrada',
      `Item ${i.sequencia}: o CFOP da entrada tem 4 dígitos e começa por 1, 2 ou 3.`,
      ['cfop'],
    );
  const teto = centavos(valorItem - valorDesconto);
  const r =
    conferirTributo('Pis', 'PIS', i.cstPis, i.basePis, i.aliquotaPis, teto, i.sequencia) ??
    conferirTributo('Cofins', 'COFINS', i.cstCofins, i.baseCofins, i.aliquotaCofins, teto, i.sequencia);
  if (r) return r;
  const credito = cstDaCredito(i.cstPis) || cstDaCredito(i.cstCofins);
  if (credito && !(i.naturezaCredito !== null && NATUREZAS_BASE_CREDITO.includes(i.naturezaCredito)))
    return recusaFin(
      'natureza-credito-obrigatoria',
      `Item ${i.sequencia}: informe a natureza da base do crédito (01 a 18).`,
      ['naturezaCredito'],
    );
  if (!credito && i.naturezaCredito !== null)
    return recusaFin(
      'natureza-credito-indevida',
      `Item ${i.sequencia}: sem CST de crédito não há natureza da base do crédito.`,
      ['naturezaCredito'],
    );
  return null;
}

export type PendenciaFiscal = 'sem-cfop' | 'sem-cst-pis' | 'sem-cst-cofins' | 'sem-natureza-credito';

/** O que falta classificar no item (o que impede a geração do arquivo). */
export function pendenciasDoItem(i: ItemFiscalEntrada): PendenciaFiscal[] {
  const p: PendenciaFiscal[] = [];
  if (!cfopDeEntrada(i.cfop)) p.push('sem-cfop');
  if (!cstValido(i.cstPis)) p.push('sem-cst-pis');
  if (!cstValido(i.cstCofins)) p.push('sem-cst-cofins');
  if ((cstDaCredito(i.cstPis) || cstDaCredito(i.cstCofins)) && !i.naturezaCredito)
    p.push('sem-natureza-credito');
  return p;
}

/** O total do documento é a soma dos itens. */
export function totaisDoDocumento(itens: readonly { valorPis: number; valorCofins: number }[]): {
  valorPis: number;
  valorCofins: number;
} {
  return {
    valorPis: centavos(itens.reduce((s, i) => s + i.valorPis, 0)),
    valorCofins: centavos(itens.reduce((s, i) => s + i.valorCofins, 0)),
  };
}

export interface ItemEfd extends ItemFiscalEntrada {
  readonly codigoItem: string;
  readonly descricao: string | null;
  readonly quantidade: number;
  readonly unidade: string | null;
}
export interface DocumentoEfd {
  readonly id: number;
  /** Serviço tomado (bloco A) ou mercadoria (bloco C). */
  readonly servico: boolean;
  readonly participanteDocumento: string;
  readonly participanteNome: string;
  readonly modelo: string;
  readonly serie: string | null;
  readonly numero: string;
  readonly chave: string | null;
  readonly dataEmissao: string;
  readonly dataEntrada: string;
  /** Código de situação do documento: 00 regular, 02 cancelado... O cancelado vai sem itens e sem crédito. */
  readonly situacaoDocumento: string;
  readonly valorDocumento: number;
  readonly valorDesconto: number;
  readonly valorPis: number;
  readonly valorCofins: number;
  readonly itens: readonly ItemEfd[];
}

export interface LinhaApuracaoCredito {
  readonly natureza: string;
  readonly cst: string;
  readonly aliquota: number;
  readonly base: number;
  /** Soma do crédito dos itens. */
  readonly credito: number;
  readonly itens: number;
}
export interface ConferenciaEfd {
  readonly documentos: number;
  readonly itens: number;
  readonly pendencias: readonly { documento: number; sequencia: number; pendencia: PendenciaFiscal }[];
  readonly divergencias: readonly {
    documento: number;
    sequencia: number | null;
    codigo: 'credito-do-item' | 'total-do-documento' | 'documento-sem-item';
    tributo: 'pis' | 'cofins' | null;
    esperado: number;
    encontrado: number;
  }[];
  readonly pis: readonly LinhaApuracaoCredito[];
  readonly cofins: readonly LinhaApuracaoCredito[];
  readonly totalBasePis: number;
  readonly totalCreditoPis: number;
  readonly totalBaseCofins: number;
  readonly totalCreditoCofins: number;
  /** Sem pendência e sem divergência: o arquivo pode ser gerado. */
  readonly liberado: boolean;
}

const regular = (d: DocumentoEfd) => d.situacaoDocumento !== '02' && d.situacaoDocumento !== '03';
const difere = (a: number, b: number) => Math.abs(a - b) > 0.005;

function apurar(
  docs: readonly DocumentoEfd[],
  de: (i: ItemEfd) => { cst: string | null; base: number; aliquota: number | null; valor: number },
): LinhaApuracaoCredito[] {
  const m = new Map<string, { -readonly [K in keyof LinhaApuracaoCredito]: LinhaApuracaoCredito[K] }>();
  for (const d of docs.filter(regular))
    for (const i of d.itens) {
      const t = de(i);
      if (!cstDaCredito(t.cst) || !(t.base > 0)) continue;
      const natureza = i.naturezaCredito ?? '';
      const aliquota = t.aliquota ?? 0;
      const k = `${natureza}|${String(t.cst)}|${aliquota.toFixed(4)}`;
      const x = m.get(k) ?? { natureza, cst: String(t.cst), aliquota, base: 0, credito: 0, itens: 0 };
      x.base = centavos(x.base + t.base);
      x.credito = centavos(x.credito + t.valor);
      x.itens += 1;
      m.set(k, x);
    }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

/** A conferência das somas da competência, antes de gerar e de entregar. */
export function conferirSomasEfd(docs: readonly DocumentoEfd[]): ConferenciaEfd {
  const pendencias: ConferenciaEfd['pendencias'][number][] = [];
  const divergencias: ConferenciaEfd['divergencias'][number][] = [];
  let itens = 0;
  for (const d of docs.filter(regular)) {
    if (d.itens.length === 0)
      divergencias.push({
        documento: d.id,
        sequencia: null,
        codigo: 'documento-sem-item',
        tributo: null,
        esperado: 1,
        encontrado: 0,
      });
    for (const i of d.itens) {
      itens += 1;
      for (const p of pendenciasDoItem(i))
        pendencias.push({ documento: d.id, sequencia: i.sequencia, pendencia: p });
      const pis = cstDaCredito(i.cstPis) ? creditoDoItem(i.basePis, i.aliquotaPis) : 0;
      const cofins = cstDaCredito(i.cstCofins) ? creditoDoItem(i.baseCofins, i.aliquotaCofins) : 0;
      if (difere(pis, i.valorPis))
        divergencias.push({
          documento: d.id,
          sequencia: i.sequencia,
          codigo: 'credito-do-item',
          tributo: 'pis',
          esperado: pis,
          encontrado: i.valorPis,
        });
      if (difere(cofins, i.valorCofins))
        divergencias.push({
          documento: d.id,
          sequencia: i.sequencia,
          codigo: 'credito-do-item',
          tributo: 'cofins',
          esperado: cofins,
          encontrado: i.valorCofins,
        });
    }
    const t = totaisDoDocumento(d.itens);
    if (difere(t.valorPis, d.valorPis))
      divergencias.push({
        documento: d.id,
        sequencia: null,
        codigo: 'total-do-documento',
        tributo: 'pis',
        esperado: t.valorPis,
        encontrado: d.valorPis,
      });
    if (difere(t.valorCofins, d.valorCofins))
      divergencias.push({
        documento: d.id,
        sequencia: null,
        codigo: 'total-do-documento',
        tributo: 'cofins',
        esperado: t.valorCofins,
        encontrado: d.valorCofins,
      });
  }
  const pis = apurar(docs, (i) => ({
    cst: i.cstPis,
    base: i.basePis,
    aliquota: i.aliquotaPis,
    valor: i.valorPis,
  }));
  const cofins = apurar(docs, (i) => ({
    cst: i.cstCofins,
    base: i.baseCofins,
    aliquota: i.aliquotaCofins,
    valor: i.valorCofins,
  }));
  const soma = (xs: readonly LinhaApuracaoCredito[], c: 'base' | 'credito') =>
    centavos(xs.reduce((s, x) => s + x[c], 0));
  return {
    documentos: docs.length,
    itens,
    pendencias,
    divergencias,
    pis,
    cofins,
    totalBasePis: soma(pis, 'base'),
    totalCreditoPis: soma(pis, 'credito'),
    totalBaseCofins: soma(cofins, 'base'),
    totalCreditoCofins: soma(cofins, 'credito'),
    liberado: pendencias.length === 0 && divergencias.length === 0,
  };
}

export interface DeclaranteEfd {
  readonly cnpj: string;
  readonly nome: string;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
  readonly inscricaoEstadual: string | null;
  readonly inscricaoMunicipal: string | null;
}
export interface PedidoEfd {
  readonly declarante: DeclaranteEfd;
  /** AAAA-MM. */
  readonly periodo: string;
  readonly regime: RegimeEfd;
  /** Recibo do arquivo entregue que este retifica (nulo no original). */
  readonly reciboAnterior: string | null;
  readonly documentos: readonly DocumentoEfd[];
  /** As notas de serviço emitidas na competência (o lado das receitas: blocos A, M200/M210 e M600/M610). */
  readonly receitas?: readonly ReceitaServicoEfd[];
}

/** A apuração da contribuição do pedido: a receita das notas, menos o crédito conferido das entradas. */
export const apuracaoDoPedido = (p: PedidoEfd, c: ConferenciaEfd): ApuracaoReceitas =>
  apurarContribuicoes(p.regime, p.receitas ?? [], { pis: c.totalCreditoPis, cofins: c.totalCreditoCofins });

/** O arquivo só sai da competência conferida, com o declarante identificado e o regime coerente com os créditos. */
export function conferirGeracaoEfd(p: PedidoEfd, c: ConferenciaEfd): RecusaFinanceiro | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.periodo))
    return recusaFin('competencia-invalida', 'A competência é AAAA-MM.', ['periodo']);
  if (so(p.declarante.cnpj).length !== 14)
    return recusaFin(
      'declarante-sem-cnpj',
      'O estabelecimento não tem CNPJ no cadastro: a EFD-Contribuições é entregue pelo CNPJ.',
    );
  const receitas = p.receitas ?? [];
  if (c.documentos === 0 && !receitas.some((r) => r.situacao === 'autorizada'))
    return recusaFin(
      'competencia-sem-entrada',
      'Não há entrada escriturada nem nota de serviço autorizada nesta competência.',
      ['periodo'],
    );
  const aguardando = receitas.filter((r) => r.situacao !== 'autorizada').length;
  if (aguardando > 0)
    return recusaFin(
      'receita-pendente',
      `Há ${aguardando} nota(s) de serviço da competência aguardando a autorização: a receita do mês ficaria incompleta.`,
    );
  if (c.pendencias.length > 0)
    return recusaFin(
      'escrituracao-pendente',
      `Há ${c.pendencias.length} pendência(s) de classificação fiscal nos itens: classifique antes de gerar.`,
    );
  if (c.divergencias.length > 0)
    return recusaFin(
      'somas-divergentes',
      `A conferência achou ${c.divergencias.length} divergência(s) de soma: corrija antes de gerar.`,
    );
  if (p.regime === 'cumulativo' && (c.totalCreditoPis > 0 || c.totalCreditoCofins > 0))
    return recusaFin(
      'credito-no-regime-cumulativo',
      'O regime cumulativo não apura crédito de PIS e COFINS: reveja o regime ou os CST das entradas.',
      ['regime'],
    );
  return null;
}

const so = (s: string) => s.replace(/\D/g, '');
const v2 = (n: number) => centavos(n).toFixed(2).replace('.', ',');
const v4 = (n: number | null) => (n === null ? '' : n.toFixed(4).replace('.', ','));
const dia = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const limpo = (s: string | null) => (s ?? '').replace(/[|\r\n]/g, ' ').trim();
/** Tipo do crédito (tabela 4.3.6): 101 alíquota básica; 106 presumido. */
const tipoCredito = (cst: string) => (cst >= '60' ? '106' : '101');

export interface ArquivoEfdContribuicoes {
  readonly conteudo: string;
  readonly linhas: number;
  readonly registros: Readonly<Record<string, number>>;
  readonly conferencia: ConferenciaEfd;
  /** A contribuição apurada sobre a receita, com o crédito descontado e a retenção. */
  readonly apuracao: ApuracaoReceitas;
}

/**
 * O arquivo da EFD-Contribuições da competência. Determinístico: os mesmos dados dão o mesmo texto (o hash confere o
 * que foi entregue). Chame depois de conferirGeracaoEfd.
 */
export function montarEfdContribuicoes(p: PedidoEfd): ArquivoEfdContribuicoes {
  const conferencia = conferirSomasEfd(p.documentos);
  const [ano, mes] = p.periodo.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const cnpj = so(p.declarante.cnpj);
  const linhas: string[] = [];
  const contagem: Record<string, number> = {};
  const r = (...campos: (string | number)[]) => {
    const reg = String(campos[0]);
    contagem[reg] = (contagem[reg] ?? 0) + 1;
    linhas.push(`|${campos.join('|')}|`);
  };
  const bloco = (letra: string, de: number) => r(`${letra}990`, linhas.length - de + 2);
  const docs = [...p.documentos].sort((a, b) => a.dataEntrada.localeCompare(b.dataEntrada) || a.id - b.id);

  // Bloco 0: abertura, regime de apuração, estabelecimento e participantes.
  r(
    '0000',
    '006',
    p.reciboAnterior ? 1 : 0,
    '',
    p.reciboAnterior ?? '',
    `01${String(mes).padStart(2, '0')}${ano}`,
    `${String(ultimo).padStart(2, '0')}${String(mes).padStart(2, '0')}${ano}`,
    limpo(p.declarante.nome),
    cnpj,
    p.declarante.uf ?? '',
    p.declarante.codigoMunicipio ?? '',
    '',
    '00',
    '2',
  );
  r('0001', 0);
  // Incidência: 1 não cumulativo, 2 cumulativo, 3 os dois; apropriação direta do crédito quando há não cumulativo.
  r(
    '0110',
    p.regime === 'nao_cumulativo' ? 1 : p.regime === 'cumulativo' ? 2 : 3,
    p.regime === 'cumulativo' ? '' : 1,
    1,
    // Regime cumulativo escriturado documento a documento (bloco A), não consolidado.
    p.regime === 'cumulativo' ? 9 : '',
  );
  r(
    '0140',
    cnpj,
    limpo(p.declarante.nome),
    cnpj,
    p.declarante.uf ?? '',
    limpo(p.declarante.inscricaoEstadual),
    p.declarante.codigoMunicipio ?? '',
    limpo(p.declarante.inscricaoMunicipal),
    '',
  );
  const participantes = new Map<string, string>();
  for (const d of docs) participantes.set(so(d.participanteDocumento), d.participanteNome);
  // O tomador pessoa jurídica é participante; a pessoa física não vai ao arquivo (o A100 dispensa o participante).
  const receitas = [...(p.receitas ?? [])]
    .filter((x) => x.situacao === 'autorizada')
    .sort((a, b) => a.dataEmissao.localeCompare(b.dataEmissao) || a.id - b.id);
  const tomador = (x: ReceitaServicoEfd) =>
    x.tipoTomador === 'pessoa_juridica' && x.tomadorDocumento ? so(x.tomadorDocumento) : '';
  for (const x of receitas) if (tomador(x)) participantes.set(tomador(x), x.tomadorNome);
  for (const [doc, nome] of [...participantes.entries()].sort(([a], [b]) => a.localeCompare(b)))
    r(
      '0150',
      doc,
      limpo(nome),
      '01058',
      doc.length === 14 ? doc : '',
      doc.length === 11 ? doc : '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    );
  bloco('0', 1);

  // Bloco A: serviços tomados com direito a crédito e serviços prestados (a receita das notas emitidas).
  const servicos = docs.filter((d) => d.servico);
  const apuracao = apuracaoDoPedido(p, conferencia);
  let inicio = linhas.length + 1;
  r('A001', servicos.length || receitas.length ? 0 : 1);
  if (servicos.length || receitas.length) r('A010', cnpj);
  for (const d of servicos) {
    const vale = regular(d);
    const its = vale ? d.itens : [];
    r(
      'A100',
      0,
      1,
      so(d.participanteDocumento),
      d.situacaoDocumento,
      limpo(d.serie),
      '',
      limpo(d.numero),
      d.chave ?? '',
      dia(d.dataEmissao),
      dia(d.dataEntrada),
      v2(d.valorDocumento),
      9,
      v2(d.valorDesconto),
      v2(its.reduce((s, i) => s + i.basePis, 0)),
      v2(vale ? d.valorPis : 0),
      v2(its.reduce((s, i) => s + i.baseCofins, 0)),
      v2(vale ? d.valorCofins : 0),
      '',
      '',
      '',
    );
    for (const i of its)
      r(
        'A170',
        i.sequencia,
        limpo(i.codigoItem),
        limpo(i.descricao),
        v2(i.valorItem),
        v2(i.valorDesconto),
        i.naturezaCredito ?? '',
        0,
        i.cstPis ?? '',
        v2(i.basePis),
        v4(i.aliquotaPis),
        v2(i.valorPis),
        i.cstCofins ?? '',
        v2(i.baseCofins),
        v4(i.aliquotaCofins),
        v2(i.valorCofins),
        '',
        '',
      );
  }
  for (const x of receitas) {
    const base = baseDaReceita(x);
    const pis = contribuicaoDaNota(x, apuracao.pis.aliquota);
    const cofins = contribuicaoDaNota(x, apuracao.cofins.aliquota);
    r(
      'A100',
      1,
      0,
      tomador(x),
      '00',
      limpo(x.serie),
      '',
      limpo(x.numero),
      x.chave ?? '',
      dia(x.dataEmissao),
      dia(x.dataEmissao),
      v2(x.valorServicos),
      9,
      v2(x.valorDesconto),
      v2(base),
      v2(pis),
      v2(base),
      v2(cofins),
      v2(x.pisRetido),
      v2(x.cofinsRetido),
      v2(x.valorIss),
    );
    r(
      'A170',
      1,
      'SERVICO-SAUDE',
      'SERVICOS DE SAUDE',
      v2(x.valorServicos),
      v2(x.valorDesconto),
      '',
      '',
      CST_RECEITA_TRIBUTADA,
      v2(base),
      v4(apuracao.pis.aliquota),
      v2(pis),
      CST_RECEITA_TRIBUTADA,
      v2(base),
      v4(apuracao.cofins.aliquota),
      v2(cofins),
      '',
      '',
    );
  }
  bloco('A', inicio);

  // Bloco C: mercadorias (o documento cancelado vai só com o cabeçalho, sem valor nem item).
  const mercadorias = docs.filter((d) => !d.servico);
  inicio = linhas.length + 1;
  r('C001', mercadorias.length ? 0 : 1);
  if (mercadorias.length) r('C010', cnpj, 2);
  for (const d of mercadorias) {
    if (!regular(d)) {
      r(
        'C100',
        0,
        1,
        so(d.participanteDocumento),
        d.modelo,
        d.situacaoDocumento,
        limpo(d.serie),
        limpo(d.numero),
        d.chave ?? '',
        ...Array.from({ length: 21 }, () => ''),
      );
      continue;
    }
    r(
      'C100',
      0,
      1,
      so(d.participanteDocumento),
      d.modelo,
      d.situacaoDocumento,
      limpo(d.serie),
      limpo(d.numero),
      d.chave ?? '',
      dia(d.dataEmissao),
      dia(d.dataEntrada),
      v2(d.valorDocumento),
      9,
      v2(d.valorDesconto),
      '',
      v2(d.itens.reduce((s, i) => s + i.valorItem, 0)),
      9,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      v2(d.valorPis),
      v2(d.valorCofins),
      '',
      '',
    );
    for (const i of d.itens)
      r(
        'C170',
        i.sequencia,
        limpo(i.codigoItem),
        limpo(i.descricao),
        i.quantidade.toFixed(4).replace('.', ','),
        limpo(i.unidade),
        v2(i.valorItem),
        v2(i.valorDesconto),
        0,
        '',
        i.cfop ?? '',
        '',
        ...Array.from({ length: 12 }, () => ''),
        i.cstPis ?? '',
        v2(i.basePis),
        v4(i.aliquotaPis),
        '',
        '',
        v2(i.valorPis),
        i.cstCofins ?? '',
        v2(i.baseCofins),
        v4(i.aliquotaCofins),
        '',
        '',
        v2(i.valorCofins),
        '',
      );
  }
  bloco('C', inicio);

  // Bloco M: o crédito por tipo e alíquota (M100, M500) com a base por natureza e CST (M105, M505), e a contribuição
  // apurada sobre a receita (M200/M210, M600/M610). O crédito desconta só a contribuição não cumulativa, até ela; o que
  // não desconta fica como saldo da linha (desconto parcial).
  inicio = linhas.length + 1;
  const haCredito = conferencia.pis.length + conferencia.cofins.length > 0;
  const blocoM = haCredito || receitas.length > 0;
  r('M001', blocoM ? 0 : 1);
  const credito = (
    reg: 'M100' | 'M500',
    det: 'M105' | 'M505',
    xs: readonly LinhaApuracaoCredito[],
    descontado: number,
  ) => {
    const grupos = new Map<string, LinhaApuracaoCredito[]>();
    for (const x of xs) {
      const k = `${tipoCredito(x.cst)}|${x.aliquota.toFixed(4)}`;
      grupos.set(k, [...(grupos.get(k) ?? []), x]);
    }
    const ordem = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b));
    const valores = ordem.map(([, g]) => centavos(g.reduce((s, x) => s + x.credito, 0)));
    const uso = repartirCreditoDescontado(valores, descontado);
    for (const [n, [k, g]] of ordem.entries()) {
      const base = centavos(g.reduce((s, x) => s + x.base, 0));
      const valor = valores[n]!;
      const u = uso[n]!;
      r(
        reg,
        k.split('|')[0]!,
        0,
        v2(base),
        v4(g[0]!.aliquota),
        '',
        '',
        v2(valor),
        v2(0),
        v2(0),
        v2(0),
        v2(valor),
        u.saldo > 0 ? 1 : 0,
        v2(u.descontado),
        v2(u.saldo),
      );
      for (const x of g) r(det, x.natureza, x.cst, v2(x.base), '', v2(x.base), v2(x.base), '', '', '');
    }
  };
  const contribuicao = (reg: 'M200' | 'M600', det: 'M210' | 'M610', t: ApuracaoReceitas['pis']) => {
    if (!blocoM) return;
    const nc = apuracao.regimeReceita === 'nao_cumulativo';
    const devidaNc = nc ? centavos(t.apurada - t.creditoDescontado) : 0;
    r(
      reg,
      v2(nc ? t.apurada : 0),
      v2(t.creditoDescontado),
      v2(0),
      v2(devidaNc),
      v2(nc ? t.retencaoDescontada : 0),
      v2(0),
      v2(nc ? t.aRecolher : 0),
      v2(nc ? 0 : t.apurada),
      v2(nc ? 0 : t.retencaoDescontada),
      v2(0),
      v2(nc ? 0 : t.aRecolher),
      v2(t.aRecolher),
    );
    if (t.base > 0)
      r(
        det,
        t.codigoContribuicao,
        v2(t.receitaBruta),
        v2(t.base),
        v2(0),
        v2(0),
        v2(t.base),
        v4(t.aliquota),
        '',
        '',
        v2(t.apurada),
        v2(0),
        v2(0),
        v2(0),
        v2(0),
        v2(t.apurada),
      );
  };
  credito('M100', 'M105', conferencia.pis, apuracao.pis.creditoDescontado);
  contribuicao('M200', 'M210', apuracao.pis);
  credito('M500', 'M505', conferencia.cofins, apuracao.cofins.creditoDescontado);
  contribuicao('M600', 'M610', apuracao.cofins);
  bloco('M', inicio);

  // Bloco 9: a contagem de cada registro e o total de linhas do arquivo.
  const antes = linhas.length;
  r('9001', 0);
  const regs: Record<string, number> = { ...contagem, '9990': 1, '9999': 1 };
  regs['9900'] = Object.keys(regs).length + 1;
  for (const reg of Object.keys(regs).sort()) linhas.push(`|9900|${reg}|${regs[reg]!}|`);
  // O 9990 conta o bloco 9 inteiro, com ele mesmo e o 9999 que vem depois.
  linhas.push(`|9990|${linhas.length - antes + 2}|`);
  linhas.push(`|9999|${linhas.length + 1}|`);
  Object.assign(contagem, regs);
  return {
    conteudo: `${linhas.join('\r\n')}\r\n`,
    linhas: linhas.length,
    registros: contagem,
    conferencia,
    apuracao,
  };
}

/** A entrega é registrada com o recibo do programa da Receita; só o arquivo gerado ou validado é entregue. */
export function conferirEntregaEfd(situacao: string, recibo: string): RecusaFinanceiro | null {
  if (situacao !== 'gerado' && situacao !== 'validado')
    return recusaFin('arquivo-nao-entregavel', 'Só o arquivo gerado ou validado recebe o recibo da entrega.');
  if (!/^[0-9A-Za-z.-]{6,60}$/.test(recibo.trim()))
    return recusaFin('recibo-invalido', 'Informe o número do recibo da entrega (6 a 60 caracteres).', [
      'recibo',
    ]);
  return null;
}
