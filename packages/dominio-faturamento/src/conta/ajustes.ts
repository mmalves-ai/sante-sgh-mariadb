// Ajustes de valor na conta do paciente (F3.7, 06-FAT linhas 17, 18 e 20). Regra pura, sem banco: a API lê, confere
// por aqui e grava; a tela usa as mesmas funções para validar enquanto se digita.
// - Linha 17: acréscimo por horário especial (noturno, fim de semana, feriado, fora do expediente da tabela). Vale a
//   faixa mais específica (do acordo da operadora antes da geral) e, entre as do mesmo nível, a de maior percentual:
//   os acréscimos não se somam (prática de mercado da urgência).
// - Linha 18: acréscimo ou desconto na conta com motivo, justificativa e alçada (quem pede não aprova; a decisão fica
//   na trilha). O total da conta só muda com o ajuste aprovado.
// - Linha 20: pacote na conta. Versão vigente na data, itens inclusos, exceções (cobrar à parte ou descaracterizar),
//   tetos e diárias por acomodação. Teto superado só gera alerta: quem descaracteriza é a pessoa, com motivo.

const r2 = (x: number) => Math.round(x * 100) / 100;

// ── Linha 17: horário especial ──────────────────────────────────────────────────────────────────────

export type TipoHorarioEspecial = 'noturno' | 'fim_de_semana' | 'feriado' | 'apos_horario' | 'outro';

export interface FaixaHorarioEspecial {
  readonly id: number;
  readonly codigo: string;
  readonly tipoHorario: TipoHorarioEspecial;
  /** 1 = domingo a 7 = sábado; nulo: todos os dias. */
  readonly diaSemana: number | null;
  readonly aplicaFeriado: boolean;
  /** 'HH:MM' ou 'HH:MM:SS'; a faixa pode virar a meia-noite (fim menor que início). */
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  readonly percentual: number;
  readonly percentualHonorario: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  /** Nulo: vale para todas as fontes pagadoras. */
  readonly fontePagadoraId: number | null;
  readonly ativo: boolean;
}

/** Expediente da tabela de preço: 0 = domingo a 6 = sábado. */
export interface ExpedienteTabela {
  readonly diaSemana: number;
  readonly horaInicio: string;
  readonly horaFim: string;
}

const minutos = (h: string) => {
  const [hh, mm] = h.split(':');
  return Number(hh) * 60 + Number(mm ?? 0);
};

/** Dia da semana de 'AAAA-MM-DD' (0 = domingo), sem fuso. */
export function diaDaSemana(data: string): number {
  const [a, m, d] = data.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

function naFaixa(min: number, inicio: string, fim: string): boolean {
  const i = minutos(inicio);
  const f = minutos(fim);
  return i <= f ? min >= i && min < f : min >= i || min < f;
}

export interface HorarioDoItem {
  /** 'AAAA-MM-DDTHH:MM' no relógio do hospital. */
  readonly quando: string;
  readonly feriado: boolean;
  readonly fontePagadoraId: number;
}

/** A faixa de horário especial que vale para o momento do item, ou nulo (horário normal). */
export function faixaDoHorario(
  h: HorarioDoItem,
  faixas: readonly FaixaHorarioEspecial[],
  expediente: readonly ExpedienteTabela[] = [],
): FaixaHorarioEspecial | null {
  const data = h.quando.slice(0, 10);
  const min = minutos(h.quando.slice(11, 16) || '00:00');
  const dow = diaDaSemana(data);
  const fimDeSemana = dow === 0 || dow === 6;
  const doDia = expediente.filter((x) => x.diaSemana === dow);
  const foraDoExpediente = expediente.length > 0 && !doDia.some((x) => naFaixa(min, x.horaInicio, x.horaFim));
  const valem = faixas.filter((f) => {
    if (!f.ativo || f.vigenciaInicio > data || (f.vigenciaFim !== null && f.vigenciaFim < data)) return false;
    if (f.fontePagadoraId !== null && f.fontePagadoraId !== h.fontePagadoraId) return false;
    if (h.feriado && (f.aplicaFeriado || f.tipoHorario === 'feriado')) return true;
    if (f.diaSemana !== null && f.diaSemana !== dow + 1) return false;
    const naHora = f.horaInicio === null || f.horaFim === null || naFaixa(min, f.horaInicio, f.horaFim);
    switch (f.tipoHorario) {
      case 'feriado':
        return false;
      case 'fim_de_semana':
        return (f.diaSemana !== null || fimDeSemana) && naHora;
      case 'apos_horario':
        return foraDoExpediente && naHora;
      default:
        return f.horaInicio !== null && naHora;
    }
  });
  if (!valem.length) return null;
  return [...valem].sort(
    (a, b) =>
      Number(b.fontePagadoraId !== null) - Number(a.fontePagadoraId !== null) ||
      b.percentual - a.percentual ||
      a.id - b.id,
  )[0]!;
}

/** O acréscimo do item: honorário pelo percentual próprio (quando há) e o resto pelo percentual geral. */
export function acrescimoDoItem(base: number, honorario: number, faixa: FaixaHorarioEspecial): number {
  const hon = Math.min(Math.max(honorario, 0), base);
  const pH = faixa.percentualHonorario ?? faixa.percentual;
  return r2((hon * pH) / 100 + ((base - hon) * faixa.percentual) / 100);
}

export interface EntradaFaixaHorario {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoHorario: string;
  readonly diaSemana: number | null;
  readonly aplicaFeriado: boolean;
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  readonly percentual: number;
  readonly percentualHonorario: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Confere a faixa de acréscimo antes de gravar (mesmas regras na tela e na API). */
export function validarFaixaHorario(e: EntradaFaixaHorario): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!e.codigo.trim()) erros['codigo'] = 'Informe o código.';
  if (!e.descricao.trim()) erros['descricao'] = 'Informe a descrição.';
  if (!['noturno', 'fim_de_semana', 'feriado', 'apos_horario', 'outro'].includes(e.tipoHorario))
    erros['tipoHorario'] = 'Tipo de horário desconhecido.';
  if (e.diaSemana !== null && (e.diaSemana < 1 || e.diaSemana > 7))
    erros['diaSemana'] = 'O dia vai de 1 (domingo) a 7 (sábado).';
  if ((e.horaInicio === null) !== (e.horaFim === null))
    erros['horaFim'] = 'Informe o início e o fim da faixa, ou nenhum dos dois.';
  if (e.horaInicio !== null && !HORA.test(e.horaInicio)) erros['horaInicio'] = 'Hora inválida.';
  if (e.horaFim !== null && !HORA.test(e.horaFim)) erros['horaFim'] = 'Hora inválida.';
  if ((e.tipoHorario === 'noturno' || e.tipoHorario === 'outro') && e.horaInicio === null)
    erros['horaInicio'] = 'A faixa noturna precisa do horário.';
  if (e.horaInicio !== null && e.horaFim !== null && e.horaInicio === e.horaFim)
    erros['horaFim'] = 'O fim tem de ser diferente do início.';
  if (!(e.percentual > 0) || e.percentual > 300) erros['percentual'] = 'O percentual vai de 0,01 a 300.';
  if (e.percentualHonorario !== null && (e.percentualHonorario < 0 || e.percentualHonorario > 300))
    erros['percentualHonorario'] = 'O percentual do honorário vai de 0 a 300.';
  if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
    erros['vigenciaFim'] = 'O fim da vigência é anterior ao início.';
  return erros;
}

// ── Linha 18: acréscimo e desconto na conta ─────────────────────────────────────────────────────────

export type SituacaoAjuste = 'pendente_aprovacao' | 'aprovado' | 'recusado' | 'cancelado';

export interface EntradaAjusteConta {
  readonly tipo: 'acrescimo' | 'desconto';
  readonly forma: 'valor' | 'percentual';
  readonly valor: number | null;
  readonly percentual: number | null;
  readonly justificativa: string;
}

export interface MotivoAjuste {
  readonly tipoAjuste: 'acrescimo' | 'desconto';
  readonly ativo: boolean;
}

export interface ContextoAjuste {
  /** Soma dos itens cobrados da conta. */
  readonly valorItens: number;
  /** Descontos já aprovados ou pendentes (o pendente reserva a margem). */
  readonly descontosEmVigor: number;
  readonly acrescimosEmVigor: number;
}

/** Confere o ajuste e devolve o valor calculado (percentual sobre os itens). */
export function validarAjusteConta(
  e: EntradaAjusteConta,
  motivo: MotivoAjuste | null,
  c: ContextoAjuste,
): { erros: Record<string, string>; valor: number } {
  const erros: Record<string, string> = {};
  if (!motivo) erros['motivoId'] = 'Escolha o motivo.';
  else if (!motivo.ativo) erros['motivoId'] = 'O motivo está inativo.';
  else if (motivo.tipoAjuste !== e.tipo)
    erros['motivoId'] = `O motivo é de ${motivo.tipoAjuste === 'desconto' ? 'desconto' : 'acréscimo'}.`;
  if (e.justificativa.trim().length < 10) erros['justificativa'] = 'Justifique (ao menos 10 letras).';
  let valor = 0;
  if (e.forma === 'percentual') {
    if (e.percentual === null || !(e.percentual > 0) || e.percentual > 100)
      erros['percentual'] = 'O percentual vai de 0,01 a 100.';
    else valor = r2((c.valorItens * e.percentual) / 100);
  } else if (e.valor === null || !(e.valor > 0)) erros['valor'] = 'Informe um valor maior que zero.';
  else valor = r2(e.valor);
  if (!erros['percentual'] && !erros['valor'] && !(valor > 0))
    erros[e.forma === 'percentual' ? 'percentual' : 'valor'] =
      'O ajuste dá zero: a conta não tem itens cobrados.';
  if (
    e.tipo === 'desconto' &&
    valor > 0 &&
    r2(c.descontosEmVigor + valor) > r2(c.valorItens + c.acrescimosEmVigor)
  )
    erros['valor'] = 'O desconto passa do valor da conta.';
  return { erros, valor };
}

/** Quem pode decidir o ajuste: só o pendente e nunca quem pediu (alçada separada de quem lança). */
export function conferirDecisaoAjuste(
  situacao: SituacaoAjuste,
  solicitante: number,
  decisor: number | null,
  decisao: 'aprovar' | 'recusar' | 'cancelar',
): string | null {
  if (situacao !== 'pendente_aprovacao') return 'O ajuste já foi decidido.';
  if (decisor === null) return 'Decisão sem usuário identificado.';
  if (decisao === 'cancelar') return decisor === solicitante ? null : 'Só quem pediu cancela o pedido.';
  if (decisor === solicitante)
    return 'Quem pediu o ajuste não pode decidi-lo: peça a outro usuário com a alçada.';
  return null;
}

/** Totais de acréscimo e desconto da conta: só os ajustes aprovados mudam o valor. */
export function totaisDosAjustes(ajustes: readonly { tipo: string; situacao: string; valor: number }[]): {
  acrescimo: number;
  desconto: number;
} {
  let acrescimo = 0;
  let desconto = 0;
  for (const a of ajustes)
    if (a.situacao === 'aprovado') {
      if (a.tipo === 'acrescimo') acrescimo += a.valor;
      else desconto += a.valor;
    }
  return { acrescimo: r2(acrescimo), desconto: r2(desconto) };
}

// ── Linha 20: pacote na conta ──────────────────────────────────────────────────────────────────────

export interface VersaoPacote {
  readonly id: number;
  readonly numero: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly valor: number | null;
}

/** A versão do pacote vigente na data (a de maior número entre as que cobrem a data). */
export function versaoVigente(versoes: readonly VersaoPacote[], data: string): VersaoPacote | null {
  const d = data.slice(0, 10);
  return (
    [...versoes]
      .filter((v) => v.vigenciaInicio <= d && (v.vigenciaFim === null || v.vigenciaFim >= d))
      .sort((a, b) => b.numero - a.numero)[0] ?? null
  );
}

/** Nova versão: começa depois da vigente e a fecha na véspera. */
export function validarNovaVersao(
  versoes: readonly VersaoPacote[],
  inicio: string,
  valor: number | null,
): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) erros['vigenciaInicio'] = 'Data inválida.';
  const ultima = [...versoes].sort((a, b) => b.numero - a.numero)[0];
  if (ultima && inicio <= ultima.vigenciaInicio)
    erros['vigenciaInicio'] =
      `A nova versão começa depois de ${ultima.vigenciaInicio} (início da versão ${ultima.numero}).`;
  if (valor !== null && valor < 0) erros['valor'] = 'O valor não pode ser negativo.';
  return erros;
}

export const vespera = (d: string): string => {
  const [a, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, dd! - 1)).toISOString().slice(0, 10);
};

export interface RegraInclusao {
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly setorId: number | null;
  readonly quantidadeLimite: number | null;
}
export interface RegraExcecao {
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly setorId: number | null;
  readonly categoriaAcomodacaoId: number | null;
  readonly efeito: 'cobrar_a_parte' | 'descaracteriza';
}
export interface ItemParaPacote {
  readonly id: number;
  readonly itemId: number;
  readonly grupoId: number | null;
  readonly setorId: number | null;
  readonly quantidade: number;
  readonly valor: number;
}
export type Classe = 'incluso' | 'a_parte' | 'descaracteriza';

const casa = (
  r: { itemId: number | null; grupoId: number | null; setorId: number | null },
  i: ItemParaPacote,
) =>
  (r.itemId !== null ? r.itemId === i.itemId : r.grupoId !== null && r.grupoId === i.grupoId) &&
  (r.setorId === null || r.setorId === i.setorId);

/**
 * Classifica os itens da conta frente ao pacote: exceção vence inclusão; o item incluso por regra com limite cobre a
 * quantidade até o limite (o resto vai à parte); sem regra que o inclua, vai à parte. Pacote sem nenhuma inclusão
 * cadastrada cobre tudo o que não é exceção (pacote "fechado").
 */
export function classificarItens(
  itens: readonly ItemParaPacote[],
  inclusoes: readonly RegraInclusao[],
  excecoes: readonly RegraExcecao[],
  categoriaAcomodacaoId: number | null,
): Map<number, Classe> {
  const usado = new Map<RegraInclusao, number>();
  const r = new Map<number, Classe>();
  for (const i of [...itens].sort((a, b) => a.id - b.id)) {
    const ex = excecoes.find(
      (x) =>
        casa(x, i) && (x.categoriaAcomodacaoId === null || x.categoriaAcomodacaoId === categoriaAcomodacaoId),
    );
    if (ex) {
      r.set(i.id, ex.efeito === 'descaracteriza' ? 'descaracteriza' : 'a_parte');
      continue;
    }
    if (!inclusoes.length) {
      r.set(i.id, 'incluso');
      continue;
    }
    const inc = inclusoes.find((x) => casa(x, i));
    if (!inc) {
      r.set(i.id, 'a_parte');
      continue;
    }
    const ja = usado.get(inc) ?? 0;
    if (inc.quantidadeLimite !== null && ja + i.quantidade > inc.quantidadeLimite) {
      r.set(i.id, 'a_parte');
      continue;
    }
    usado.set(inc, ja + i.quantidade);
    r.set(i.id, 'incluso');
  }
  return r;
}

export interface TetoPacote {
  readonly id: number;
  readonly grupoId: number | null;
  readonly diasTeto: number | null;
  readonly quantidadeTeto: number | null;
  readonly valorTeto: number | null;
  readonly descaracteriza: boolean;
}
export interface AlertaPacote {
  readonly tipo: 'teto' | 'excecao' | 'diarias';
  readonly descaracteriza: boolean;
  readonly mensagem: string;
}

/** Confere os tetos e as exceções que descaracterizam: devolve alertas, nunca descaracteriza sozinho. */
export function alertasDoPacote(
  itens: readonly ItemParaPacote[],
  classes: ReadonlyMap<number, Classe>,
  tetos: readonly TetoPacote[],
  dias: number,
  diariasIncluidas: number | null,
): AlertaPacote[] {
  const a: AlertaPacote[] = [];
  const inclusos = itens.filter((i) => classes.get(i.id) === 'incluso');
  for (const t of tetos) {
    const doGrupo = t.grupoId === null ? inclusos : inclusos.filter((i) => i.grupoId === t.grupoId);
    const alvo = t.grupoId === null ? 'do pacote' : `do grupo ${t.grupoId}`;
    if (t.diasTeto !== null && dias > t.diasTeto)
      a.push({
        tipo: 'teto',
        descaracteriza: t.descaracteriza,
        mensagem: `Permanência de ${dias} dias passa o teto de ${t.diasTeto} dias ${alvo}.`,
      });
    const q = doGrupo.reduce((s, i) => s + i.quantidade, 0);
    if (t.quantidadeTeto !== null && q > t.quantidadeTeto)
      a.push({
        tipo: 'teto',
        descaracteriza: t.descaracteriza,
        mensagem: `Quantidade ${q} passa o teto de ${t.quantidadeTeto} ${alvo}.`,
      });
    const v = r2(doGrupo.reduce((s, i) => s + i.valor, 0));
    if (t.valorTeto !== null && v > t.valorTeto)
      a.push({
        tipo: 'teto',
        descaracteriza: t.descaracteriza,
        mensagem: `Consumo de ${v.toFixed(2)} passa o teto de ${t.valorTeto.toFixed(2)} ${alvo}.`,
      });
  }
  const d = itens.filter((i) => classes.get(i.id) === 'descaracteriza').length;
  if (d)
    a.push({
      tipo: 'excecao',
      descaracteriza: true,
      mensagem: `${d} item(ns) lançado(s) descaracterizam o pacote pela exceção cadastrada.`,
    });
  if (diariasIncluidas !== null && dias > diariasIncluidas)
    a.push({
      tipo: 'diarias',
      descaracteriza: false,
      mensagem: `${dias - diariasIncluidas} diária(s) além das ${diariasIncluidas} incluídas: cobradas à parte.`,
    });
  return a;
}

/** Dias de permanência entre o início e o fim (ou a data de referência), contando o dia de entrada. */
export function diasDePermanencia(inicio: string, fim: string): number {
  const a = Date.parse(`${inicio.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${fim.slice(0, 10)}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + (b > a ? 0 : 1));
}
