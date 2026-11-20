// Regras do OPME (ficha do M46, etapa 3; regras 6 a 9 e 13): a solicitação ligada à agenda, a máquina de estados das
// etapas (cotação, autorização da operadora, pedido, consignação, esterilização, consumo, devolução, nota fiscal), o
// consumo em sala com o rastreio por lote ou série, a devolução do não usado, a conciliação com a conta (o indicador
// "OPME usado sem cobrança", com o numerador e o denominador) e a leitura do código GS1 da embalagem. Funções puras: o
// adaptador do banco confere de novo na transação, a API antes de gravar e a tela antes de enviar.
import type { EtapaOpme, SituacaoConciliacaoOpme, SituacaoOpme } from '../opme-vocabulario.js';
import { CLASSE_OPME } from '../opme-vocabulario.js';
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

// ── Solicitação (regra 6) ───────────────────────────────────────────────────────────────────────────────────────

export interface SolicitacaoParaConferir {
  /** A classe do item no cadastro (TBCLASSI): só a classe de OPME. */
  readonly classeItem: number | null;
  readonly tuss: string;
  readonly quantidade: number;
  readonly justificativa: string;
  /** O agendamento existe e não está cancelado nem realizado (a solicitação é antes da cirurgia). */
  readonly agendamento: 'aberto' | 'inexistente' | 'cancelado' | 'realizado';
}

/** Regra 6: a solicitação nasce ligada à agenda, com o item de OPME, o TUSS, a quantidade e a justificativa. */
export function conferirSolicitacaoOpme(s: SolicitacaoParaConferir): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (s.agendamento === 'inexistente')
    r.push(recusa('agendamento-inexistente', 'O agendamento da cirurgia não existe mais.', ['agendamento']));
  else if (s.agendamento !== 'aberto')
    r.push(
      recusa(
        'agendamento-encerrado',
        s.agendamento === 'cancelado'
          ? 'O agendamento da cirurgia foi cancelado: não é possível pedir OPME para ele.'
          : 'A cirurgia já foi realizada: o OPME usado é registrado no consumo em sala.',
        ['agendamento'],
      ),
    );
  if (s.classeItem === null) r.push(recusa('item-inexistente', 'O item não está no cadastro.', ['item']));
  else if (s.classeItem !== CLASSE_OPME)
    r.push(recusa('item-nao-opme', 'O item não é da classe de OPME no cadastro de itens.', ['item']));
  if (!/^\d{8}$/.test(s.tuss.trim()))
    r.push(recusa('tuss-invalido', 'Informe o código TUSS do material (oito dígitos).', ['tuss']));
  if (!(s.quantidade > 0))
    r.push(recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', ['quantidade']));
  if (s.justificativa.trim().length < 10)
    r.push(
      recusa('sem-justificativa', 'Escreva a justificativa clínica (ao menos 10 caracteres).', [
        'justificativa',
      ]),
    );
  return r;
}

// ── Etapas (a máquina de estados) ───────────────────────────────────────────────────────────────────────────────

/** As etapas aceitas em cada situação (as do consumo e da devolução nascem dos documentos do estoque). */
export const ETAPAS_POR_SITUACAO: Readonly<Record<SituacaoOpme, readonly EtapaOpme[]>> = {
  solicitada: ['cotacao', 'autorizacao', 'negativa', 'cancelamento', 'consumo'],
  cotacao: ['autorizacao', 'negativa', 'cancelamento', 'consumo'],
  autorizada: ['pedido', 'consignacao', 'cme', 'consumo', 'cancelamento'],
  pedido: ['nf', 'consignacao', 'cme', 'consumo', 'cancelamento'],
  consignada: ['cme', 'consumo', 'nf', 'cancelamento'],
  cme: ['consumo', 'nf', 'cancelamento'],
  consumida: ['consumo', 'devolucao', 'nf'],
  devolvida: ['consumo', 'devolucao', 'nf'],
  faturada: [],
  negada: [],
  cancelada: [],
};

/** As situações em que a solicitação está autorizada pela operadora (o consumo não pede a exceção). */
export const SITUACOES_AUTORIZADAS: ReadonlySet<SituacaoOpme> = new Set([
  'autorizada',
  'pedido',
  'consignada',
  'cme',
  'consumida',
  'devolvida',
]);

export interface EtapaParaConferir {
  readonly situacao: SituacaoOpme;
  readonly etapa: EtapaOpme;
  readonly quantidadeSolicitada: number;
  /** A quantidade da etapa (a autorizada, na autorização). */
  readonly quantidade: number | null;
  readonly senha: string | null;
  readonly guia: string | null;
  /** AAAA-MM-DD (a validade da senha). */
  readonly validade: string | null;
  readonly hoje: string;
  readonly fornecedor: number | null;
  readonly pedido: { ano: number; doc: number } | null;
  readonly nf: { ano: number; mes: number; doc: number } | null;
  readonly observacao: string | null;
}

/** A etapa é aceita na situação, com os dados que ela exige. */
export function conferirEtapaOpme(e: EtapaParaConferir): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!ETAPAS_POR_SITUACAO[e.situacao].includes(e.etapa)) {
    r.push(
      recusa(
        'etapa-fora-de-ordem',
        e.situacao === 'negada' || e.situacao === 'cancelada' || e.situacao === 'faturada'
          ? 'A solicitação está encerrada: abra uma nova se precisar.'
          : 'Esta etapa não cabe na situação atual da solicitação.',
        ['etapa'],
      ),
    );
    return r;
  }
  switch (e.etapa) {
    case 'autorizacao': {
      if (!e.senha?.trim())
        r.push(recusa('sem-senha', 'Informe a senha da autorização da operadora.', ['senha']));
      if (!e.guia?.trim()) r.push(recusa('sem-guia', 'Informe o número da guia da operadora.', ['guia']));
      if (!(e.quantidade !== null && e.quantidade > 0))
        r.push(recusa('quantidade-invalida', 'Informe a quantidade autorizada.', ['quantidade']));
      else if (qtd3(e.quantidade) > qtd3(e.quantidadeSolicitada))
        r.push(
          recusa('autorizada-maior', 'A quantidade autorizada é maior que a solicitada.', ['quantidade']),
        );
      if (e.validade && e.validade < e.hoje)
        r.push(recusa('senha-vencida', 'A validade da senha já passou.', ['validade']));
      break;
    }
    case 'negativa':
    case 'cancelamento':
      if ((e.observacao ?? '').trim().length < 10)
        r.push(recusa('sem-motivo', 'Escreva o motivo (ao menos 10 caracteres).', ['observacao']));
      break;
    case 'pedido':
      if (!e.pedido) r.push(recusa('sem-pedido', 'Informe o pedido de compra (ano e número).', ['pedido']));
      break;
    case 'consignacao':
      if (!e.fornecedor)
        r.push(
          recusa('sem-fornecedor', 'Informe o fornecedor que deixou o material em consignação.', [
            'fornecedor',
          ]),
        );
      break;
    case 'nf':
      if (!e.nf) r.push(recusa('sem-nf', 'Informe a nota fiscal (ano, mês e número).', ['nf']));
      break;
    default:
      break;
  }
  return r;
}

export interface QuantidadesOpme {
  readonly autorizada: number;
  readonly consumida: number;
  readonly devolvida: number;
}

/** A situação depois da etapa (a etapa já conferida). */
export function situacaoDepoisDaEtapa(
  situacao: SituacaoOpme,
  etapa: EtapaOpme,
  q: QuantidadesOpme,
): SituacaoOpme {
  switch (etapa) {
    case 'cotacao':
      return 'cotacao';
    case 'autorizacao':
      return 'autorizada';
    case 'negativa':
      return 'negada';
    case 'pedido':
      return 'pedido';
    case 'consignacao':
      return 'consignada';
    case 'cme':
      return 'cme';
    case 'consumo':
    case 'devolucao':
      return qtd3(q.consumida - q.devolvida) > 0 ? 'consumida' : 'devolvida';
    case 'nf':
      return situacao === 'consumida' || situacao === 'devolvida' ? 'faturada' : situacao;
    case 'cancelamento':
      return 'cancelada';
    default:
      return situacao;
  }
}

// ── Consumo em sala (regras 6 e 7) ──────────────────────────────────────────────────────────────────────────────

export interface ConsumoParaConferir {
  /** A solicitação ligada (null: consumo sem solicitação, só com a exceção). */
  readonly solicitacao: (QuantidadesOpme & { readonly situacao: SituacaoOpme; readonly item: number }) | null;
  readonly item: number;
  readonly classeItem: number | null;
  readonly quantidade: number;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly fabricante: string;
  readonly registroAnvisa: string;
  /** AAAA-MM-DD (a validade da embalagem; null quando a embalagem não traz). */
  readonly validade: string | null;
  readonly hoje: string;
  /** A justificativa da exceção (consumo sem a autorização da operadora). */
  readonly justificativa: string | null;
  /** Quem registra pode registrar a exceção (supervisor). */
  readonly podeExcecao: boolean;
}

/** A justificativa do supervisor é exigida (consumo sem autorização da operadora)? */
export function consumoExigeExcecao(s: ConsumoParaConferir['solicitacao']): boolean {
  return s === null || !SITUACOES_AUTORIZADAS.has(s.situacao);
}

/** Regras 6 e 7: o consumo do item de OPME com o rastreio e a autorização (ou a exceção registrada). */
export function conferirConsumoOpme(c: ConsumoParaConferir): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (c.classeItem === null) r.push(recusa('item-inexistente', 'O item não está no cadastro.', ['item']));
  else if (c.classeItem !== CLASSE_OPME)
    r.push(recusa('item-nao-opme', 'O item não é da classe de OPME no cadastro de itens.', ['item']));
  if (!(c.quantidade > 0))
    r.push(recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', ['quantidade']));
  if (!c.lote?.trim() && !c.serie?.trim())
    r.push(
      recusa('sem-rastreio', 'Informe o lote ou o número de série da embalagem (rastreio para recall).', [
        'lote',
        'serie',
      ]),
    );
  if (c.fabricante.trim().length < 2)
    r.push(recusa('sem-fabricante', 'Informe o fabricante.', ['fabricante']));
  if (!/^\d{7,13}$/.test(c.registroAnvisa.replace(/\D/g, '')))
    r.push(
      recusa('anvisa-invalido', 'Informe o registro na Anvisa (de 7 a 13 dígitos).', ['registroAnvisa']),
    );
  if (c.validade && c.validade < c.hoje)
    r.push(recusa('opme-vencido', 'A validade da embalagem já passou: não use o material.', ['validade']));
  const s = c.solicitacao;
  if (s) {
    if (s.item !== c.item)
      r.push(recusa('item-da-solicitacao', 'O item lido não é o da solicitação.', ['item']));
    if (s.situacao === 'negada' || s.situacao === 'cancelada' || s.situacao === 'faturada')
      r.push(
        recusa(
          'solicitacao-encerrada',
          s.situacao === 'negada'
            ? 'A operadora negou esta solicitação: registre o consumo sem solicitação, com a justificativa do supervisor.'
            : 'A solicitação está encerrada.',
          ['solicitacao'],
        ),
      );
    else if (
      SITUACOES_AUTORIZADAS.has(s.situacao) &&
      qtd3(s.consumida - s.devolvida + c.quantidade) > qtd3(s.autorizada)
    )
      r.push(
        recusa(
          'acima-do-autorizado',
          `A quantidade passa da autorizada pela operadora (${qtd3(s.autorizada)}): o excedente vai sem solicitação, com a justificativa do supervisor.`,
          ['quantidade'],
        ),
      );
  }
  if (consumoExigeExcecao(s) && r.every((x) => x.codigo !== 'solicitacao-encerrada')) {
    if (!c.podeExcecao)
      r.push(
        recusa(
          'sem-autorizacao',
          'O OPME não tem a autorização da operadora: só o supervisor registra o consumo, com a justificativa.',
          ['solicitacao'],
        ),
      );
    else if ((c.justificativa ?? '').trim().length < 10)
      r.push(
        recusa(
          'sem-justificativa',
          'Escreva a justificativa do consumo sem autorização (ao menos 10 caracteres).',
          ['justificativa'],
        ),
      );
  }
  return r;
}

/** A devolução do não usado: até o consumido menos o já devolvido daquele consumo. */
export function conferirDevolucaoOpme(c: {
  readonly consumida: number;
  readonly devolvida: number;
  readonly quantidade: number;
  readonly motivo: string;
}): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!(c.quantidade > 0))
    r.push(recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', ['quantidade']));
  else if (qtd3(c.devolvida + c.quantidade) > qtd3(c.consumida))
    r.push(
      recusa(
        'devolucao-maior',
        `A devolução passa do que foi consumido (${qtd3(c.consumida - c.devolvida)} ainda pode voltar).`,
        ['quantidade'],
      ),
    );
  if (c.motivo.trim().length < 10)
    r.push(
      recusa('sem-motivo', 'Escreva por que o material não foi usado (ao menos 10 caracteres).', ['motivo']),
    );
  return r;
}

// ── Conciliação com a conta (regra 9) ───────────────────────────────────────────────────────────────────────────

export interface ConsumoParaConciliar {
  readonly id: number;
  /** A conta do paciente (o número da conta do período). */
  readonly conta: number;
  readonly item: number;
  readonly quantidade: number;
  readonly devolvida: number;
}

export interface ItemDaConta {
  readonly conta: number;
  /** O item do estoque lançado na conta (o código do procedimento do lançamento). */
  readonly item: number;
  readonly quantidade: number;
}

export interface LinhaConciliada {
  readonly id: number;
  readonly usada: number;
  readonly naConta: number;
  readonly situacao: SituacaoConciliacaoOpme;
}

export interface IndicadorSemCobranca {
  /** Consumos (com uso líquido) sem nenhum item correspondente na conta. */
  readonly numerador: number;
  /** Consumos com uso líquido (o consumido menos o devolvido maior que zero). */
  readonly denominador: number;
  /** numerador / denominador × 100, com uma casa (null sem consumo). */
  readonly percentual: number | null;
}

/**
 * Regra 9: cada consumo contra os itens da conta do mesmo paciente e item. Vários consumos do mesmo item na mesma conta
 * dividem a quantidade lançada na ordem do consumo (o primeiro leva primeiro). O indicador "OPME usado sem cobrança"
 * conta os consumos sem nada correspondente na conta, com o numerador e o denominador.
 */
export function conciliarOpme(
  consumos: readonly ConsumoParaConciliar[],
  itensConta: readonly ItemDaConta[],
): { linhas: LinhaConciliada[]; indicador: IndicadorSemCobranca } {
  const saldo = new Map<string, number>();
  for (const i of itensConta) {
    const k = `${i.conta}:${i.item}`;
    saldo.set(k, qtd3((saldo.get(k) ?? 0) + i.quantidade));
  }
  const ordenados = [...consumos].sort((a, b) => a.id - b.id);
  const porId = new Map<number, LinhaConciliada>();
  // Quantas linhas de cada conta e item: a última leva o que sobrar (o "cobrado a mais").
  const restantes = new Map<string, number>();
  for (const c of ordenados) {
    const k = `${c.conta}:${c.item}`;
    if (qtd3(c.quantidade - c.devolvida) > 0) restantes.set(k, (restantes.get(k) ?? 0) + 1);
  }
  for (const c of ordenados) {
    const usada = qtd3(c.quantidade - c.devolvida);
    const k = `${c.conta}:${c.item}`;
    if (usada <= 0) {
      porId.set(c.id, { id: c.id, usada: 0, naConta: 0, situacao: 'devolvido' });
      continue;
    }
    const disponivel = saldo.get(k) ?? 0;
    const falta = (restantes.get(k) ?? 1) - 1;
    restantes.set(k, falta);
    const naConta = falta === 0 ? disponivel : Math.min(disponivel, usada);
    saldo.set(k, qtd3(disponivel - naConta));
    const situacao: SituacaoConciliacaoOpme =
      naConta <= 0
        ? 'sem-cobranca'
        : qtd3(naConta) < usada
          ? 'cobranca-menor'
          : qtd3(naConta) > usada
            ? 'cobranca-maior'
            : 'conciliado';
    porId.set(c.id, { id: c.id, usada, naConta: qtd3(naConta), situacao });
  }
  const linhas = consumos.map((c) => porId.get(c.id) as LinhaConciliada);
  const comUso = linhas.filter((l) => l.usada > 0);
  const numerador = comUso.filter((l) => l.situacao === 'sem-cobranca').length;
  const denominador = comUso.length;
  return {
    linhas,
    indicador: {
      numerador,
      denominador,
      percentual: denominador === 0 ? null : Math.round((numerador / denominador) * 1000) / 10,
    },
  };
}

// ── Leitura do código da embalagem (GS1) ────────────────────────────────────────────────────────────────────────

export interface CodigoEmbalagemLido {
  readonly gtin: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  /** AAAA-MM-DD (o dia 00 do GS1 vira o último dia do mês). */
  readonly validade: string | null;
}

const AI_FIXOS: Readonly<Record<string, number>> = { '01': 14, '17': 6, '11': 6 };
const AI_VARIAVEIS = new Set(['10', '21']);

function validadeGs1(aammdd: string): string | null {
  if (!/^\d{6}$/.test(aammdd)) return null;
  const ano = 2000 + Number(aammdd.slice(0, 2));
  const mes = Number(aammdd.slice(2, 4));
  let dia = Number(aammdd.slice(4, 6));
  if (mes < 1 || mes > 12) return null;
  if (dia === 0) dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * O código GS1 lido da embalagem (DataMatrix ou GS1-128): os identificadores 01 (GTIN), 17 (validade), 10 (lote) e 21
 * (série), no formato com parênteses "(01)…(17)…" ou cru, com o separador GS (o leitor envia o FNC1 como o caractere 29).
 * Outros identificadores são ignorados; o que não for GS1 volta tudo nulo (a tela pede a digitação).
 */
export function lerCodigoEmbalagem(texto: string): CodigoEmbalagemLido {
  const vazio: CodigoEmbalagemLido = { gtin: null, lote: null, serie: null, validade: null };
  const t = texto.trim().replace(/^\][A-Za-z]\d/, '');
  if (!t) return vazio;
  const campos = new Map<string, string>();
  if (t.startsWith('(')) {
    for (const m of t.matchAll(/\((\d{2,4})\)([^(]*)/g)) campos.set(m[1] as string, (m[2] as string).trim());
  } else {
    let p = 0;
    const s = t.startsWith('\u001d') ? t.slice(1) : t;
    while (p < s.length) {
      const ai = s.slice(p, p + 2);
      p += 2;
      const fixo = AI_FIXOS[ai];
      if (fixo !== undefined) {
        campos.set(ai, s.slice(p, p + fixo));
        p += fixo;
      } else if (AI_VARIAVEIS.has(ai)) {
        const fim = s.indexOf('\u001d', p);
        campos.set(ai, s.slice(p, fim < 0 ? s.length : fim));
        p = fim < 0 ? s.length : fim + 1;
      } else break;
    }
  }
  const gtin = campos.get('01') ?? null;
  if (!gtin && !campos.has('10') && !campos.has('21')) return vazio;
  return {
    gtin: gtin && /^\d{14}$/.test(gtin) ? gtin : null,
    lote: campos.get('10')?.slice(0, 30) || null,
    serie: campos.get('21')?.slice(0, 40) || null,
    validade: campos.has('17') ? validadeGs1(campos.get('17') as string) : null,
  };
}
