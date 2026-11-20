// Cobrança e mensalidades da operadora própria (M56, etapa 3 de 8, fatia F2; ficha, seções 1 e 8, regra 6): regras
// puras, sem banco. A mensalidade da competência sai do preço da faixa etária da RN ANS 63/2003 (idade completa no
// último dia do mês anterior: a nova faixa vale no mês seguinte ao aniversário) com os reajustes vigentes do contrato,
// um item por beneficiário e uma cobrança por contrato (o pagador: o titular na pessoa física, o contratante na
// jurídica). A coparticipação avulsa segue a regra do produto (percentual do evento ou valor fixo, nunca acima do
// evento); a multa (até 2%) e os juros de mora (1% ao mês, pro rata dia) só depois do vencimento; o acordo divide o
// total em parcelas mensais (os centavos que sobram na última); o reajuste anual vale no aniversário do contrato, com
// 12 meses de intervalo e, no individual ou familiar, até o teto da ANS; a inadimplência do individual ou familiar
// segue a Lei 9.656/1998, art. 13, II, e a RN ANS 593/2023. Os parâmetros vêm de PARAMETROS_COBRANCA (@sgh/contratos).
import { PARAMETROS_COBRANCA, type SituacaoInadimplencia } from '@sgh/contratos';
import { somarDias, somarMeses } from './carteirinha.js';
import { faixaEtariaDaIdade, idadeEm } from './plano.js';

/** Arredonda ao centavo (meio centavo para cima), sem o erro do ponto flutuante. */
export function centavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** A competência `AAAA-MM` é válida? */
export function competenciaCobrancaValida(c: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(c);
}

/** Primeiro dia da competência (AAAA-MM-01). */
export function primeiroDia(c: string): string {
  return `${c}-01`;
}

/** Último dia da competência. */
export function ultimoDia(c: string): string {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** Competência da data (AAAA-MM-DD → AAAA-MM). */
export const competenciaDe = (data: string): string => data.slice(0, 7);

/** Competência somada de meses (`2026-11` + 2 → `2027-01`). */
export function somarCompetencia(c: string, meses: number): string {
  return competenciaDe(somarMeses(primeiroDia(c), meses));
}

/** Dias corridos de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** Vencimento da competência no dia do contrato (o dia que o mês não tem vai para o último). */
export function vencimentoDaCompetencia(c: string, dia: number): string {
  const ultimo = ultimoDia(c);
  const d = Math.min(dia, Number(ultimo.slice(8, 10)));
  return `${c}-${String(d).padStart(2, '0')}`;
}

/** Idade para a faixa da competência: completa no último dia do mês anterior (a faixa nova vale no mês seguinte). */
export function idadeNaCompetencia(nascimento: string, c: string): number {
  return Math.max(0, idadeEm(nascimento, somarDias(primeiroDia(c), -1)));
}

/** Preço reajustado: cada reajuste sobre o valor já reajustado, arredondado ao centavo a cada passo. */
export function precoReajustado(base: number, percentuais: readonly number[]): number {
  return percentuais.reduce((v, p) => centavos(v * (1 + p / 100)), centavos(base));
}

// ── Mensalidade ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface ContratoParaCobrar {
  readonly id: number;
  /** 1 pessoa física (individual ou familiar), 2 pessoa jurídica. */
  readonly tipo: number;
  readonly situacao: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly diaVencimento: number | null;
  /** Preços das 10 faixas do produto (null sem tabela). */
  readonly precos: readonly number[] | null;
}

export interface BeneficiarioParaCobrar {
  readonly id: number;
  readonly titular: number | null;
  readonly nascimento: string;
  readonly inclusao: string;
  readonly situacao: string;
  readonly exclusao: string | null;
}

export interface ReajusteParaCobrar {
  readonly competencia: string;
  readonly percentual: number;
}

export type MotivoSemMensalidade =
  | 'contrato-inativo'
  | 'contrato-fora-da-vigencia'
  | 'contrato-sem-dia-vencimento'
  | 'produto-sem-precos'
  | 'sem-beneficiarios'
  | 'ja-gerada';

export interface ItemMensalidade {
  readonly beneficiario: number;
  readonly idade: number;
  readonly faixa: number;
  readonly valorTabela: number;
  readonly valor: number;
}

export type ResultadoMensalidade =
  | {
      readonly gerar: true;
      /** O titular (pessoa física) ou null (o contratante da jurídica). */
      readonly beneficiario: number | null;
      readonly vencimento: string;
      readonly valor: number;
      readonly itens: readonly ItemMensalidade[];
    }
  | { readonly gerar: false; readonly motivo: MotivoSemMensalidade };

/** O beneficiário entra na mensalidade da competência? Incluído até o último dia e não excluído antes do primeiro. */
export function beneficiarioCobravel(b: BeneficiarioParaCobrar, c: string): boolean {
  if (b.inclusao > ultimoDia(c)) return false;
  if (b.situacao === 'excluido') return b.exclusao !== null && b.exclusao > primeiroDia(c);
  return true;
}

/**
 * A mensalidade do contrato na competência (D-MENSALIDADE-56): contrato ativo com a vigência cobrindo a competência,
 * dia de vencimento e tabela de preços; um item por beneficiário cobrável, com o preço da faixa e os reajustes do
 * contrato vigentes até a competência; sem proporcional no mês da adesão ou da exclusão (D-PRORATA-56).
 */
export function mensalidadeDoContrato(x: {
  readonly contrato: ContratoParaCobrar;
  readonly beneficiarios: readonly BeneficiarioParaCobrar[];
  readonly reajustes: readonly ReajusteParaCobrar[];
  readonly competencia: string;
  readonly jaGerada: boolean;
}): ResultadoMensalidade {
  const { contrato: k, competencia: c } = x;
  if (x.jaGerada) return { gerar: false, motivo: 'ja-gerada' };
  if (k.situacao !== 'ativo') return { gerar: false, motivo: 'contrato-inativo' };
  if (k.inicio > ultimoDia(c) || (k.fim !== null && k.fim < primeiroDia(c)))
    return { gerar: false, motivo: 'contrato-fora-da-vigencia' };
  if (k.diaVencimento === null) return { gerar: false, motivo: 'contrato-sem-dia-vencimento' };
  if (!k.precos || k.precos.length !== 10) return { gerar: false, motivo: 'produto-sem-precos' };
  const percentuais = [...x.reajustes]
    .filter((r) => r.competencia <= c)
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .map((r) => r.percentual);
  const cobraveis = x.beneficiarios
    .filter((b) => beneficiarioCobravel(b, c))
    .sort((a, b) => (a.titular === null ? 0 : 1) - (b.titular === null ? 0 : 1) || a.id - b.id);
  if (cobraveis.length === 0) return { gerar: false, motivo: 'sem-beneficiarios' };
  const itens = cobraveis.map((b): ItemMensalidade => {
    const idade = idadeNaCompetencia(b.nascimento, c);
    const faixa = faixaEtariaDaIdade(idade);
    const valorTabela = centavos(k.precos![faixa] ?? 0);
    return {
      beneficiario: b.id,
      idade,
      faixa,
      valorTabela,
      valor: precoReajustado(valorTabela, percentuais),
    };
  });
  const valor = centavos(itens.reduce((s, i) => s + i.valor, 0));
  if (valor <= 0) return { gerar: false, motivo: 'produto-sem-precos' };
  const titular = k.tipo === 1 ? (cobraveis.find((b) => b.titular === null)?.id ?? null) : null;
  return {
    gerar: true,
    beneficiario: titular,
    vencimento: vencimentoDaCompetencia(c, k.diaVencimento),
    valor,
    itens,
  };
}

// ── Coparticipação e avulsa ─────────────────────────────────────────────────────────────────────────────────────

export type ProblemaLancamento = 'competencia-invalida' | 'vencimento-antes-da-competencia';

/** Valor da coparticipação do evento pela regra do produto (tipo 2 percentual; 3 valor fixo, até o evento). */
export function valorCoparticipacao(
  regra: { readonly tipo: number; readonly valor: number | null },
  valorEvento: number,
): number | null {
  if (regra.tipo === 2 && regra.valor !== null) return centavos((valorEvento * regra.valor) / 100);
  if (regra.tipo === 3 && regra.valor !== null) return centavos(Math.min(regra.valor, valorEvento));
  return null;
}

/**
 * O lançamento avulso (coparticipação ou cobrança avulsa): a competência válida e o vencimento a partir do mês anterior
 * a ela. A dívida do evento continua depois da exclusão do beneficiário ou do fim do contrato (D-LANCAMENTO-56).
 */
export function problemasDoLancamento(x: {
  readonly competencia: string;
  readonly vencimento: string;
}): ProblemaLancamento[] {
  if (!competenciaCobrancaValida(x.competencia)) return ['competencia-invalida'];
  return x.vencimento < primeiroDia(somarCompetencia(x.competencia, -1))
    ? ['vencimento-antes-da-competencia']
    : [];
}

// ── Encargos e baixa ────────────────────────────────────────────────────────────────────────────────────────────

export interface Encargos {
  readonly multa: number;
  readonly juros: number;
  readonly total: number;
}

/** Multa e juros de mora de uma cobrança paga na data (zero até o vencimento). */
export function encargosNaData(valor: number, vencimento: string, data: string): Encargos {
  const dias = diasEntre(vencimento, data);
  if (dias <= 0) return { multa: 0, juros: 0, total: 0 };
  const multa = centavos((valor * PARAMETROS_COBRANCA.multaPercentual) / 100);
  const juros = centavos((valor * PARAMETROS_COBRANCA.jurosPercentualMes * dias) / 100 / 30);
  return { multa, juros, total: centavos(multa + juros) };
}

export type ProblemaBaixaCobranca =
  | 'nao-aberta'
  | 'pagamento-futuro'
  | 'pagamento-antes-da-emissao'
  | 'valor-divergente'
  | 'dispensa-sem-motivo';

/** A baixa confere com o devido na data (valor mais encargos, ou só o valor com a dispensa e o motivo). */
export function problemasDaBaixaCobranca(x: {
  readonly situacao: string;
  readonly valor: number;
  readonly vencimento: string;
  readonly emitidaEm: string;
  readonly hoje: string;
  readonly pagoEm: string;
  readonly valorPago: number;
  readonly dispensarEncargos: boolean;
  readonly motivoDispensa: string | null;
}): { problemas: ProblemaBaixaCobranca[]; encargos: Encargos; devido: number } {
  const p: ProblemaBaixaCobranca[] = [];
  const calculados = encargosNaData(x.valor, x.vencimento, x.pagoEm);
  const encargos = x.dispensarEncargos ? { multa: 0, juros: 0, total: 0 } : calculados;
  const devido = centavos(x.valor + encargos.total);
  if (x.situacao !== 'aberta') p.push('nao-aberta');
  if (x.pagoEm > x.hoje) p.push('pagamento-futuro');
  if (x.pagoEm < x.emitidaEm) p.push('pagamento-antes-da-emissao');
  if (x.dispensarEncargos && calculados.total > 0 && !x.motivoDispensa?.trim()) p.push('dispensa-sem-motivo');
  if (Math.round(x.valorPago * 100) !== Math.round(devido * 100)) p.push('valor-divergente');
  return { problemas: p, encargos, devido };
}

// ── Acordo ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProblemaAcordo =
  | 'acordo-de-outro-contrato'
  | 'acordo-cobranca-nao-aberta'
  | 'acordo-cobranca-repetida'
  | 'acordo-vencimento-passado'
  | 'acordo-parcela-zero'
  | 'dispensa-sem-motivo';

export interface CobrancaParaAcordo {
  readonly id: number;
  readonly contrato: number;
  readonly situacao: string;
  readonly valor: number;
  readonly vencimento: string;
}

export interface AcordoCalculado {
  readonly principal: number;
  readonly encargos: number;
  readonly total: number;
  readonly cobrancas: readonly { id: number; valor: number; encargos: Encargos; diasAtraso: number }[];
  readonly parcelas: readonly { numero: number; vencimento: string; valor: number }[];
}

/** O acordo na data: as cobranças com os encargos até ela (ou dispensados) e as parcelas mensais. */
export function calcularAcordo(x: {
  readonly contrato: number;
  readonly cobrancas: readonly CobrancaParaAcordo[];
  readonly hoje: string;
  readonly parcelas: number;
  readonly primeiroVencimento: string;
  readonly dispensarEncargos: boolean;
  readonly motivoDispensa: string | null;
}): { problemas: ProblemaAcordo[]; acordo: AcordoCalculado } {
  const p: ProblemaAcordo[] = [];
  if (new Set(x.cobrancas.map((c) => c.id)).size !== x.cobrancas.length) p.push('acordo-cobranca-repetida');
  if (x.cobrancas.some((c) => c.contrato !== x.contrato)) p.push('acordo-de-outro-contrato');
  if (x.cobrancas.some((c) => c.situacao !== 'aberta')) p.push('acordo-cobranca-nao-aberta');
  if (x.primeiroVencimento < x.hoje) p.push('acordo-vencimento-passado');
  const itens = x.cobrancas.map((c) => {
    const calculado = encargosNaData(c.valor, c.vencimento, x.hoje);
    return {
      id: c.id,
      valor: centavos(c.valor),
      encargos: x.dispensarEncargos ? { multa: 0, juros: 0, total: 0 } : calculado,
      diasAtraso: Math.max(0, diasEntre(c.vencimento, x.hoje)),
      bruto: calculado.total,
    };
  });
  if (x.dispensarEncargos && itens.some((i) => i.bruto > 0) && !x.motivoDispensa?.trim())
    p.push('dispensa-sem-motivo');
  const principal = centavos(itens.reduce((s, i) => s + i.valor, 0));
  const encargos = centavos(itens.reduce((s, i) => s + i.encargos.total, 0));
  const total = centavos(principal + encargos);
  const totalCent = Math.round(total * 100);
  const n = Math.max(1, x.parcelas);
  const base = Math.floor(totalCent / n);
  if (base < 1) p.push('acordo-parcela-zero');
  const parcelas = Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    vencimento: somarMeses(x.primeiroVencimento, i),
    valor: (i === n - 1 ? totalCent - base * (n - 1) : base) / 100,
  }));
  return {
    problemas: p,
    acordo: {
      principal,
      encargos,
      total,
      cobrancas: itens.map((i) => ({
        id: i.id,
        valor: i.valor,
        encargos: i.encargos,
        diasAtraso: i.diasAtraso,
      })),
      parcelas,
    },
  };
}

// ── Reajuste ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProblemaReajuste =
  | 'competencia-invalida'
  | 'contrato-encerrado'
  | 'reajuste-fora-do-aniversario'
  | 'reajuste-antes-de-12-meses'
  | 'reajuste-intervalo-menor'
  | 'reajuste-percentual-zero'
  | 'reajuste-sem-teto-ans'
  | 'reajuste-acima-do-teto'
  | 'reajuste-teto-so-individual'
  | 'reajuste-competencia-cobrada'
  | 'reajuste-ja-registrado';

export type AvisoReajuste = 'reajuste-agrupamento';

/**
 * O reajuste anual do contrato (D-REAJUSTE-56): na competência do mês de aniversário (o mês do reajuste do contrato),
 * só 12 meses depois do início e 12 meses depois do último reajuste vigente; antes de a mensalidade da competência ser
 * gerada. No individual ou familiar, com o teto e o ofício da ANS (o percentual até o teto); no coletivo com menos de
 * 30 vidas, o aviso do agrupamento (RN ANS 565/2022).
 */
export function conferirReajuste(x: {
  readonly competencia: string;
  readonly percentual: number;
  readonly tetoAns: number | null;
  readonly oficioAns: string | null;
  readonly contrato: {
    readonly situacao: string;
    readonly inicio: string;
    readonly mesReajuste: number;
    /** 1 individual ou familiar, 2 coletivo empresarial, 3 coletivo por adesão. */
    readonly tipoContratacao: number;
  };
  /** Competências dos reajustes vigentes do contrato. */
  readonly reajustesVigentes: readonly string[];
  /** A maior competência de mensalidade não cancelada do contrato (null sem nenhuma). */
  readonly ultimaMensalidade: string | null;
  readonly vidas: number;
}): { problemas: ProblemaReajuste[]; avisos: AvisoReajuste[] } {
  const p: ProblemaReajuste[] = [];
  const a: AvisoReajuste[] = [];
  const c = x.competencia;
  if (!competenciaCobrancaValida(c)) return { problemas: ['competencia-invalida'], avisos: [] };
  if (x.contrato.situacao === 'encerrado') p.push('contrato-encerrado');
  if (Number(c.slice(5, 7)) !== x.contrato.mesReajuste) p.push('reajuste-fora-do-aniversario');
  if (primeiroDia(c) < somarMeses(primeiroDia(competenciaDe(x.contrato.inicio)), 12))
    p.push('reajuste-antes-de-12-meses');
  if (x.reajustesVigentes.includes(c)) p.push('reajuste-ja-registrado');
  else if (x.reajustesVigentes.some((r) => r < c && somarCompetencia(r, 12) > c))
    p.push('reajuste-intervalo-menor');
  else if (x.reajustesVigentes.some((r) => r > c && somarCompetencia(c, 12) > r))
    p.push('reajuste-intervalo-menor');
  if (x.percentual === 0) p.push('reajuste-percentual-zero');
  if (x.contrato.tipoContratacao === 1) {
    if (x.tetoAns === null || !x.oficioAns?.trim()) p.push('reajuste-sem-teto-ans');
    else if (x.percentual > x.tetoAns) p.push('reajuste-acima-do-teto');
  } else {
    if (x.tetoAns !== null) p.push('reajuste-teto-so-individual');
    if (x.vidas < PARAMETROS_COBRANCA.vidasAgrupamento) a.push('reajuste-agrupamento');
  }
  if (x.ultimaMensalidade !== null && x.ultimaMensalidade >= c) p.push('reajuste-competencia-cobrada');
  return { problemas: p, avisos: a };
}

// ── Inadimplência ───────────────────────────────────────────────────────────────────────────────────────────────

export interface CobrancaParaInadimplencia {
  readonly tipo: number;
  readonly vencimento: string;
  readonly situacao: string;
  /** Data da última mudança de situação (o pagamento na paga; a do acordo na renegociada). */
  readonly situacaoEm: string;
  readonly notificadoEm: string | null;
  readonly notificacaoMeio?: string | null;
}

export interface Inadimplencia {
  readonly situacao: SituacaoInadimplencia;
  readonly vencidas: number;
  readonly vencimentoMaisAntigo: string | null;
  readonly diasAtrasoAtual: number;
  readonly diasAcumulados12m: number;
  readonly mensalidadesEmAtraso12m: number;
  readonly notificadoEm: string | null;
  readonly notificacaoMeio: string | null;
  readonly prazoNotificacao: string | null;
  readonly prazoPagamento: string | null;
}

/** Cobranças que contam na inadimplência: as mensalidades e as parcelas de acordo (que as substituem). */
const CONTAM = new Set([1, 4]);

/**
 * A inadimplência do contrato na data (D-INADIMPLENCIA-56): os dias de atraso nos últimos 12 meses (a união dos
 * períodos entre o vencimento e o pagamento, a renegociação ou hoje; o mesmo dia conta uma vez), as mensalidades não
 * pagas no prazo e a notificação das vencidas em aberto. Individual ou familiar (tipo de contratação 1): notificar até o
 * 50º dia; com a notificação, mais de 60 dias, duas mensalidades e 10 dias depois da notificação, pode suspender ou
 * rescindir. Coletivo: só o atraso (segue o contrato).
 */
export function situacaoInadimplencia(x: {
  readonly cobrancas: readonly CobrancaParaInadimplencia[];
  readonly hoje: string;
  readonly tipoContratacao: number;
}): Inadimplencia {
  const P = PARAMETROS_COBRANCA;
  const inicioJanela = somarDias(x.hoje, -365);
  const conta = x.cobrancas.filter((c) => CONTAM.has(c.tipo) && c.situacao !== 'cancelada');
  const vencidasAbertas = conta
    .filter((c) => c.situacao === 'aberta' && c.vencimento < x.hoje)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  // Dias de atraso na janela: cada dia (depois do vencimento até o fim do atraso) uma vez só.
  const dias = new Set<string>();
  let atrasadas = 0;
  for (const c of conta) {
    const fim = c.situacao === 'aberta' ? x.hoje : c.situacaoEm;
    if (fim <= c.vencimento) continue;
    if (fim < inicioJanela) continue;
    atrasadas++;
    let d = somarDias(c.vencimento, 1);
    if (d < inicioJanela) d = inicioJanela;
    for (; d <= fim; d = somarDias(d, 1)) dias.add(d);
  }
  const antiga = vencidasAbertas[0] ?? null;
  const diasAtrasoAtual = antiga ? diasEntre(antiga.vencimento, x.hoje) : 0;
  const notificada = vencidasAbertas.find((c) => c.notificadoEm !== null) ?? null;
  const notificadoEm = notificada?.notificadoEm ?? null;
  const base = {
    vencidas: vencidasAbertas.length,
    vencimentoMaisAntigo: antiga?.vencimento ?? null,
    diasAtrasoAtual,
    diasAcumulados12m: dias.size,
    mensalidadesEmAtraso12m: atrasadas,
    notificadoEm,
    notificacaoMeio: notificada?.notificacaoMeio ?? null,
  };
  if (!antiga) return { ...base, situacao: 'em-dia', prazoNotificacao: null, prazoPagamento: null };
  if (x.tipoContratacao !== 1)
    return { ...base, situacao: 'conforme-contrato', prazoNotificacao: null, prazoPagamento: null };
  if (!notificadoEm) {
    const prazo = somarDias(x.hoje, P.diasLimiteNotificacao - dias.size);
    return { ...base, situacao: 'notificar', prazoNotificacao: prazo, prazoPagamento: null };
  }
  const prazoPagamento = somarDias(notificadoEm, P.diasPrazoNotificacao);
  const pode =
    dias.size > P.diasInadimplencia && atrasadas >= P.mensalidadesMinimas && x.hoje > prazoPagamento;
  return {
    ...base,
    situacao: pode ? 'passivel-suspensao' : 'aguardando-prazo',
    prazoNotificacao: null,
    prazoPagamento,
  };
}

export type ProblemaNotificacao =
  'notificacao-sem-atraso' | 'notificacao-futura' | 'notificacao-antes-do-vencimento';

/** A notificação registrada vale: há vencida em aberto, a data é de hoje para trás e depois do vencimento. */
export function problemasDaNotificacao(x: {
  readonly em: string;
  readonly hoje: string;
  readonly vencimentoMaisAntigo: string | null;
}): ProblemaNotificacao[] {
  if (x.vencimentoMaisAntigo === null) return ['notificacao-sem-atraso'];
  const p: ProblemaNotificacao[] = [];
  if (x.em > x.hoje) p.push('notificacao-futura');
  if (x.em <= x.vencimentoMaisAntigo) p.push('notificacao-antes-do-vencimento');
  return p;
}
