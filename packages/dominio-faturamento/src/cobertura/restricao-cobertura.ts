// F7 (09-AREA linha 76): restrição de cobertura por fonte pagadora e compatibilidade entre procedimentos.
// Regras puras: a porta lê do banco as restrições, os critérios, as exceções e os pares de compatibilidade e pergunta
// aqui se o lançamento passa. Desenho:
// - A restrição vale para a fonte (e o plano, quando dito) sobre um item, um grupo ou uma tabela; os critérios (setor,
//   faixa de idade, horário e dia da semana, profissional, prestador, plano, empresa da carteira, quantidade no
//   período, tipo de atendimento) se somam: a restrição só pega quando TODOS os critérios batem.
// - O tipo diz quando ela dispara (não coberto, exige autorização, exige justificativa, limite de quantidade, limite
//   de valor, só aviso); a ação diz o efeito (bloquear ou alertar).
// - A exceção registrada para o atendimento (com justificativa, autor e, se houver, quantidade) libera o bloqueio;
//   fica no resultado com o id, para a memória do lançamento.
// - Na prescrição nada bloqueia: o bloqueio vira alerta, para não impedir o ato assistencial (CFM); quem bloqueia é o
//   lançamento na conta, antes da glosa.
// - Compatibilidade: par incompatível na mesma conta (na janela de dias, quando dita) bloqueia; o item que exige o
//   relacionado alerta enquanto ele não estiver na conta; a quantidade limite do par bloqueia o excesso. A regra da
//   fonte prevalece sobre a regra geral do mesmo par.

export const TIPOS_ATENDIMENTO_COBERTURA = [
  'internacao',
  'ambulatorial',
  'externo',
  'urgencia',
  'domiciliar',
] as const;
export type TipoAtendimentoCobertura = (typeof TIPOS_ATENDIMENTO_COBERTURA)[number];

export const TIPOS_RESTRICAO_COBERTURA = [
  'nao_coberto',
  'exige_autorizacao',
  'exige_justificativa',
  'limite_quantidade',
  'limite_valor',
  'somente_aviso',
] as const;
export type TipoRestricaoCobertura = (typeof TIPOS_RESTRICAO_COBERTURA)[number];

export const TIPOS_CRITERIO_COBERTURA = [
  'setor',
  'faixa_idade',
  'horario',
  'profissional',
  'prestador',
  'plano',
  'empresa_carteira',
  'quantidade_periodo',
  'tipo_atendimento',
] as const;
export type TipoCriterioCobertura = (typeof TIPOS_CRITERIO_COBERTURA)[number];

export const PERIODOS_CRITERIO = ['dia', 'semana', 'mes', 'ano', 'atendimento'] as const;
export type PeriodoCriterio = (typeof PERIODOS_CRITERIO)[number];

export const TIPOS_RELACAO_PROCEDIMENTO = ['compativel', 'incompativel', 'associado'] as const;
export type TipoRelacaoProcedimento = (typeof TIPOS_RELACAO_PROCEDIMENTO)[number];

export interface CriterioCobertura {
  readonly tipo: TipoCriterioCobertura;
  readonly setorId?: number | null;
  readonly idadeMinima?: number | null;
  readonly idadeMaxima?: number | null;
  /** 'HH:MM'; a faixa pode virar a meia-noite (22:00 a 06:00). */
  readonly horaInicio?: string | null;
  readonly horaFim?: string | null;
  /** 1 domingo a 7 sábado; nulo: todos os dias. */
  readonly diaSemana?: number | null;
  readonly profissionalId?: number | null;
  /** O prestador terceiro do critério. */
  readonly prestadorId?: number | null;
  /** O profissional ligado ao prestador terceiro do critério (o executante do item é comparado com ele). */
  readonly prestadorProfissionalId?: number | null;
  readonly planoId?: number | null;
  readonly empresaId?: number | null;
  readonly quantidadeMaxima?: number | null;
  readonly periodo?: PeriodoCriterio | null;
  readonly tipoAtendimento?: TipoAtendimentoCobertura | null;
}

export interface RestricaoCobertura {
  readonly id: number;
  readonly descricao: string;
  readonly estabelecimentoId: number | null;
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly tabelaId: number | null;
  readonly tipo: TipoRestricaoCobertura;
  readonly acao: 'bloquear' | 'alertar';
  readonly tipoAtendimento: TipoAtendimentoCobertura | null;
  readonly valorLimite: number | null;
  readonly quantidadeLimite: number | null;
  readonly mensagem: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  readonly criterios: readonly CriterioCobertura[];
}

export interface ExcecaoCobertura {
  readonly id: number;
  /** Nula: liberação avulsa do item ou do grupo, sem apontar a restrição. */
  readonly restricaoId: number | null;
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly quantidadeAutorizada: number | null;
  readonly tiposAtendimento: readonly TipoAtendimentoCobertura[];
}

export interface ParCompatibilidade {
  readonly id: number;
  readonly fontePagadoraId: number | null;
  readonly itemId: number;
  readonly relacionadoId: number;
  readonly tipo: TipoRelacaoProcedimento;
  readonly exigeItem: boolean;
  readonly quantidadeLimite: number | null;
  readonly validadeDias: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

/** Item que já está na conta (ou no atendimento), para a compatibilidade e as quantidades. */
export interface ItemJaLancado {
  readonly itemId: number;
  readonly data: string;
  readonly quantidade: number;
}

export interface LancamentoCobertura {
  /** 'lancamento' bloqueia; 'prescricao' só alerta. */
  readonly contexto: 'lancamento' | 'prescricao';
  readonly estabelecimentoId: number;
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  readonly itemId: number;
  readonly grupoId: number | null;
  readonly tabelaId: number | null;
  /** 'AAAA-MM-DD' e 'HH:MM' no relógio do hospital. */
  readonly data: string;
  readonly hora: string;
  readonly setorId: number | null;
  readonly idade: number | null;
  readonly profissionalId: number | null;
  readonly empresaId: number | null;
  readonly tipoAtendimento: TipoAtendimentoCobertura;
  readonly quantidade: number;
  readonly valorTotal: number | null;
  readonly autorizado: boolean;
  readonly justificado: boolean;
  /** Quantidade do mesmo item já lançada, por janela ('atendimento' é a conta inteira). */
  readonly anteriores: Readonly<Partial<Record<PeriodoCriterio, number>>>;
  readonly naConta: readonly ItemJaLancado[];
}

export type EfeitoCobertura = 'bloqueio' | 'alerta' | 'liberado';

export interface AchadoCobertura {
  readonly origem: 'restricao' | 'compatibilidade';
  readonly id: number;
  readonly efeito: EfeitoCobertura;
  readonly motivo: string;
  readonly excecaoId: number | null;
}

export interface ResultadoCobertura {
  readonly situacao: 'livre' | 'alerta' | 'bloqueio';
  readonly achados: readonly AchadoCobertura[];
}

const hhmm = (h: string | null | undefined): number | null => {
  if (!h || !/^\d{2}:\d{2}/.test(h)) return null;
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
};

/** Dia da semana da data civil: 1 domingo a 7 sábado. */
export function diaDaSemana(data: string): number {
  return new Date(`${data.slice(0, 10)}T12:00:00Z`).getUTCDay() + 1;
}

/** Tipo de atendimento da conta pela natureza gravada nela. */
export function tipoAtendimentoDaNatureza(natureza: string): TipoAtendimentoCobertura {
  if (natureza === 'pronto_atendimento') return 'urgencia';
  return (TIPOS_ATENDIMENTO_COBERTURA as readonly string[]).includes(natureza)
    ? (natureza as TipoAtendimentoCobertura)
    : 'ambulatorial';
}

export function vigenteNaData(inicio: string, fim: string | null, data: string): boolean {
  const d = data.slice(0, 10);
  return inicio.slice(0, 10) <= d && (fim === null || fim.slice(0, 10) >= d);
}

function dentroDoHorario(c: CriterioCobertura, l: LancamentoCobertura): boolean {
  if (c.diaSemana != null && c.diaSemana !== diaDaSemana(l.data)) return false;
  const ini = hhmm(c.horaInicio);
  const fim = hhmm(c.horaFim);
  const h = hhmm(l.hora);
  if (ini === null || fim === null || h === null) return c.diaSemana != null;
  return ini <= fim ? h >= ini && h <= fim : h >= ini || h <= fim;
}

/** O critério bate com o lançamento? (Critério sem dado no lançamento não bate: na dúvida, não restringe.) */
export function criterioBate(c: CriterioCobertura, l: LancamentoCobertura): boolean {
  switch (c.tipo) {
    case 'setor':
      return l.setorId !== null && l.setorId === c.setorId;
    case 'faixa_idade':
      return (
        l.idade !== null &&
        (c.idadeMinima == null || l.idade >= c.idadeMinima) &&
        (c.idadeMaxima == null || l.idade <= c.idadeMaxima)
      );
    case 'horario':
      return dentroDoHorario(c, l);
    case 'profissional':
      return l.profissionalId !== null && l.profissionalId === c.profissionalId;
    case 'prestador':
      return l.profissionalId !== null && l.profissionalId === c.prestadorProfissionalId;
    case 'plano':
      return l.planoId !== null && l.planoId === c.planoId;
    case 'empresa_carteira':
      return l.empresaId !== null && l.empresaId === c.empresaId;
    case 'tipo_atendimento':
      return l.tipoAtendimento === c.tipoAtendimento;
    case 'quantidade_periodo': {
      if (!c.periodo || c.quantidadeMaxima == null) return false;
      return (l.anteriores[c.periodo] ?? 0) + l.quantidade > c.quantidadeMaxima;
    }
  }
}

/** A restrição alcança o lançamento (fonte, plano, alvo, vigência, estabelecimento, tipo e critérios)? */
export function restricaoAlcanca(r: RestricaoCobertura, l: LancamentoCobertura): boolean {
  if (!r.ativo || r.fontePagadoraId !== l.fontePagadoraId) return false;
  if (r.estabelecimentoId !== null && r.estabelecimentoId !== l.estabelecimentoId) return false;
  if (r.planoId !== null && r.planoId !== l.planoId) return false;
  if (!vigenteNaData(r.vigenciaInicio, r.vigenciaFim, l.data)) return false;
  if (r.tipoAtendimento !== null && r.tipoAtendimento !== l.tipoAtendimento) return false;
  const alvo =
    (r.itemId !== null && r.itemId === l.itemId) ||
    (r.grupoId !== null && l.grupoId !== null && r.grupoId === l.grupoId) ||
    (r.itemId === null && r.grupoId === null && r.tabelaId !== null && r.tabelaId === l.tabelaId);
  if (!alvo) return false;
  return r.criterios.every((c) => criterioBate(c, l));
}

/** O tipo da restrição dispara neste lançamento? Devolve o motivo ou nulo. */
function disparo(r: RestricaoCobertura, l: LancamentoCobertura): string | null {
  const base = r.mensagem?.trim() || r.descricao;
  switch (r.tipo) {
    case 'nao_coberto':
      return `${base} (não coberto pela fonte pagadora).`;
    case 'somente_aviso':
      return base;
    case 'exige_autorizacao':
      return l.autorizado ? null : `${base} (exige autorização da operadora).`;
    case 'exige_justificativa':
      return l.justificado ? null : `${base} (exige justificativa no lançamento).`;
    case 'limite_quantidade': {
      const total = (l.anteriores.atendimento ?? 0) + l.quantidade;
      return r.quantidadeLimite !== null && total > r.quantidadeLimite
        ? `${base} (quantidade ${total} acima do limite ${r.quantidadeLimite}).`
        : null;
    }
    case 'limite_valor':
      return r.valorLimite !== null && l.valorTotal !== null && l.valorTotal > r.valorLimite
        ? `${base} (valor ${l.valorTotal.toFixed(2)} acima do limite ${r.valorLimite.toFixed(2)}).`
        : null;
  }
}

/** A exceção do atendimento que libera a restrição para este item, se houver. */
export function excecaoQueLibera(
  r: RestricaoCobertura,
  l: LancamentoCobertura,
  excecoes: readonly ExcecaoCobertura[],
): ExcecaoCobertura | null {
  const total = (l.anteriores.atendimento ?? 0) + l.quantidade;
  return (
    excecoes.find(
      (x) =>
        (x.restricaoId === null || x.restricaoId === r.id) &&
        ((x.itemId !== null && x.itemId === l.itemId) ||
          (x.itemId === null && x.grupoId !== null && x.grupoId === l.grupoId)) &&
        x.tiposAtendimento.includes(l.tipoAtendimento) &&
        (x.quantidadeAutorizada === null || total <= x.quantidadeAutorizada),
    ) ?? null
  );
}

const dias = (a: string, b: string) =>
  Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) /
  86_400_000;

/** Pares que valem para o item na data: a regra da fonte prevalece sobre a geral do mesmo par e tipo. */
export function paresAplicaveis(
  pares: readonly ParCompatibilidade[],
  itemId: number,
  fonte: number,
  data: string,
): ParCompatibilidade[] {
  const vigentes = pares.filter(
    (p) =>
      p.ativo &&
      (p.fontePagadoraId === null || p.fontePagadoraId === fonte) &&
      vigenteNaData(p.vigenciaInicio, p.vigenciaFim, data) &&
      (p.itemId === itemId || (p.relacionadoId === itemId && p.tipo === 'incompativel')),
  );
  const chave = (p: ParCompatibilidade) =>
    `${Math.min(p.itemId, p.relacionadoId)}-${Math.max(p.itemId, p.relacionadoId)}-${p.tipo}`;
  const daFonte = new Set(vigentes.filter((p) => p.fontePagadoraId !== null).map(chave));
  return vigentes.filter((p) => p.fontePagadoraId !== null || !daFonte.has(chave(p)));
}

/** Compatibilidade do item novo com o que já está na conta. */
export function conferirCompatibilidade(
  l: LancamentoCobertura,
  pares: readonly ParCompatibilidade[],
): AchadoCobertura[] {
  const achados: AchadoCobertura[] = [];
  for (const p of paresAplicaveis(pares, l.itemId, l.fontePagadoraId, l.data)) {
    const outro = p.itemId === l.itemId ? p.relacionadoId : p.itemId;
    const presentes = l.naConta.filter(
      (x) => x.itemId === outro && (p.validadeDias === null || dias(x.data, l.data) <= p.validadeDias),
    );
    if (p.tipo === 'incompativel') {
      if (presentes.length)
        achados.push({
          origem: 'compatibilidade',
          id: p.id,
          efeito: 'bloqueio',
          motivo: 'O procedimento é incompatível com outro já lançado na conta.',
          excecaoId: null,
        });
      continue;
    }
    if (p.exigeItem && presentes.length === 0)
      achados.push({
        origem: 'compatibilidade',
        id: p.id,
        efeito: 'alerta',
        motivo: 'O procedimento exige o procedimento relacionado na mesma conta: lance-o também.',
        excecaoId: null,
      });
    if (p.quantidadeLimite !== null && presentes.length) {
      const total =
        l.naConta.filter((x) => x.itemId === l.itemId).reduce((s, x) => s + x.quantidade, 0) + l.quantidade;
      if (total > p.quantidadeLimite)
        achados.push({
          origem: 'compatibilidade',
          id: p.id,
          efeito: 'bloqueio',
          motivo: `Junto com o procedimento relacionado, a quantidade ${total} passa do limite ${p.quantidadeLimite}.`,
          excecaoId: null,
        });
    }
  }
  return achados;
}

/** A crítica completa do lançamento (ou da prescrição) pela restrição de cobertura e pela compatibilidade. */
export function avaliarCobertura(
  l: LancamentoCobertura,
  restricoes: readonly RestricaoCobertura[],
  excecoes: readonly ExcecaoCobertura[],
  pares: readonly ParCompatibilidade[],
): ResultadoCobertura {
  const achados: AchadoCobertura[] = [];
  for (const r of restricoes) {
    if (!restricaoAlcanca(r, l)) continue;
    const motivo = disparo(r, l);
    if (motivo === null) continue;
    const efeito: EfeitoCobertura =
      r.tipo === 'somente_aviso' || r.acao === 'alertar' ? 'alerta' : 'bloqueio';
    const ex = efeito === 'bloqueio' ? excecaoQueLibera(r, l, excecoes) : null;
    achados.push({
      origem: 'restricao',
      id: r.id,
      efeito: ex ? 'liberado' : efeito,
      motivo,
      excecaoId: ex?.id ?? null,
    });
  }
  achados.push(...conferirCompatibilidade(l, pares));
  const finais =
    l.contexto === 'prescricao'
      ? achados.map((a) => (a.efeito === 'bloqueio' ? { ...a, efeito: 'alerta' as const } : a))
      : achados;
  const situacao = finais.some((a) => a.efeito === 'bloqueio')
    ? 'bloqueio'
    : finais.some((a) => a.efeito === 'alerta')
      ? 'alerta'
      : 'livre';
  return { situacao, achados: finais };
}

// ── Validação do cadastro (na hora, na tela, e de novo na porta) ──────────────────────────────────────

export interface RestricaoEntrada {
  readonly descricao: string;
  readonly fontePagadoraId: number | null;
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly tabelaId: number | null;
  readonly tipo: string;
  readonly acao: string;
  readonly valorLimite: number | null;
  readonly quantidadeLimite: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly criterios: readonly CriterioCobertura[];
}

const dataValida = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

export function validarCriterioCobertura(c: CriterioCobertura): string | null {
  if (!(TIPOS_CRITERIO_COBERTURA as readonly string[]).includes(c.tipo)) return 'Tipo de critério inválido.';
  switch (c.tipo) {
    case 'setor':
      return c.setorId ? null : 'Escolha o setor do critério.';
    case 'faixa_idade':
      if (c.idadeMinima == null && c.idadeMaxima == null) return 'Informe a idade mínima ou a máxima.';
      if (c.idadeMinima != null && c.idadeMaxima != null && c.idadeMaxima < c.idadeMinima)
        return 'A idade máxima tem de ser maior ou igual à mínima.';
      return null;
    case 'horario':
      if (hhmm(c.horaInicio) === null || hhmm(c.horaFim) === null)
        return 'Informe o horário de início e de fim.';
      if (c.diaSemana != null && (c.diaSemana < 1 || c.diaSemana > 7)) return 'Dia da semana inválido.';
      return null;
    case 'profissional':
      return c.profissionalId ? null : 'Escolha o profissional do critério.';
    case 'prestador':
      return c.prestadorId ? null : 'Escolha o prestador do critério.';
    case 'plano':
      return c.planoId ? null : 'Escolha o plano do critério.';
    case 'empresa_carteira':
      return c.empresaId ? null : 'Escolha a empresa da carteira.';
    case 'quantidade_periodo':
      if (!(c.quantidadeMaxima != null && c.quantidadeMaxima > 0))
        return 'A quantidade máxima tem de ser positiva.';
      return c.periodo && (PERIODOS_CRITERIO as readonly string[]).includes(c.periodo)
        ? null
        : 'Escolha o período da quantidade.';
    case 'tipo_atendimento':
      return c.tipoAtendimento &&
        (TIPOS_ATENDIMENTO_COBERTURA as readonly string[]).includes(c.tipoAtendimento)
        ? null
        : 'Escolha o tipo de atendimento.';
  }
}

export function validarRestricaoCobertura(e: RestricaoEntrada): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!e.descricao.trim()) erros['descricao'] = 'Descreva a restrição.';
  if (!e.fontePagadoraId) erros['fontePagadoraId'] = 'Escolha a fonte pagadora.';
  if (e.itemId === null && e.grupoId === null && e.tabelaId === null)
    erros['itemId'] = 'Escolha o item, o grupo ou a tabela restrita.';
  if (!(TIPOS_RESTRICAO_COBERTURA as readonly string[]).includes(e.tipo)) erros['tipo'] = 'Tipo inválido.';
  if (e.acao !== 'bloquear' && e.acao !== 'alertar') erros['acao'] = 'Use bloquear ou alertar.';
  if (e.tipo === 'limite_valor' && !(e.valorLimite !== null && e.valorLimite > 0))
    erros['valorLimite'] = 'Informe o valor limite (positivo).';
  if (e.tipo === 'limite_quantidade' && !(e.quantidadeLimite !== null && e.quantidadeLimite > 0))
    erros['quantidadeLimite'] = 'Informe a quantidade limite (positiva).';
  if (!dataValida(e.vigenciaInicio)) erros['vigenciaInicio'] = 'Informe o início da vigência.';
  if (e.vigenciaFim !== null && (!dataValida(e.vigenciaFim) || e.vigenciaFim < e.vigenciaInicio))
    erros['vigenciaFim'] = 'O fim da vigência tem de ser depois do início.';
  e.criterios.forEach((c, i) => {
    const m = validarCriterioCobertura(c);
    if (m) erros[`criterios.${i}`] = m;
  });
  return erros;
}

export interface ParEntrada {
  readonly itemId: number | null;
  readonly relacionadoId: number | null;
  readonly tipo: string;
  readonly quantidadeLimite: number | null;
  readonly validadeDias: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export function validarParCompatibilidade(e: ParEntrada): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!e.itemId) erros['itemId'] = 'Escolha o procedimento.';
  if (!e.relacionadoId) erros['relacionadoId'] = 'Escolha o procedimento relacionado.';
  else if (e.itemId === e.relacionadoId)
    erros['relacionadoId'] = 'O relacionado tem de ser outro procedimento.';
  if (!(TIPOS_RELACAO_PROCEDIMENTO as readonly string[]).includes(e.tipo))
    erros['tipo'] = 'Tipo de relação inválido.';
  if (e.quantidadeLimite !== null && !(e.quantidadeLimite > 0))
    erros['quantidadeLimite'] = 'A quantidade limite tem de ser positiva.';
  if (e.validadeDias !== null && !(Number.isInteger(e.validadeDias) && e.validadeDias >= 0))
    erros['validadeDias'] = 'A janela em dias tem de ser um inteiro não negativo.';
  if (!dataValida(e.vigenciaInicio)) erros['vigenciaInicio'] = 'Informe o início da vigência.';
  if (e.vigenciaFim !== null && (!dataValida(e.vigenciaFim) || e.vigenciaFim < e.vigenciaInicio))
    erros['vigenciaFim'] = 'O fim da vigência tem de ser depois do início.';
  return erros;
}

export interface ExcecaoEntrada {
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly justificativaId: number | null;
  readonly observacao: string | null;
  readonly quantidadeAutorizada: number | null;
  readonly tiposAtendimento: readonly string[];
}

export function validarExcecaoCobertura(e: ExcecaoEntrada): Record<string, string> {
  const erros: Record<string, string> = {};
  if (e.itemId === null && e.grupoId === null) erros['itemId'] = 'Escolha o item ou o grupo liberado.';
  if (!e.justificativaId) erros['justificativaId'] = 'Escolha a justificativa da liberação.';
  if (e.quantidadeAutorizada !== null && !(e.quantidadeAutorizada > 0))
    erros['quantidadeAutorizada'] = 'A quantidade autorizada tem de ser positiva.';
  if (e.tiposAtendimento.length === 0)
    erros['tiposAtendimento'] = 'Marque ao menos um tipo de atendimento em que a liberação vale.';
  return erros;
}
