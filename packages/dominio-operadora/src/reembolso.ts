// Reembolso ao beneficiário (08-SGO linha 106, C2-047; F7). Regra pura, sem banco:
//   - o pedido: prestador como consta no recibo (CPF ou CNPJ com dígito conferido), data do atendimento não futura,
//     alta não antes do atendimento, ao menos um item e ao menos um comprovante anexado;
//   - a tabela de referência que vale para o pedido: a do município do atendimento e do produto, depois só do
//     município, depois só do produto e por fim a padrão, sempre vigente na data do atendimento e na modalidade;
//   - o limite de cada item: valor de referência × multiplicador do plano × quantidade (limitada pela quantidade máxima
//     da tabela) ou, sem tabela, o percentual do plano sobre o apresentado; nunca acima do apresentado;
//   - a análise: glosa por item com motivo padronizado, coparticipação descontada, teto por evento e teto anual do
//     plano (o que já foi reembolsado no ano entra na conta) e a situação que resulta;
//   - o prazo legal (RN ANS 566/2022: até 30 dias do pedido completo; a regra do plano pode dar prazo menor) e o atraso;
//   - as passagens de situação (o pedido pago ou cancelado não muda mais; nada é apagado).
// Valores em reais com duas casas; as contas usam centavos inteiros para não acumular erro.

export const SITUACOES_REEMBOLSO = [
  'solicitado',
  'em_analise',
  'pendente_documento',
  'aprovado',
  'aprovado_parcial',
  'negado',
  'pago',
  'cancelado',
] as const;
export type SituacaoReembolso = (typeof SITUACOES_REEMBOLSO)[number];
export const CANAIS_REEMBOLSO = ['portal', 'presencial', 'central', 'correspondencia'] as const;
export type CanalReembolso = (typeof CANAIS_REEMBOLSO)[number];
export type SituacaoItemReembolso = 'pendente' | 'aprovado' | 'parcial' | 'glosado';

/** Prazo legal do pagamento do reembolso, em dias corridos do pedido (RN ANS 566/2022). */
export const PRAZO_LEGAL_REEMBOLSO_DIAS = 30;

export interface ProblemaReembolso {
  readonly codigo: string;
  readonly campo?: string;
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;
const digitos = (t: string) => t.replace(/\D/g, '');

/** Dígito verificador de CPF (11 dígitos) ou CNPJ (14 dígitos). */
export function documentoValido(doc: string): boolean {
  const d = digitos(doc);
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const dv = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const dv = (n: number) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  return false;
}

export interface EntradaItemReembolso {
  readonly procedimento: number;
  readonly quantidade: number;
  readonly valorApresentado: number;
  readonly dataRealizacao: string | null;
}
export interface EntradaPedidoReembolso {
  readonly beneficiario: number;
  readonly canal: CanalReembolso;
  readonly prestadorNome: string;
  readonly prestadorDocumento: string;
  readonly dataAtendimento: string;
  readonly dataAlta: string | null;
  readonly numeroDocumentoFiscal: string | null;
  readonly itens: readonly EntradaItemReembolso[];
}

/** Os problemas do pedido (vazio: pode gravar). `hoje` em AAAA-MM-DD. */
export function problemasDoPedidoReembolso(
  e: EntradaPedidoReembolso,
  hoje: string,
  anexos: number,
): ProblemaReembolso[] {
  const p: ProblemaReembolso[] = [];
  if (!e.prestadorNome.trim()) p.push({ codigo: 'prestador-obrigatorio', campo: 'prestadorNome' });
  if (!documentoValido(e.prestadorDocumento))
    p.push({ codigo: 'documento-invalido', campo: 'prestadorDocumento' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.dataAtendimento) || e.dataAtendimento > hoje)
    p.push({ codigo: 'data-atendimento-invalida', campo: 'dataAtendimento' });
  if (e.dataAlta !== null && e.dataAlta < e.dataAtendimento)
    p.push({ codigo: 'alta-antes-do-atendimento', campo: 'dataAlta' });
  if (e.itens.length === 0) p.push({ codigo: 'itens-obrigatorios', campo: 'itens' });
  e.itens.forEach((i, n) => {
    if (!(i.quantidade > 0)) p.push({ codigo: 'quantidade-invalida', campo: `itens.${n}.quantidade` });
    if (!(i.valorApresentado > 0)) p.push({ codigo: 'valor-invalido', campo: `itens.${n}.valorApresentado` });
    if (i.dataRealizacao !== null && i.dataRealizacao > hoje)
      p.push({ codigo: 'data-realizacao-invalida', campo: `itens.${n}.dataRealizacao` });
  });
  if (anexos < 1) p.push({ codigo: 'comprovante-obrigatorio', campo: 'anexos' });
  return p;
}

/** Natureza do prestador pelo documento. */
export const tipoPessoaDoDocumento = (doc: string): 'fisica' | 'juridica' =>
  digitos(doc).length === 11 ? 'fisica' : 'juridica';

// ── tabela de referência ──────────────────────────────────────────────────────────────────────

export interface TabelaReferenciaCandidata {
  readonly id: number;
  readonly municipio: number | null;
  readonly produto: number | null;
  readonly modalidade: number | null;
  readonly padrao: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

/**
 * A tabela que vale: vigente na data e na modalidade (a sem modalidade vale para todas); a do município e do produto
 * ganha, depois a só do município, a só do produto, a padrão e por fim a geral. Empate: a de vigência mais recente.
 */
export function escolherTabelaReferencia(
  tabelas: readonly TabelaReferenciaCandidata[],
  alvo: { municipio: number | null; produto: number | null; modalidade: number | null; data: string },
): TabelaReferenciaCandidata | null {
  const peso = (t: TabelaReferenciaCandidata) =>
    (t.municipio !== null ? 8 : 0) +
    (t.produto !== null ? 4 : 0) +
    (t.modalidade !== null ? 2 : 0) +
    (t.padrao ? 1 : 0);
  const validas = tabelas.filter(
    (t) =>
      t.ativo &&
      t.vigenciaInicio <= alvo.data &&
      (t.vigenciaFim === null || t.vigenciaFim >= alvo.data) &&
      (t.municipio === null || t.municipio === alvo.municipio) &&
      (t.produto === null || t.produto === alvo.produto) &&
      (t.modalidade === null || t.modalidade === alvo.modalidade),
  );
  validas.sort((a, b) => peso(b) - peso(a) || b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  return validas[0] ?? null;
}

export interface RegraReembolso {
  readonly multiplicador: number;
  readonly percentual: number | null;
  readonly limitePorEvento: number | null;
  readonly limiteAnual: number | null;
  readonly prazoPagamentoDias: number;
}
export const REGRA_REEMBOLSO_SEM_CADASTRO: RegraReembolso = {
  multiplicador: 1,
  percentual: null,
  limitePorEvento: null,
  limiteAnual: null,
  prazoPagamentoDias: PRAZO_LEGAL_REEMBOLSO_DIAS,
};

/** Problemas da regra do plano (vazio: pode gravar). */
export function problemasDaRegraReembolso(
  r: RegraReembolso & { tabela: number | null },
): ProblemaReembolso[] {
  const p: ProblemaReembolso[] = [];
  if (!(r.multiplicador > 0)) p.push({ codigo: 'multiplicador-invalido', campo: 'multiplicador' });
  if (r.tabela === null && r.percentual === null) p.push({ codigo: 'base-obrigatoria', campo: 'tabela' });
  if (r.percentual !== null && !(r.percentual > 0 && r.percentual <= 100))
    p.push({ codigo: 'percentual-invalido', campo: 'percentual' });
  if (r.limitePorEvento !== null && !(r.limitePorEvento > 0))
    p.push({ codigo: 'limite-invalido', campo: 'limitePorEvento' });
  if (r.limiteAnual !== null && !(r.limiteAnual > 0))
    p.push({ codigo: 'limite-invalido', campo: 'limiteAnual' });
  if (!(r.prazoPagamentoDias >= 1 && r.prazoPagamentoDias <= PRAZO_LEGAL_REEMBOLSO_DIAS))
    p.push({ codigo: 'prazo-acima-do-legal', campo: 'prazoPagamentoDias' });
  return p;
}

/** Referência de um procedimento na tabela (valor unitário e quantidade máxima por evento). */
export interface ReferenciaProcedimento {
  readonly valor: number;
  readonly quantidadeMaxima: number | null;
}

/**
 * O limite reembolsável do item: referência × multiplicador × quantidade (limitada pela máxima) ou, sem referência, o
 * percentual do plano sobre o apresentado; sem nenhum dos dois, o apresentado. Nunca acima do apresentado.
 */
export function limiteDoItem(
  item: { quantidade: number; valorApresentado: number },
  referencia: ReferenciaProcedimento | null,
  regra: RegraReembolso,
): number {
  const apresentado = centavos(item.valorApresentado);
  let limite = apresentado;
  if (referencia) {
    const q =
      referencia.quantidadeMaxima !== null
        ? Math.min(item.quantidade, referencia.quantidadeMaxima)
        : item.quantidade;
    limite = Math.round(centavos(referencia.valor) * regra.multiplicador * q);
  } else if (regra.percentual !== null) {
    limite = Math.round((apresentado * regra.percentual) / 100);
  }
  return reais(Math.min(apresentado, Math.max(0, limite)));
}

// ── análise ───────────────────────────────────────────────────────────────────────────────────

export interface GlosaItemReembolso {
  readonly motivo: number;
  readonly valor: number;
  readonly justificativa: string | null;
}
export interface ItemEmAnalise {
  readonly id: number;
  readonly valorApresentado: number;
  /** Limite do item pela tabela ou pelo percentual (limiteDoItem). */
  readonly valorLimite: number;
  readonly glosas: readonly GlosaItemReembolso[];
  readonly coparticipacao: number;
}
export interface ItemAnalisado {
  readonly id: number;
  readonly valorGlosado: number;
  readonly valorCoparticipacao: number;
  readonly valorReembolsado: number;
  readonly situacao: SituacaoItemReembolso;
}
export interface ResultadoAnaliseReembolso {
  readonly itens: readonly ItemAnalisado[];
  readonly valorApresentado: number;
  readonly valorGlosado: number;
  readonly valorCoparticipacao: number;
  readonly valorReembolsado: number;
  /** Quanto o teto por evento e o teto anual cortaram (já fora do reembolsado). */
  readonly cortePorTeto: number;
  readonly situacao: 'aprovado' | 'aprovado_parcial' | 'negado';
  readonly problemas: readonly ProblemaReembolso[];
}

/**
 * A análise do pedido: cada glosa com motivo e valor positivo; a soma das glosas e da coparticipação não passa do
 * limite do item; o total é cortado pelo teto por evento e pelo saldo do teto anual (`reembolsadoNoAno`), tirado dos
 * últimos itens. Aprovado: pagou o limite de todos os itens sem glosa nem corte; negado: nada a pagar.
 */
export function analisarReembolso(
  itens: readonly ItemEmAnalise[],
  regra: RegraReembolso,
  reembolsadoNoAno: number,
): ResultadoAnaliseReembolso {
  const problemas: ProblemaReembolso[] = [];
  const calc = itens.map((i, n) => {
    const glosa = i.glosas.reduce((a, g) => {
      if (!(g.valor > 0)) problemas.push({ codigo: 'glosa-invalida', campo: `itens.${n}.glosas` });
      if (!(g.motivo > 0)) problemas.push({ codigo: 'motivo-obrigatorio', campo: `itens.${n}.glosas` });
      return a + centavos(g.valor);
    }, 0);
    const copart = centavos(i.coparticipacao);
    if (copart < 0) problemas.push({ codigo: 'coparticipacao-invalida', campo: `itens.${n}.coparticipacao` });
    const limite = centavos(i.valorLimite);
    if (glosa + copart > limite)
      problemas.push({ codigo: 'glosa-acima-do-limite', campo: `itens.${n}.glosas` });
    return {
      id: i.id,
      apresentado: centavos(i.valorApresentado),
      limite,
      glosa,
      copart,
      pago: Math.max(0, limite - glosa - copart),
    };
  });
  const bruto = calc.reduce((a, x) => a + x.pago, 0);
  let teto = bruto;
  if (regra.limitePorEvento !== null) teto = Math.min(teto, centavos(regra.limitePorEvento));
  if (regra.limiteAnual !== null)
    teto = Math.min(teto, Math.max(0, centavos(regra.limiteAnual) - centavos(reembolsadoNoAno)));
  let corte = bruto - teto;
  const cortePorTeto = corte;
  for (let k = calc.length - 1; k >= 0 && corte > 0; k--) {
    const x = calc[k]!;
    const tira = Math.min(x.pago, corte);
    x.pago -= tira;
    corte -= tira;
  }
  const analisados: ItemAnalisado[] = calc.map((x) => ({
    id: x.id,
    valorGlosado: reais(x.glosa),
    valorCoparticipacao: reais(x.copart),
    valorReembolsado: reais(x.pago),
    situacao: x.pago === 0 ? 'glosado' : x.pago < x.limite - x.copart ? 'parcial' : 'aprovado',
  }));
  const pago = calc.reduce((a, x) => a + x.pago, 0);
  const glosado = calc.reduce((a, x) => a + x.glosa, 0);
  const integral = calc.every((x) => x.pago === x.limite - x.copart) && cortePorTeto === 0;
  return {
    itens: analisados,
    valorApresentado: reais(calc.reduce((a, x) => a + x.apresentado, 0)),
    valorGlosado: reais(glosado),
    valorCoparticipacao: reais(calc.reduce((a, x) => a + x.copart, 0)),
    valorReembolsado: reais(pago),
    cortePorTeto: reais(cortePorTeto),
    situacao: pago === 0 ? 'negado' : integral && glosado === 0 ? 'aprovado' : 'aprovado_parcial',
    problemas,
  };
}

// ── prazo e situação ──────────────────────────────────────────────────────────────────────────

/** Data limite do pagamento: o dia do pedido mais o prazo da regra (nunca acima do legal). */
export function prazoDoReembolso(solicitadoEm: string, dias: number = PRAZO_LEGAL_REEMBOLSO_DIAS): string {
  const d = new Date(`${solicitadoEm.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.min(Math.max(1, dias), PRAZO_LEGAL_REEMBOLSO_DIAS));
  return d.toISOString().slice(0, 10);
}

/** Dias até o prazo (negativo: atrasado) — só para o pedido ainda não pago nem encerrado. */
export function diasParaOPrazo(prazo: string, hoje: string): number {
  return Math.round(
    (Date.parse(`${prazo}T00:00:00Z`) - Date.parse(`${hoje.slice(0, 10)}T00:00:00Z`)) / 86_400_000,
  );
}

const PASSAGENS: Readonly<Record<SituacaoReembolso, readonly SituacaoReembolso[]>> = {
  solicitado: ['em_analise', 'pendente_documento', 'aprovado', 'aprovado_parcial', 'negado', 'cancelado'],
  em_analise: ['pendente_documento', 'aprovado', 'aprovado_parcial', 'negado', 'cancelado'],
  pendente_documento: ['em_analise', 'aprovado', 'aprovado_parcial', 'negado', 'cancelado'],
  aprovado: ['pago', 'cancelado'],
  aprovado_parcial: ['pago', 'cancelado'],
  negado: [],
  pago: [],
  cancelado: [],
};
/** A passagem de situação é permitida? */
export const podePassarReembolso = (de: SituacaoReembolso, para: SituacaoReembolso): boolean =>
  PASSAGENS[de].includes(para);
/** O pedido ainda pode ser analisado (glosa, pendência de documento)? */
export const emAnaliseReembolso = (s: SituacaoReembolso): boolean =>
  s === 'solicitado' || s === 'em_analise' || s === 'pendente_documento';
