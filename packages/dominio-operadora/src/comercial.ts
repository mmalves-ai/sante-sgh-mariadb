// Comercial da operadora própria (08-SGO L100, C2-095; F8): proposta de adesão, força de venda (corretoras, vendedores e
// equipes), metas com faixas de prêmio, campanhas de desconto e comissão sobre as parcelas pagas, com estorno no
// cancelamento ou na inadimplência. Regras puras; o banco só guarda.
// - Proposta: a ficha do proponente segue o que a ANS pede no cadastro do beneficiário (SIB: CPF a partir dos 18 anos,
//   nome da mãe, titular para todo dependente) e o fluxo da proposta não pula etapas (rascunho → enviada → análise →
//   aprovada → efetivada no contrato; recusa e cancelamento sempre com motivo; nada é apagado).
// - Comissão: só a mensalidade PAGA gera comissão (a não paga fica como pendência, sem valor no lote); a parcela da
//   regra (faixa de parcelas, percentual ou valor fixo, desconto) é a vigente na venda; a saída do contrato até o prazo
//   de estorno (cancelamento, ou inadimplência acima de 60 dias, Lei 9.656/1998, art. 13, II) estorna o que já foi pago.
// - Meta: realizado contra a meta global e a faixa de prêmio atingida (faixas sem sobreposição).
// - Campanha: período de venda, desconto por parcela (percentual ou valor, nunca os dois) e situação com transições.
import { cpfValido } from './documentos.js';

export interface ProblemaComercial {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}
const prob = (codigo: string, campo: string, detalhe: string): ProblemaComercial => ({
  codigo,
  campo,
  detalhe,
});
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Idade completa em anos numa data (datas ISO). */
export function idadeEm(nascimento: string, data: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return a - an - (m < mn || (m === mn && d < dn) ? 1 : 0);
}
/** Dias corridos entre duas datas ISO (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
const somarDias = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ proposta ------------------------------------------
export const SITUACOES_PROPOSTA = [
  'rascunho',
  'enviada',
  'em_analise',
  'pendente_documento',
  'aprovada',
  'recusada',
  'cancelada',
  'efetivada',
] as const;
export type SituacaoProposta = (typeof SITUACOES_PROPOSTA)[number];
export const TIPOS_PROPONENTE = ['titular', 'dependente', 'agregado'] as const;
export type TipoProponente = (typeof TIPOS_PROPONENTE)[number];

const TRANSICOES_PROPOSTA: Readonly<Record<SituacaoProposta, readonly SituacaoProposta[]>> = {
  rascunho: ['enviada', 'cancelada'],
  enviada: ['em_analise', 'pendente_documento', 'cancelada'],
  em_analise: ['pendente_documento', 'aprovada', 'recusada', 'cancelada'],
  pendente_documento: ['em_analise', 'cancelada'],
  aprovada: ['efetivada', 'cancelada'],
  recusada: [],
  cancelada: [],
  efetivada: [],
};
export const proximasSituacoesProposta = (s: SituacaoProposta): readonly SituacaoProposta[] =>
  TRANSICOES_PROPOSTA[s];

export interface Proponente {
  readonly sequencia: number;
  readonly tipo: TipoProponente;
  /** Sequência do titular na mesma proposta (dependente e agregado). */
  readonly titularSequencia: number | null;
  readonly parentesco: number | null;
  readonly nome: string;
  readonly nascimento: string;
  readonly sexo: string;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nomeMae: string | null;
}
export interface PropostaParaConferir {
  readonly propostaEm: string;
  readonly hoje: string;
  readonly diaVencimento: number | null;
  readonly proponentes: readonly Proponente[];
}

/** A ficha está completa para ser enviada à análise? */
export function problemasDaProposta(p: PropostaParaConferir): ProblemaComercial[] {
  const out: ProblemaComercial[] = [];
  if (p.propostaEm > p.hoje)
    out.push(prob('proposta-futura', 'propostaEm', 'A data da proposta não pode ser futura.'));
  if (p.diaVencimento !== null && (p.diaVencimento < 1 || p.diaVencimento > 28))
    out.push(
      prob(
        'dia-vencimento-invalido',
        'diaVencimento',
        'O dia de vencimento vai de 1 a 28 (vale em todo mês).',
      ),
    );
  if (!p.proponentes.length) {
    out.push(prob('proposta-sem-proponente', 'proponentes', 'Inclua ao menos o titular.'));
    return out;
  }
  const titulares = new Set(p.proponentes.filter((x) => x.tipo === 'titular').map((x) => x.sequencia));
  if (!titulares.size)
    out.push(prob('proposta-sem-titular', 'proponentes', 'A proposta precisa de um titular.'));
  const cpfs = new Set<string>();
  for (const x of p.proponentes) {
    const campo = `proponentes.${x.sequencia}`;
    if (!x.nome.trim()) out.push(prob('proponente-sem-nome', campo, 'Informe o nome do proponente.'));
    if (x.nascimento > p.propostaEm)
      out.push(prob('nascimento-futuro', campo, 'O nascimento é posterior à data da proposta.'));
    if (x.tipo !== 'titular') {
      if (x.titularSequencia === null || !titulares.has(x.titularSequencia))
        out.push(prob('dependente-sem-titular', campo, 'O dependente precisa de um titular desta proposta.'));
      if (x.parentesco === null)
        out.push(prob('dependente-sem-parentesco', campo, 'Informe o grau de parentesco com o titular.'));
    }
    const maior = idadeEm(x.nascimento, p.propostaEm) >= 18;
    if (x.cpf) {
      if (!cpfValido(x.cpf)) out.push(prob('cpf-invalido', campo, 'O CPF não confere.'));
      else if (cpfs.has(x.cpf)) out.push(prob('cpf-repetido', campo, 'O mesmo CPF aparece duas vezes.'));
      else cpfs.add(x.cpf);
    } else if (x.tipo === 'titular' || maior)
      out.push(
        prob(
          'cpf-obrigatorio',
          campo,
          'Titular e proponente com 18 anos ou mais precisam de CPF (cadastro da ANS).',
        ),
      );
    if (!x.nomeMae?.trim()) out.push(prob('sem-nome-mae', campo, 'Informe o nome da mãe (cadastro da ANS).'));
  }
  return out;
}

export interface MudancaProposta {
  readonly de: SituacaoProposta;
  readonly para: SituacaoProposta;
  readonly motivo: string | null;
  readonly contrato: number | null;
  readonly ficha: PropostaParaConferir;
}
export function problemasDaMudancaProposta(m: MudancaProposta): ProblemaComercial[] {
  if (!TRANSICOES_PROPOSTA[m.de].includes(m.para))
    return [
      prob(
        'proposta-transicao-invalida',
        'situacao',
        `A proposta ${m.de.replace('_', ' ')} não pode passar a ${m.para.replace('_', ' ')}.`,
      ),
    ];
  if (['recusada', 'cancelada', 'pendente_documento'].includes(m.para) && !m.motivo?.trim())
    return [prob('proposta-sem-motivo', 'motivo', 'Informe o motivo.')];
  if (m.para === 'efetivada' && m.contrato === null)
    return [prob('efetivacao-sem-contrato', 'contrato', 'A efetivação liga a proposta ao contrato.')];
  if (m.para === 'enviada' || m.para === 'aprovada') return problemasDaProposta(m.ficha);
  return [];
}

// ------------------------------------------------------------------ comissão ------------------------------------------
export interface ParcelaRegraComissao {
  readonly parcelaInicial: number;
  readonly parcelaFinal: number | null;
  readonly tipo: 'percentual' | 'valor';
  readonly percentual: number | null;
  readonly valor: number | null;
  readonly desconto: number | null;
  readonly vigenciaInicio: string;
}
export function problemasDasParcelasDaRegra(ps: readonly ParcelaRegraComissao[]): ProblemaComercial[] {
  const out: ProblemaComercial[] = [];
  if (!ps.length) out.push(prob('regra-sem-parcela', 'parcelas', 'Informe ao menos uma faixa de parcelas.'));
  ps.forEach((p, i) => {
    const campo = `parcelas.${i}`;
    if (p.parcelaInicial < 1 || (p.parcelaFinal !== null && p.parcelaFinal < p.parcelaInicial))
      out.push(prob('parcela-faixa-invalida', campo, 'A faixa de parcelas é inválida.'));
    if (p.tipo === 'percentual' && (p.percentual === null || p.percentual < 0 || p.percentual > 100))
      out.push(prob('parcela-percentual-invalido', campo, 'O percentual vai de 0 a 100.'));
    if (p.tipo === 'valor' && (p.valor === null || p.valor < 0))
      out.push(prob('parcela-valor-invalido', campo, 'Informe o valor fixo da comissão.'));
    for (const q of ps.slice(i + 1)) {
      if (q.vigenciaInicio !== p.vigenciaInicio) continue;
      const fimP = p.parcelaFinal ?? p.parcelaInicial;
      const fimQ = q.parcelaFinal ?? q.parcelaInicial;
      if (p.parcelaInicial <= fimQ && q.parcelaInicial <= fimP)
        out.push(prob('parcela-sobreposta', campo, 'Duas faixas da mesma vigência cobrem a mesma parcela.'));
    }
  });
  return out;
}

/** A faixa da regra que vale para a parcela, na vigência mais recente até a data da venda. */
export function parcelaDaRegra(
  ps: readonly ParcelaRegraComissao[],
  numeroParcela: number,
  vendidoEm: string,
): ParcelaRegraComissao | null {
  const cand = ps
    .filter(
      (p) =>
        p.vigenciaInicio <= vendidoEm &&
        numeroParcela >= p.parcelaInicial &&
        numeroParcela <= (p.parcelaFinal ?? p.parcelaInicial),
    )
    .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  return cand[0] ?? null;
}
export function valorDaComissao(p: ParcelaRegraComissao, base: number): number {
  const bruto = p.tipo === 'percentual' ? (base * (p.percentual ?? 0)) / 100 : (p.valor ?? 0);
  return Math.max(0, r2(bruto - (p.desconto ?? 0)));
}

export interface MensalidadeComissionavel {
  readonly fatura: number;
  readonly contrato: number;
  readonly numeroParcela: number;
  readonly competencia: string;
  readonly valor: number;
  readonly valorPago: number | null;
  readonly pagoEm: string | null;
  readonly vendidoEm: string;
  /** Já entrou como comissão em lote não cancelado. */
  readonly jaComissionada: boolean;
}
export interface ItemComissaoApurado {
  readonly tipo: 'comissao' | 'pendencia';
  readonly fatura: number;
  readonly contrato: number;
  readonly numeroParcela: number;
  readonly competencia: string;
  readonly base: number;
  readonly percentual: number | null;
  readonly valor: number;
  readonly pendente: boolean;
}
/** Comissão só sobre a mensalidade paga; a não paga na faixa da regra vira pendência (sem valor no lote). */
export function apurarComissoes(
  ms: readonly MensalidadeComissionavel[],
  regra: readonly ParcelaRegraComissao[],
): ItemComissaoApurado[] {
  const out: ItemComissaoApurado[] = [];
  for (const m of ms) {
    if (m.jaComissionada) continue;
    const p = parcelaDaRegra(regra, m.numeroParcela, m.vendidoEm);
    if (!p) continue;
    const pago = m.pagoEm !== null && (m.valorPago ?? 0) > 0;
    const base = pago ? Math.min(m.valorPago ?? 0, m.valor) : m.valor;
    out.push({
      tipo: pago ? 'comissao' : 'pendencia',
      fatura: m.fatura,
      contrato: m.contrato,
      numeroParcela: m.numeroParcela,
      competencia: m.competencia,
      base: r2(base),
      percentual: p.tipo === 'percentual' ? p.percentual : null,
      valor: valorDaComissao(p, base),
      pendente: !pago,
    });
  }
  return out;
}

/** Dias de atraso que caracterizam a inadimplência que encerra o contrato (Lei 9.656/1998, art. 13, II). */
export const DIAS_INADIMPLENCIA = 60;
/** Data em que o contrato passa a inadimplente: a mensalidade vencida mais antiga não paga + 60 dias, se já passou. */
export function inadimplenteDesde(vencidasNaoPagas: readonly string[], hoje: string): string | null {
  const mais = [...vencidasNaoPagas].sort()[0];
  if (!mais) return null;
  const em = somarDias(mais, DIAS_INADIMPLENCIA);
  return em <= hoje ? em : null;
}
export interface SaidaContrato {
  readonly contrato: number;
  readonly motivo: 'cancelamento' | 'inadimplencia';
  readonly saidaEm: string;
  readonly vendidoEm: string;
  /** Soma das comissões já liberadas do contrato (positivas, lotes fechados ou pagos). */
  readonly comissaoPaga: number;
  readonly jaEstornado: boolean;
}
export interface EstornoApurado {
  readonly contrato: number;
  readonly motivo: 'cancelamento' | 'inadimplencia';
  readonly diasPermanencia: number;
  readonly valor: number;
}
/** Estorno do que foi pago quando o contrato sai até o prazo de estorno, contado da venda. */
export function apurarEstornos(saidas: readonly SaidaContrato[], prazoEstornoDias: number): EstornoApurado[] {
  return saidas
    .filter((s) => !s.jaEstornado && s.comissaoPaga > 0)
    .map((s) => ({ s, dias: Math.max(0, diasEntre(s.vendidoEm, s.saidaEm)) }))
    .filter((x) => x.dias <= prazoEstornoDias)
    .map(({ s, dias }) => ({
      contrato: s.contrato,
      motivo: s.motivo,
      diasPermanencia: dias,
      valor: -r2(s.comissaoPaga),
    }));
}

export interface TotaisComissao {
  readonly bruto: number;
  readonly estorno: number;
  readonly irrf: number;
  readonly iss: number;
  readonly liquido: number;
}
/** IRRF abaixo de R$ 10,00 não é retido (valor mínimo de recolhimento). */
export const IRRF_MINIMO = 10;
export function totaisDaComissao(
  itens: readonly { readonly valor: number; readonly pendente: boolean }[],
  aliquotas: { readonly irrf: number; readonly iss: number },
): TotaisComissao {
  const bruto = r2(itens.filter((i) => !i.pendente && i.valor > 0).reduce((s, i) => s + i.valor, 0));
  const estorno = r2(itens.filter((i) => i.valor < 0).reduce((s, i) => s - i.valor, 0));
  const base = Math.max(0, bruto - estorno);
  const irrfCalc = r2((base * aliquotas.irrf) / 100);
  const irrf = irrfCalc < IRRF_MINIMO ? 0 : irrfCalc;
  const iss = r2((base * aliquotas.iss) / 100);
  return { bruto, estorno, irrf, iss, liquido: r2(bruto - estorno - irrf - iss) };
}

export const SITUACOES_COMISSAO = ['aberta', 'calculada', 'fechada', 'paga', 'cancelada'] as const;
export type SituacaoComissao = (typeof SITUACOES_COMISSAO)[number];
const TRANSICOES_COMISSAO: Readonly<Record<SituacaoComissao, readonly SituacaoComissao[]>> = {
  aberta: ['calculada', 'cancelada'],
  calculada: ['fechada', 'cancelada'],
  fechada: ['paga', 'calculada'],
  paga: [],
  cancelada: [],
};
export function problemasDaMudancaComissao(
  de: SituacaoComissao,
  para: SituacaoComissao,
  motivo: string | null,
): ProblemaComercial[] {
  if (!TRANSICOES_COMISSAO[de].includes(para))
    return [prob('comissao-transicao-invalida', 'situacao', `O lote ${de} não pode passar a ${para}.`)];
  if ((para === 'cancelada' || (de === 'fechada' && para === 'calculada')) && !motivo?.trim())
    return [prob('comissao-sem-motivo', 'motivo', 'Informe o motivo.')];
  return [];
}

// ------------------------------------------------------------------ meta ----------------------------------------------
export const MEDIDAS_META = ['vidas', 'contratos', 'receita', 'propostas'] as const;
export type MedidaMeta = (typeof MEDIDAS_META)[number];
export interface FaixaMeta {
  readonly de: number;
  readonly ate: number | null;
  readonly percentualPremio: number | null;
  readonly valorPremio: number | null;
}
export interface MetaParaConferir {
  readonly descricao: string;
  readonly inicio: string;
  readonly fim: string;
  readonly valorMeta: number | null;
  readonly faixas: readonly FaixaMeta[];
}
export function problemasDaMeta(m: MetaParaConferir): ProblemaComercial[] {
  const out: ProblemaComercial[] = [];
  if (!m.descricao.trim()) out.push(prob('meta-sem-descricao', 'descricao', 'Descreva a meta.'));
  if (m.fim < m.inicio) out.push(prob('meta-periodo-invalido', 'fim', 'O fim vem antes do início.'));
  if (m.valorMeta !== null && m.valorMeta <= 0)
    out.push(prob('meta-valor-invalido', 'valorMeta', 'A meta precisa ser maior que zero.'));
  const fs = [...m.faixas].sort((a, b) => a.de - b.de);
  fs.forEach((f, i) => {
    const campo = `faixas.${i}`;
    if (f.de < 0 || (f.ate !== null && f.ate < f.de))
      out.push(prob('faixa-invalida', campo, 'A faixa é inválida.'));
    if (f.percentualPremio === null && f.valorPremio === null)
      out.push(prob('faixa-sem-premio', campo, 'Informe o prêmio da faixa.'));
    if (f.percentualPremio !== null && (f.percentualPremio < 0 || f.percentualPremio > 100))
      out.push(prob('faixa-premio-invalido', campo, 'O prêmio em percentual vai de 0 a 100.'));
    const prox = fs[i + 1];
    if (prox && (f.ate === null || f.ate >= prox.de))
      out.push(prob('faixa-sobreposta', campo, 'As faixas não podem se sobrepor.'));
  });
  return out;
}
export interface ResultadoMeta {
  readonly realizado: number;
  readonly atingido: number | null;
  readonly faixa: number | null;
  readonly percentualPremio: number | null;
  readonly valorPremio: number | null;
}
/** Percentual atingido da meta global e a faixa de prêmio em que o realizado cai. */
export function apurarMeta(
  m: Pick<MetaParaConferir, 'valorMeta' | 'faixas'>,
  realizado: number,
): ResultadoMeta {
  const idx = m.faixas.findIndex((f) => realizado >= f.de && (f.ate === null || realizado <= f.ate));
  const f = idx >= 0 ? m.faixas[idx] : undefined;
  return {
    realizado: r2(realizado),
    atingido: m.valorMeta ? r2((realizado / m.valorMeta) * 100) : null,
    faixa: idx >= 0 ? idx + 1 : null,
    percentualPremio: f?.percentualPremio ?? null,
    valorPremio: f?.valorPremio ?? null,
  };
}

// ------------------------------------------------------------------ campanha ------------------------------------------
export const SITUACOES_CAMPANHA = ['planejada', 'ativa', 'encerrada', 'cancelada'] as const;
export type SituacaoCampanha = (typeof SITUACOES_CAMPANHA)[number];
const TRANSICOES_CAMPANHA: Readonly<Record<SituacaoCampanha, readonly SituacaoCampanha[]>> = {
  planejada: ['ativa', 'cancelada'],
  ativa: ['encerrada', 'cancelada'],
  encerrada: [],
  cancelada: [],
};
export interface DescontoCampanha {
  readonly parcela: number;
  readonly percentual: number | null;
  readonly valor: number | null;
}
export interface CampanhaParaConferir {
  readonly codigo: string;
  readonly descricao: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly descontos: readonly DescontoCampanha[];
}
export function problemasDaCampanha(c: CampanhaParaConferir): ProblemaComercial[] {
  const out: ProblemaComercial[] = [];
  if (!c.codigo.trim()) out.push(prob('campanha-sem-codigo', 'codigo', 'Informe o código.'));
  if (!c.descricao.trim()) out.push(prob('campanha-sem-descricao', 'descricao', 'Descreva a campanha.'));
  if (c.fim !== null && c.fim < c.inicio)
    out.push(prob('campanha-periodo-invalido', 'fim', 'O fim da venda vem antes do início.'));
  const vistas = new Set<number>();
  c.descontos.forEach((d, i) => {
    const campo = `descontos.${i}`;
    if (d.parcela < 1) out.push(prob('desconto-parcela-invalida', campo, 'A parcela começa em 1.'));
    if (vistas.has(d.parcela)) out.push(prob('desconto-parcela-repetida', campo, 'Parcela repetida.'));
    vistas.add(d.parcela);
    if ((d.percentual === null) === (d.valor === null))
      out.push(prob('desconto-forma', campo, 'Informe percentual ou valor, um dos dois.'));
    if (d.percentual !== null && (d.percentual < 0 || d.percentual > 100))
      out.push(prob('desconto-percentual-invalido', campo, 'O percentual vai de 0 a 100.'));
    if (d.valor !== null && d.valor < 0)
      out.push(prob('desconto-valor-invalido', campo, 'O valor não pode ser negativo.'));
  });
  return out;
}
export function problemasDaMudancaCampanha(
  de: SituacaoCampanha,
  para: SituacaoCampanha,
  descontos: number,
): ProblemaComercial[] {
  if (!TRANSICOES_CAMPANHA[de].includes(para))
    return [prob('campanha-transicao-invalida', 'situacao', `A campanha ${de} não pode passar a ${para}.`)];
  if (para === 'ativa' && descontos === 0)
    return [prob('campanha-sem-desconto', 'descontos', 'Só ativa a campanha com ao menos um desconto.')];
  return [];
}
/** Desconto da campanha na parcela de uma venda feita no período de venda da campanha ativa ou já encerrada. */
export function descontoNaParcela(
  c: { readonly inicio: string; readonly fim: string | null; readonly situacao: SituacaoCampanha } & Pick<
    CampanhaParaConferir,
    'descontos'
  >,
  vendidoEm: string,
  numeroParcela: number,
  valorParcela: number,
): number {
  if (c.situacao !== 'ativa' && c.situacao !== 'encerrada') return 0;
  if (vendidoEm < c.inicio || (c.fim !== null && vendidoEm > c.fim)) return 0;
  const d = c.descontos.find((x) => x.parcela === numeroParcela);
  if (!d) return 0;
  const v = d.percentual !== null ? (valorParcela * d.percentual) / 100 : (d.valor ?? 0);
  return r2(Math.min(valorParcela, v));
}
