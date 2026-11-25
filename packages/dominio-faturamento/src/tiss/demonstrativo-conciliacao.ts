// Conciliação item a item do demonstrativo da operadora e leitura do demonstrativo de pagamento (06-FAT linha 33,
// F3.7). Regras puras, sem banco:
// - casarItensDemonstrativo: cada linha do demonstrativo (de análise de conta ou digitada) casa com UM item da conta
//   do lote: primeiro pela guia (número da guia do prestador, número da conta ou id) e o sequencial do item; depois,
//   quando a guia não bate, pelo sequencial e o código do procedimento, só se houver um único candidato. Um item da
//   conta nunca casa duas vezes. O casado com código ou valor informado diferente do cobrado fica "divergente" (a
//   conferência mostra a diferença); o sem candidato fica "sem_correspondencia". A glosa da linha é o informado
//   menos o liberado (nunca negativa).
// - lerDemonstrativoPagamentoXml: o demonstrativoPagamento da TISS 04.03.00 (pagamentos por data: dados do
//   pagamento, resumo por protocolo, débitos e créditos). Nada de dado de pessoa é lido.
// - totaisDoPagamento: informado, processado, liberado, glosa, débitos, créditos e líquido (liberado menos débitos
//   mais créditos), em centavos inteiros para não acumular erro.
// - linhasPagamentoDosItens: na digitação, os itens agrupados por guia viram as linhas do demonstrativo de pagamento.
import type { ItemDemonstrativo } from '@sgh/contratos';
import { ErroDemonstrativo } from './demonstrativo.js';

export type SituacaoConciliacao = 'pendente' | 'conciliado' | 'sem_correspondencia' | 'divergente';

/** Item da conta do lote que pode casar com a linha do demonstrativo. */
export interface CandidatoConciliacao {
  readonly item: number;
  readonly conta: number;
  /** Números pelos quais a operadora pode citar a guia: o da guia do prestador, o número e o id da conta. */
  readonly guias: readonly string[];
  readonly sequencial: number;
  readonly codigo: string;
  readonly valorCobrado: number;
}

export interface LinhaConciliada {
  readonly item: number | null;
  readonly conta: number | null;
  readonly situacao: SituacaoConciliacao;
  readonly valorGlosa: number;
  /** Diferenças achadas no casamento (para a tela): código e valor informado. */
  readonly divergencias: readonly ('codigo' | 'valor')[];
}

const cent = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;
const limpo = (s: string) => s.trim().replace(/^0+(?=\d)/, '');

export function glosaDaLinha(valorInformado: number, valorPago: number): number {
  return reais(Math.max(0, cent(valorInformado) - cent(valorPago)));
}

export function casarItensDemonstrativo(
  linhas: readonly ItemDemonstrativo[],
  candidatos: readonly CandidatoConciliacao[],
): LinhaConciliada[] {
  const usados = new Set<number>();
  const livres = () => candidatos.filter((c) => !usados.has(c.item));
  return linhas.map((l) => {
    const guia = limpo(l.numeroGuia);
    const codigo = l.codigoProcedimento.trim();
    let alvo =
      guia !== ''
        ? livres().find((c) => c.sequencial === l.sequencial && c.guias.some((g) => limpo(g) === guia))
        : undefined;
    if (!alvo && codigo !== '') {
      const porCodigo = livres().filter((c) => c.sequencial === l.sequencial && c.codigo.trim() === codigo);
      if (porCodigo.length === 1) alvo = porCodigo[0];
    }
    const valorGlosa = glosaDaLinha(l.valorInformado, l.valorPago);
    if (!alvo)
      return { item: null, conta: null, situacao: 'sem_correspondencia', valorGlosa, divergencias: [] };
    usados.add(alvo.item);
    const divergencias: ('codigo' | 'valor')[] = [];
    if (codigo !== '' && alvo.codigo.trim() !== '' && alvo.codigo.trim() !== codigo)
      divergencias.push('codigo');
    if (cent(l.valorInformado) !== cent(alvo.valorCobrado)) divergencias.push('valor');
    return {
      item: alvo.item,
      conta: alvo.conta,
      situacao: divergencias.length ? 'divergente' : 'pendente',
      valorGlosa,
      divergencias,
    };
  });
}

/** Situação do cabeçalho do demonstrativo de análise depois do casamento. */
export function situacaoDoDemonstrativo(
  linhas: readonly { situacao: SituacaoConciliacao }[],
): 'importado' | 'conciliado' | 'com_divergencia' {
  if (linhas.some((l) => l.situacao === 'divergente' || l.situacao === 'sem_correspondencia'))
    return 'com_divergencia';
  return linhas.length > 0 && linhas.every((l) => l.situacao === 'conciliado') ? 'conciliado' : 'importado';
}

// ── Demonstrativo de pagamento ─────────────────────────────────────────────────────────────────────────

export interface LinhaPagamento {
  readonly numeroLote: string | null;
  readonly protocolo: string | null;
  readonly numeroGuia: string | null;
  readonly valorInformado: number;
  readonly valorProcessado: number;
  readonly valorLiberado: number;
  readonly valorGlosa: number;
}

export interface DeducaoPagamento {
  readonly natureza: 'debito' | 'credito';
  readonly codigo: string | null;
  readonly descricao: string;
  readonly valor: number;
  readonly dataPagamento: string | null;
}

export interface PagamentoLidoXml {
  readonly numero: string;
  readonly dataEmissao: string;
  readonly dataPagamento: string | null;
  readonly linhas: readonly LinhaPagamento[];
  readonly deducoes: readonly DeducaoPagamento[];
}

const tag = (nome: string) =>
  new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${nome}>`, 'g');
const valorDe = (xml: string, nome: string): string | null => {
  const r = tag(nome).exec(xml);
  return r ? r[1]!.replace(/<[^>]+>/g, '').trim() : null;
};
const blocos = (xml: string, nome: string): string[] => [...xml.matchAll(tag(nome))].map((m) => m[1]!);
const valor = (s: string | null): number => {
  const n = Number((s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};
const dataOk = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export function lerDemonstrativoPagamentoXml(xml: string): PagamentoLidoXml {
  if (!/demonstrativoPagamento/.test(xml))
    throw new ErroDemonstrativo('O arquivo não é um demonstrativo de pagamento da TISS.');
  const cab = blocos(xml, 'cabecalhoDemonstrativo')[0] ?? '';
  const numero = valorDe(cab, 'numeroDemonstrativo');
  const dataEmissao = dataOk(valorDe(cab, 'dataEmissao'));
  if (!numero || !dataEmissao)
    throw new ErroDemonstrativo('O cabeçalho do demonstrativo não tem o número e a data de emissão.');
  const linhas: LinhaPagamento[] = [];
  const deducoes: DeducaoPagamento[] = [];
  let dataPagamento: string | null = null;
  for (const p of blocos(xml, 'pagamentosPorData')) {
    const dp = blocos(p, 'dadosPagamento')[0] ?? '';
    const data = dataOk(valorDe(dp, 'dataPagamento'));
    dataPagamento ??= data;
    for (const r of blocos(p, 'relacaoProtocolos')) {
      linhas.push({
        numeroLote: (valorDe(r, 'numeroLotePrestador') ?? '').slice(0, 12) || null,
        protocolo: (valorDe(r, 'numeroProtocolo') ?? '').slice(0, 20) || null,
        numeroGuia: (valorDe(r, 'numeroGuiaPrestador') ?? '').slice(0, 20) || null,
        valorInformado: valor(valorDe(r, 'valorInformado')),
        valorProcessado: valor(valorDe(r, 'valorProcessado')),
        valorLiberado: valor(valorDe(r, 'valorLiberado')),
        valorGlosa: valor(valorDe(r, 'valorGlosa')),
      });
    }
    for (const d of blocos(p, 'descontos')) {
      const v = valor(valorDe(d, 'valorDbCr'));
      if (v <= 0) continue;
      deducoes.push({
        natureza: valorDe(d, 'indicador') === '2' ? 'credito' : 'debito',
        codigo: (valorDe(d, 'tipoDebitoCredito') ?? '').slice(0, 4) || null,
        descricao: (valorDe(d, 'descricaoDbCr') ?? 'Débito ou crédito da operadora').slice(0, 150),
        valor: v,
        dataPagamento: data,
      });
    }
  }
  if (linhas.length === 0)
    throw new ErroDemonstrativo('O demonstrativo de pagamento não tem protocolos (relacaoProtocolos).');
  if (linhas.some((l) => !l.numeroLote && !l.protocolo && !l.numeroGuia))
    throw new ErroDemonstrativo('Há protocolo sem número do lote, do protocolo ou da guia.');
  return { numero: numero.slice(0, 20), dataEmissao, dataPagamento, linhas, deducoes };
}

export interface TotaisPagamento {
  readonly informado: number;
  readonly processado: number;
  readonly liberado: number;
  readonly glosa: number;
  readonly debitos: number;
  readonly creditos: number;
  readonly liquido: number;
}

export function totaisDoPagamento(
  linhas: readonly LinhaPagamento[],
  deducoes: readonly DeducaoPagamento[],
): TotaisPagamento {
  const soma = (f: (l: LinhaPagamento) => number) => linhas.reduce((t, l) => t + cent(f(l)), 0);
  const ded = (n: 'debito' | 'credito') =>
    deducoes.filter((d) => d.natureza === n).reduce((t, d) => t + cent(d.valor), 0);
  const liberado = soma((l) => l.valorLiberado);
  const debitos = ded('debito');
  const creditos = ded('credito');
  return {
    informado: reais(soma((l) => l.valorInformado)),
    processado: reais(soma((l) => l.valorProcessado)),
    liberado: reais(liberado),
    glosa: reais(soma((l) => l.valorGlosa)),
    debitos: reais(debitos),
    creditos: reais(creditos),
    liquido: reais(liberado - debitos + creditos),
  };
}

/** O líquido não pode ficar negativo: débito maior que o liberado é erro do demonstrativo, não pagamento. */
export function conferirPagamento(t: TotaisPagamento): string | null {
  if (t.liquido < 0) return 'Os débitos do demonstrativo passam do valor liberado: confira o arquivo.';
  return null;
}

/** Digitação: os itens agrupados por guia, na ordem em que apareceram. */
export function linhasPagamentoDosItens(itens: readonly ItemDemonstrativo[]): LinhaPagamento[] {
  const porGuia = new Map<string, { informado: number; liberado: number }>();
  for (const i of itens) {
    const g = i.numeroGuia.trim() || '0';
    const s = porGuia.get(g) ?? { informado: 0, liberado: 0 };
    porGuia.set(g, {
      informado: s.informado + cent(i.valorInformado),
      liberado: s.liberado + cent(i.valorPago),
    });
  }
  return [...porGuia].map(([g, s]) => ({
    numeroLote: null,
    protocolo: null,
    numeroGuia: g.slice(0, 20),
    valorInformado: reais(s.informado),
    valorProcessado: reais(s.informado),
    valorLiberado: reais(s.liberado),
    valorGlosa: reais(Math.max(0, s.informado - s.liberado)),
  }));
}

/** Um demonstrativo de pagamento SINTÉTICO (testes): protocolos e débitos/créditos de uma data. */
export function demonstrativoPagamentoSinteticoXml(d: {
  numero: string;
  dataEmissao: string;
  dataPagamento: string;
  protocolos: readonly {
    numeroLote: string;
    protocolo: string;
    informado: number;
    liberado: number;
  }[];
  descontos: readonly { indicador: 1 | 2; tipo: string; descricao: string; valor: number }[];
}): string {
  const r = (v: number) => v.toFixed(2);
  const prot = d.protocolos
    .map(
      (p) =>
        `<ans:relacaoProtocolos><ans:numeroLotePrestador>${p.numeroLote}</ans:numeroLotePrestador><ans:numeroProtocolo>${p.protocolo}</ans:numeroProtocolo><ans:valorInformado>${r(p.informado)}</ans:valorInformado><ans:valorProcessado>${r(p.informado)}</ans:valorProcessado><ans:valorLiberado>${r(p.liberado)}</ans:valorLiberado><ans:valorGlosa>${r(Math.max(0, p.informado - p.liberado))}</ans:valorGlosa></ans:relacaoProtocolos>`,
    )
    .join('');
  const desc = d.descontos
    .map(
      (x) =>
        `<ans:descontos><ans:indicador>${x.indicador}</ans:indicador><ans:tipoDebitoCredito>${x.tipo}</ans:tipoDebitoCredito><ans:descricaoDbCr>${x.descricao}</ans:descricaoDbCr><ans:valorDbCr>${r(x.valor)}</ans:valorDbCr></ans:descontos>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="ISO-8859-1"?><ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"><ans:operadoraParaPrestador><ans:demonstrativosRetorno><ans:demonstrativoPagamento><ans:cabecalhoDemonstrativo><ans:registroANS>999999</ans:registroANS><ans:numeroDemonstrativo>${d.numero}</ans:numeroDemonstrativo><ans:nomeOperadora>OPERADORA SINTETICA</ans:nomeOperadora><ans:numeroCNPJ>00000000000000</ans:numeroCNPJ><ans:dataEmissao>${d.dataEmissao}</ans:dataEmissao></ans:cabecalhoDemonstrativo><ans:pagamentos><ans:pagamentosPorData><ans:dadosPagamento><ans:dataPagamento>${d.dataPagamento}</ans:dataPagamento></ans:dadosPagamento><ans:dadosResumo>${prot}</ans:dadosResumo>${desc}</ans:pagamentosPorData></ans:pagamentos></ans:demonstrativoPagamento></ans:demonstrativosRetorno></ans:operadoraParaPrestador></ans:mensagemTISS>`;
}

/** Situação da linha do pagamento: sem lote nem conta do hospital, sem correspondência; com glosa, divergente. */
export function situacaoLinhaPagamento(l: {
  readonly casada: boolean;
  readonly valorGlosa: number;
}): SituacaoConciliacao {
  if (!l.casada) return 'sem_correspondencia';
  return cent(l.valorGlosa) > 0 ? 'divergente' : 'conciliado';
}
