// Controle orçamentário na compra e no pagamento (C2-112, 07-FIN linha 130, F8). Regras puras, sem banco:
//   - a regra de controle é configurável por documento, plano, versão, centro, conta e natureza; vale a de menor
//     prioridade e, no empate, a mais específica; sem regra, o sistema só confere (registra o excesso, não trava),
//     porque a decisão de travar é do hospital (ADR 0002: ferramentas e alertas, sem travas automáticas);
//   - o saldo do período é o orçado menos o comprometido (reservas em aberto) e o realizado (consumido pelas notas e o
//     que a nota passou do pedido);
//   - a reserva que passa do saldo: "conferir" registra; "alertar" pede que o usuário confirme que está ciente;
//     "bloquear" só passa com exceção justificada e aprovada que cubra o excesso;
//   - a exceção tem justificativa e é decidida por outra pessoa (segregação de funções); a reprovação leva o parecer;
//   - a nota consome a reserva: a parcial consome o que veio; a final consome, libera a sobra e lança o ajuste
//     (realizado − comprometido, que pode ser negativo).
export interface ProblemaControle {
  readonly campo: string;
  readonly mensagem: string;
}

export const ACOES_CONTROLE = ['bloquear', 'alertar', 'conferir', 'nao_controlar'] as const;
export type AcaoControle = (typeof ACOES_CONTROLE)[number];
export const DOCUMENTOS_CONTROLE = [
  'todos',
  'solicitacao_compra',
  'pedido_compra',
  'nota_entrada',
  'titulo_pagar',
  'contrato',
] as const;
export type DocumentoControle = (typeof DOCUMENTOS_CONTROLE)[number];
/** Documentos que reservam saldo nesta função: o pedido de compra e o título a pagar. */
export const DOCUMENTOS_RESERVA = ['pedido_compra', 'titulo_pagar'] as const;
export type DocumentoReserva = (typeof DOCUMENTOS_RESERVA)[number];
export const PERIODOS_APURACAO = ['mensal', 'trimestral', 'anual', 'acumulado'] as const;
export type PeriodoApuracao = (typeof PERIODOS_APURACAO)[number];
export const SITUACOES_EXCECAO = ['pendente', 'aprovada', 'reprovada', 'cancelada', 'utilizada'] as const;
export type SituacaoExcecao = (typeof SITUACOES_EXCECAO)[number];
export const SITUACOES_RESERVA = ['ativa', 'parcial', 'consumida', 'liberada', 'cancelada'] as const;
export type SituacaoReserva = (typeof SITUACOES_RESERVA)[number];

const centavos = (v: number): number => Math.round(v * 100) / 100;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export interface RegraControle {
  readonly id: number;
  readonly acao: AcaoControle;
  readonly tipoDocumento: DocumentoControle;
  readonly planoOrcamentario: number | null;
  readonly versaoOrcamento: number | null;
  readonly centroCusto: number | null;
  readonly contaOrcamentaria: number | null;
  readonly naturezaFinanceira: number | null;
  readonly tolerancia: number;
  readonly periodo: PeriodoApuracao;
  readonly prioridade: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

/** O que está sendo controlado: o documento, a linha do orçamento e a data da operação. */
export interface AlvoControle {
  readonly tipoDocumento: DocumentoReserva;
  readonly planoOrcamentario: number | null;
  readonly versaoOrcamento: number;
  readonly centroCusto: number | null;
  readonly contaOrcamentaria: number | null;
  readonly naturezaFinanceira: number | null;
  readonly data: string;
}

const DIMENSOES = [
  ['planoOrcamentario', 'planoOrcamentario'],
  ['versaoOrcamento', 'versaoOrcamento'],
  ['centroCusto', 'centroCusto'],
  ['contaOrcamentaria', 'contaOrcamentaria'],
  ['naturezaFinanceira', 'naturezaFinanceira'],
] as const;

function especificidade(r: RegraControle): number {
  return DIMENSOES.filter(([k]) => r[k] !== null).length + (r.tipoDocumento === 'todos' ? 0 : 1);
}

/** A regra que vale para o alvo (null: nenhuma; o sistema só confere). */
export function regraAplicavel(regras: readonly RegraControle[], alvo: AlvoControle): RegraControle | null {
  const cabem = regras.filter(
    (r) =>
      r.ativo &&
      r.vigenciaInicio <= alvo.data &&
      (r.vigenciaFim === null || r.vigenciaFim >= alvo.data) &&
      (r.tipoDocumento === 'todos' || r.tipoDocumento === alvo.tipoDocumento) &&
      DIMENSOES.every(([k, a]) => r[k] === null || r[k] === alvo[a]),
  );
  cabem.sort((x, y) => x.prioridade - y.prioridade || especificidade(y) - especificidade(x) || x.id - y.id);
  return cabem[0] ?? null;
}

export interface RegraProposta {
  readonly acao: AcaoControle;
  readonly tipoDocumento: DocumentoControle;
  readonly planoOrcamentario: number | null;
  readonly versaoOrcamento: number | null;
  readonly centroCusto: number | null;
  readonly contaOrcamentaria: number | null;
  readonly naturezaFinanceira: number | null;
  readonly tolerancia: number;
  readonly periodo: PeriodoApuracao;
  readonly prioridade: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export function validarRegraControle(r: RegraProposta): ProblemaControle[] {
  const p: ProblemaControle[] = [];
  if (!ACOES_CONTROLE.includes(r.acao)) p.push({ campo: 'acao', mensagem: 'Escolha a ação da regra.' });
  if (!DOCUMENTOS_CONTROLE.includes(r.tipoDocumento))
    p.push({ campo: 'tipoDocumento', mensagem: 'Escolha o documento controlado.' });
  if (!PERIODOS_APURACAO.includes(r.periodo))
    p.push({ campo: 'periodo', mensagem: 'Escolha o período de apuração do saldo.' });
  if (!Number.isFinite(r.tolerancia) || r.tolerancia < 0 || r.tolerancia > 100)
    p.push({ campo: 'tolerancia', mensagem: 'A tolerância vai de 0 a 100% do orçado.' });
  if (!Number.isInteger(r.prioridade) || r.prioridade < 1 || r.prioridade > 999)
    p.push({ campo: 'prioridade', mensagem: 'A prioridade vai de 1 a 999 (a menor vale primeiro).' });
  if (!DATA.test(r.vigenciaInicio))
    p.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  else if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio)
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  const comEscopo =
    r.tipoDocumento !== 'todos' || DIMENSOES.some(([k]) => (r as unknown as RegraControle)[k] !== null);
  if (r.acao === 'nao_controlar' && !comEscopo)
    p.push({
      campo: 'acao',
      mensagem:
        'A regra que dispensa o controle precisa de um recorte (documento, centro, conta ou natureza).',
    });
  return p;
}

/** Os meses (1 a 12) que o período de apuração soma para a competência. */
export function mesesDoPeriodo(competencia: string, periodo: PeriodoApuracao): number[] {
  const m = Number(competencia.slice(5, 7));
  if (periodo === 'mensal') return [m];
  if (periodo === 'anual') return Array.from({ length: 12 }, (_, i) => i + 1);
  if (periodo === 'acumulado') return Array.from({ length: m }, (_, i) => i + 1);
  const ini = Math.floor((m - 1) / 3) * 3 + 1;
  return [ini, ini + 1, ini + 2];
}

/** O orçado da linha no período (os 12 valores mensais da linha). */
export function orcadoNoPeriodo(meses: readonly number[], competencia: string, periodo: PeriodoApuracao) {
  return centavos(mesesDoPeriodo(competencia, periodo).reduce((s, m) => s + (meses[m - 1] ?? 0), 0));
}

export interface ReservaParaSaldo {
  readonly reservado: number;
  readonly consumido: number;
  readonly liberado: number;
  readonly situacao: SituacaoReserva;
}

export interface SaldoOrcamentario {
  readonly orcado: number;
  readonly comprometido: number;
  readonly realizado: number;
  readonly disponivel: number;
}

/** O que a reserva ainda compromete. */
export function abertoDaReserva(r: ReservaParaSaldo): number {
  if (r.situacao === 'cancelada' || r.situacao === 'liberada') return 0;
  return Math.max(0, centavos(r.reservado - r.consumido - r.liberado));
}

/** Saldo = orçado − comprometido (reservas em aberto) − realizado (consumido + ajuste a maior das notas). */
export function saldoOrcamentario(
  orcado: number,
  reservas: readonly ReservaParaSaldo[],
  ajustes: readonly number[],
): SaldoOrcamentario {
  const comprometido = centavos(reservas.reduce((s, r) => s + abertoDaReserva(r), 0));
  const realizado = centavos(
    reservas.reduce((s, r) => s + (r.situacao === 'cancelada' ? 0 : r.consumido), 0) +
      ajustes.reduce((s, a) => s + Math.max(0, a), 0),
  );
  return {
    orcado: centavos(orcado),
    comprometido,
    realizado,
    disponivel: centavos(orcado - comprometido - realizado),
  };
}

export type DecisaoControle = 'livre' | 'registrado' | 'alerta' | 'bloqueio' | 'excecao' | 'sem_controle';

export interface ConferenciaSaldo {
  readonly acao: AcaoControle;
  readonly tolerancia: number;
  readonly saldo: SaldoOrcamentario;
  readonly valor: number;
  /** O usuário confirmou que está ciente do alerta. */
  readonly ciente: boolean;
  /** Valor da exceção aprovada para o documento (null: nenhuma). */
  readonly excecaoAprovada: number | null;
}

export interface ResultadoConferencia {
  readonly decisao: DecisaoControle;
  /** Quanto o valor passa do saldo disponível (0 quando cabe). */
  readonly excesso: number;
  readonly excedeuSaldo: boolean;
  /** Quem autoriza o excesso: o próprio usuário (registro ou alerta confirmado) ou o aprovador da exceção. */
  readonly autorizacao: 'sessao' | 'excecao' | null;
  readonly problemas: ProblemaControle[];
}

export function conferirSaldo(e: ConferenciaSaldo): ResultadoConferencia {
  const problemas: ProblemaControle[] = [];
  if (!Number.isFinite(e.valor) || e.valor <= 0)
    return {
      decisao: 'livre',
      excesso: 0,
      excedeuSaldo: false,
      autorizacao: null,
      problemas: [{ campo: 'valor', mensagem: 'O valor reservado deve ser maior que zero.' }],
    };
  const excesso = Math.max(0, centavos(e.valor - e.saldo.disponivel));
  const tolerado = centavos((e.saldo.orcado * e.tolerancia) / 100);
  const fim = (decisao: DecisaoControle, autorizacao: 'sessao' | 'excecao' | null) => ({
    decisao,
    excesso,
    excedeuSaldo: autorizacao !== null,
    autorizacao,
    problemas,
  });
  if (e.acao === 'nao_controlar') return fim('sem_controle', null);
  if (excesso === 0 || excesso <= tolerado) return fim('livre', null);
  if (e.acao === 'conferir') return fim('registrado', 'sessao');
  if (e.acao === 'alertar') {
    if (!e.ciente)
      problemas.push({
        campo: 'ciente',
        mensagem: `O valor passa do saldo orçado em ${excesso.toFixed(2)}; confirme que está ciente para reservar.`,
      });
    return fim('alerta', e.ciente ? 'sessao' : null);
  }
  if (e.excecaoAprovada !== null && e.excecaoAprovada >= excesso) return fim('excecao', 'excecao');
  problemas.push({
    campo: 'excecao',
    mensagem:
      e.excecaoAprovada === null
        ? `O valor passa do saldo orçado em ${excesso.toFixed(2)} e a regra bloqueia: peça uma exceção justificada.`
        : `A exceção aprovada (${e.excecaoAprovada.toFixed(2)}) não cobre o excesso de ${excesso.toFixed(2)}.`,
  });
  return fim('bloqueio', null);
}

export interface ExcecaoProposta {
  readonly valor: number;
  readonly justificativa: string;
}

export function validarExcecaoOrcamentaria(e: ExcecaoProposta): ProblemaControle[] {
  const p: ProblemaControle[] = [];
  if (!Number.isFinite(e.valor) || e.valor <= 0)
    p.push({ campo: 'valor', mensagem: 'O valor da exceção deve ser maior que zero.' });
  if (e.justificativa.trim().length < 20)
    p.push({ campo: 'justificativa', mensagem: 'Justifique a exceção (pelo menos 20 caracteres).' });
  return p;
}

export interface DecisaoExcecao {
  readonly situacao: SituacaoExcecao;
  readonly solicitante: number;
  readonly aprovador: number;
  readonly aprovar: boolean;
  readonly parecer: string | null;
}

export function validarDecisaoExcecao(d: DecisaoExcecao): ProblemaControle[] {
  const p: ProblemaControle[] = [];
  if (d.situacao !== 'pendente') p.push({ campo: 'situacao', mensagem: 'A exceção já foi decidida.' });
  if (d.solicitante === d.aprovador)
    p.push({ campo: 'aprovador', mensagem: 'Quem pediu a exceção não pode decidi-la.' });
  if (!d.aprovar && (d.parecer ?? '').trim().length < 5)
    p.push({ campo: 'parecer', mensagem: 'Diga o motivo da reprovação.' });
  return p;
}

export interface NotaNaReserva {
  readonly reserva: ReservaParaSaldo;
  /** Valor da nota (ou da parte dela) que realiza a reserva. */
  readonly realizado: number;
  /** A nota encerra a reserva (a sobra é liberada e a diferença vira ajuste). */
  readonly final: boolean;
}

export interface EfeitoDaNota {
  readonly consumir: number;
  readonly liberar: number;
  /** Realizado − comprometido em aberto, na nota final (pode ser negativo); 0 na parcial. */
  readonly ajuste: number;
  readonly comprometido: number;
  readonly situacao: SituacaoReserva;
  readonly problemas: ProblemaControle[];
}

export function efeitoDaNota(n: NotaNaReserva): EfeitoDaNota {
  const aberto = abertoDaReserva(n.reserva);
  const problemas: ProblemaControle[] = [];
  if (!['ativa', 'parcial'].includes(n.reserva.situacao) || aberto <= 0)
    problemas.push({ campo: 'reserva', mensagem: 'A reserva não tem saldo em aberto para a nota.' });
  if (!Number.isFinite(n.realizado) || n.realizado <= 0)
    problemas.push({ campo: 'valorRealizado', mensagem: 'Informe o valor da nota.' });
  if (!n.final && n.realizado >= aberto && problemas.length === 0)
    problemas.push({
      campo: 'final',
      mensagem: 'A nota parcial não pode chegar ao valor em aberto: marque-a como final.',
    });
  const vazio = { consumir: 0, liberar: 0, ajuste: 0, comprometido: aberto, situacao: n.reserva.situacao };
  if (problemas.length) return { ...vazio, problemas };
  const realizado = centavos(n.realizado);
  if (!n.final) return { ...vazio, consumir: realizado, situacao: 'parcial', problemas };
  const consumir = Math.min(realizado, aberto);
  return {
    consumir,
    liberar: centavos(aberto - consumir),
    ajuste: centavos(realizado - aberto),
    comprometido: aberto,
    situacao: 'consumida',
    problemas,
  };
}

/** Liberar a reserva (pedido cancelado, título baixado por outro meio): só a que tem saldo em aberto. */
export function validarLiberacaoReserva(r: ReservaParaSaldo, motivo: string): ProblemaControle[] {
  const p: ProblemaControle[] = [];
  if (!['ativa', 'parcial'].includes(r.situacao) || abertoDaReserva(r) <= 0)
    p.push({ campo: 'reserva', mensagem: 'A reserva não tem saldo em aberto para liberar.' });
  if (motivo.trim().length < 5) p.push({ campo: 'motivo', mensagem: 'Diga o motivo da liberação.' });
  return p;
}
