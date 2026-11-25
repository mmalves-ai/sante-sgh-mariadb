// Internação domiciliar (atenção domiciliar): orçamento, transferência para casa, chamados e visitas (C2-079, 04-INT
// linha 84). Regras puras, sem banco. Referências públicas: RDC ANVISA 11/2006 (serviço de atenção domiciliar: plano de
// atenção, equipe responsável, endereço de atendimento) e Portaria GM/MS 825/2016 (atenção domiciliar no SUS).
//   - orçamento: cada item vale quantidade × dias × valor unitário (com o acréscimo percentual); o total soma os itens e
//     os impostos pelo percentual; ciclo rascunho → enviado → aprovado ou recusado; cancelado antes da resposta; o
//     vencido não se aprova; itens e cabeçalho só mudam no rascunho; o de operadora tem fonte pagadora;
//   - transferência para casa: nasce 'solicitada' com o endereço de atendimento do próprio paciente, um orçamento
//     aprovado do paciente (ou a liminar judicial com número e data), a internação hospitalar de origem do mesmo
//     paciente e uma só internação domiciliar aberta por paciente;
//   - ciclo da internação: solicitada → em avaliação → ativa (com o médico responsável; início nunca no futuro) ⇄
//     suspensa (com o motivo) → encerrada (fim depois do início, sem chamado aberto nem visita em andamento);
//     cancelada (com o motivo) só antes de ativar;
//   - chamado: tipo ativo, motivo do mesmo tipo, endereço (do chamado ou o da internação domiciliar aberta); ciclo
//     aberto → triado (prioridade) → atribuído (profissional e visita agendada) → em atendimento (visita iniciada) →
//     concluído (desfecho; 'atendido no domicílio' só com a visita realizada; coparticipação só no tipo que a tem);
//     anulado com motivo antes de concluir; a fila vem pela prioridade e depois pela hora do chamado;
//   - visita: na internação ativa, nunca antes do início dela, sem sobrepor outra visita do mesmo profissional; ciclo
//     agendada/confirmada → em andamento → realizada (fim depois do início, nunca no futuro), ou cancelada / não
//     realizada com o motivo.

export interface ProblemaDomiciliar {
  readonly campo: string;
  readonly mensagem: string;
}

const MOTIVO_MINIMO = 10;
const dia = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const r2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const motivoCurto = (m: string | null | undefined) => (m ?? '').trim().length < MOTIVO_MINIMO;

// ---------------------------------------------------------------- orçamento
export const TIPOS_ORCAMENTO_DOMICILIAR = ['operadora', 'particular'] as const;
export const MODALIDADES_ATENCAO_DOMICILIAR = ['internacao', 'assistencia', 'procedimento_pontual'] as const;
export const SITUACOES_ORCAMENTO_DOMICILIAR = [
  'rascunho',
  'enviado',
  'aprovado',
  'recusado',
  'vencido',
  'cancelado',
] as const;
export type SituacaoOrcamentoDomiciliar = (typeof SITUACOES_ORCAMENTO_DOMICILIAR)[number];
export const TIPOS_ITEM_ORCAMENTO_DOMICILIAR = [
  'visita',
  'equipamento',
  'material',
  'medicamento',
  'dieta',
  'taxa',
  'servico',
  'custo_operacional',
] as const;
export type AcaoOrcamentoDomiciliar = 'editar' | 'enviar' | 'aprovar' | 'recusar' | 'cancelar';

export interface ItemOrcamentoDomiciliar {
  readonly quantidade: number;
  readonly dias: number | null;
  readonly valorUnitario: number;
  readonly valorCustoUnitario: number | null;
  readonly percentualAcrescimo: number | null;
}

/** Valor de um item: unitário com o acréscimo, vezes a quantidade e os dias (sem dias, 1). */
export function valorItemOrcamento(i: ItemOrcamentoDomiciliar): { valorTotal: number; valorCusto: number } {
  const vezes = i.quantidade * (i.dias ?? 1);
  const unitario = i.valorUnitario * (1 + (i.percentualAcrescimo ?? 0) / 100);
  return { valorTotal: r2(unitario * vezes), valorCusto: r2((i.valorCustoUnitario ?? 0) * vezes) };
}

/** Totais do orçamento: soma dos itens, custo, impostos pelo percentual e o total com os impostos. */
export function totaisOrcamentoDomiciliar(
  itens: readonly ItemOrcamentoDomiciliar[],
  percentualImpostos: number,
): { subtotal: number; valorCustoTotal: number; valorImpostos: number; valorTotal: number } {
  const v = itens.map(valorItemOrcamento);
  const subtotal = r2(v.reduce((s, x) => s + x.valorTotal, 0));
  const valorCustoTotal = r2(v.reduce((s, x) => s + x.valorCusto, 0));
  const valorImpostos = r2((subtotal * percentualImpostos) / 100);
  return { subtotal, valorCustoTotal, valorImpostos, valorTotal: r2(subtotal + valorImpostos) };
}

export interface OrcamentoDomiciliarProposto {
  readonly tipo: string;
  readonly fontePagadora: number | null;
  readonly periodoInicio: string | null;
  readonly periodoFim: string | null;
  readonly validade: string | null;
  readonly percentualImpostos: number;
  readonly itens: readonly (ItemOrcamentoDomiciliar & {
    readonly tipoItem: string;
    readonly itemFaturavel: number | null;
    readonly tipoCusto: number | null;
    readonly descricao: string;
  })[];
  readonly hoje: Date | string;
}

/** Confere o orçamento (cabeçalho e itens) antes de gravar o rascunho. */
export function conferirOrcamentoDomiciliar(o: OrcamentoDomiciliarProposto): ProblemaDomiciliar[] {
  const p: ProblemaDomiciliar[] = [];
  if (!(TIPOS_ORCAMENTO_DOMICILIAR as readonly string[]).includes(o.tipo))
    p.push({ campo: 'tipo', mensagem: 'Tipo de orçamento desconhecido.' });
  if (o.tipo === 'operadora' && o.fontePagadora === null)
    p.push({ campo: 'fontePagadora', mensagem: 'O orçamento para a operadora precisa da fonte pagadora.' });
  if (o.periodoInicio && o.periodoFim && o.periodoFim < o.periodoInicio)
    p.push({ campo: 'periodoFim', mensagem: 'O fim do período é anterior ao início.' });
  if (o.validade && o.validade < dia(o.hoje))
    p.push({ campo: 'validade', mensagem: 'A validade do orçamento já passou.' });
  if (!(o.percentualImpostos >= 0 && o.percentualImpostos <= 100))
    p.push({ campo: 'percentualImpostos', mensagem: 'O percentual de impostos vai de 0 a 100.' });
  o.itens.forEach((i, n) => {
    const c = `itens.${n}`;
    if (!(TIPOS_ITEM_ORCAMENTO_DOMICILIAR as readonly string[]).includes(i.tipoItem))
      p.push({ campo: `${c}.tipoItem`, mensagem: `Item ${n + 1}: tipo desconhecido.` });
    if (i.itemFaturavel === null && i.tipoCusto === null)
      p.push({
        campo: `${c}.itemFaturavel`,
        mensagem: `Item ${n + 1}: informe o item faturável ou o tipo de custo.`,
      });
    if (!i.descricao.trim())
      p.push({ campo: `${c}.descricao`, mensagem: `Item ${n + 1}: informe a descrição.` });
    if (!(i.quantidade > 0))
      p.push({ campo: `${c}.quantidade`, mensagem: `Item ${n + 1}: quantidade maior que zero.` });
    if (i.dias !== null && !(i.dias > 0))
      p.push({
        campo: `${c}.dias`,
        mensagem: `Item ${n + 1}: os dias, quando informados, são maiores que zero.`,
      });
    if (i.valorUnitario < 0 || (i.valorCustoUnitario ?? 0) < 0)
      p.push({ campo: `${c}.valorUnitario`, mensagem: `Item ${n + 1}: valores não podem ser negativos.` });
  });
  return p;
}

/** Situação nova do orçamento pela ação, ou os problemas. */
export function conferirAcaoOrcamento(e: {
  readonly acao: AcaoOrcamentoDomiciliar;
  readonly situacao: string;
  readonly itens: number;
  readonly validade: string | null;
  readonly hoje: Date | string;
}): { situacao: SituacaoOrcamentoDomiciliar | null; problemas: ProblemaDomiciliar[] } {
  const exige = (de: string[], para: SituacaoOrcamentoDomiciliar, extra: ProblemaDomiciliar[] = []) =>
    !de.includes(e.situacao)
      ? {
          situacao: null,
          problemas: [{ campo: 'situacao', mensagem: `O orçamento ${e.situacao} não aceita esta ação.` }],
        }
      : extra.length
        ? { situacao: null, problemas: extra }
        : { situacao: para, problemas: [] };
  const vencido =
    e.validade && e.validade < dia(e.hoje)
      ? [{ campo: 'validade', mensagem: `O orçamento venceu em ${e.validade}.` }]
      : [];
  switch (e.acao) {
    case 'editar':
      return exige(['rascunho'], 'rascunho');
    case 'enviar':
      return exige(['rascunho'], 'enviado', [
        ...(e.itens < 1 ? [{ campo: 'itens', mensagem: 'O orçamento precisa de pelo menos um item.' }] : []),
        ...vencido,
      ]);
    case 'aprovar':
      return exige(['enviado'], 'aprovado', vencido);
    case 'recusar':
      return exige(['enviado'], 'recusado');
    case 'cancelar':
      return exige(['rascunho', 'enviado'], 'cancelado');
  }
}

// ---------------------------------------------------------------- internação domiciliar
export const SITUACOES_INTERNACAO_DOMICILIAR = [
  'solicitada',
  'em_avaliacao',
  'ativa',
  'suspensa',
  'encerrada',
  'cancelada',
] as const;
export type SituacaoInternacaoDomiciliar = (typeof SITUACOES_INTERNACAO_DOMICILIAR)[number];
export const SITUACOES_ABERTAS_INTERNACAO_DOMICILIAR = [
  'solicitada',
  'em_avaliacao',
  'ativa',
  'suspensa',
] as const;
export type AcaoInternacaoDomiciliar =
  'avaliar' | 'iniciar' | 'suspender' | 'retomar' | 'encerrar' | 'cancelar';

export interface TransferenciaDomicilio {
  readonly paciente: number;
  readonly enderecoDoPaciente: boolean;
  readonly origem: { readonly paciente: number; readonly aberta: boolean } | null;
  readonly orcamento: { readonly paciente: number; readonly situacao: string } | null;
  readonly liminar: { readonly numero: string | null; readonly data: string | null } | null;
  readonly dataPrevista: string | null;
  readonly outraAberta: boolean;
  readonly hoje: Date | string;
}

/** Confere a transferência do paciente para a atenção domiciliar. */
export function conferirTransferenciaDomicilio(t: TransferenciaDomicilio): ProblemaDomiciliar[] {
  const p: ProblemaDomiciliar[] = [];
  const hoje = dia(t.hoje);
  if (!t.enderecoDoPaciente)
    p.push({ campo: 'endereco', mensagem: 'O endereço de atendimento tem de ser um endereço do paciente.' });
  if (t.outraAberta)
    p.push({ campo: 'paciente', mensagem: 'O paciente já tem uma internação domiciliar em aberto.' });
  if (t.origem && t.origem.paciente !== t.paciente)
    p.push({ campo: 'origemInternacao', mensagem: 'A internação de origem é de outro paciente.' });
  if (t.liminar) {
    if (!t.liminar.numero?.trim() || !t.liminar.data)
      p.push({ campo: 'liminar', mensagem: 'A liminar judicial precisa do número e da data.' });
    else if (t.liminar.data > hoje)
      p.push({ campo: 'liminar', mensagem: 'A data da liminar está no futuro.' });
  }
  if (t.orcamento) {
    if (t.orcamento.paciente !== t.paciente)
      p.push({ campo: 'orcamento', mensagem: 'O orçamento é de outro paciente.' });
    else if (t.orcamento.situacao !== 'aprovado')
      p.push({ campo: 'orcamento', mensagem: 'Só o orçamento aprovado autoriza a transferência.' });
  } else if (!t.liminar)
    p.push({
      campo: 'orcamento',
      mensagem: 'A transferência precisa do orçamento aprovado ou da liminar judicial.',
    });
  if (t.dataPrevista && t.dataPrevista < hoje)
    p.push({ campo: 'dataPrevista', mensagem: 'A data prevista para o início já passou.' });
  return p;
}

/** Situação nova da internação domiciliar pela ação, ou os problemas. */
export function conferirAcaoInternacaoDomiciliar(e: {
  readonly acao: AcaoInternacaoDomiciliar;
  readonly situacao: string;
  readonly medicoResponsavel: boolean;
  readonly inicio: Date | null;
  readonly quando: Date;
  readonly agora: Date;
  readonly motivo: string | null;
  readonly chamadosAbertos: number;
  readonly visitasEmAndamento: number;
}): { situacao: SituacaoInternacaoDomiciliar | null; problemas: ProblemaDomiciliar[] } {
  const p: ProblemaDomiciliar[] = [];
  const de: Record<AcaoInternacaoDomiciliar, [string[], SituacaoInternacaoDomiciliar]> = {
    avaliar: [['solicitada'], 'em_avaliacao'],
    iniciar: [['solicitada', 'em_avaliacao'], 'ativa'],
    suspender: [['ativa'], 'suspensa'],
    retomar: [['suspensa'], 'ativa'],
    encerrar: [['ativa', 'suspensa'], 'encerrada'],
    cancelar: [['solicitada', 'em_avaliacao'], 'cancelada'],
  };
  const [origens, nova] = de[e.acao];
  if (!origens.includes(e.situacao))
    return {
      situacao: null,
      problemas: [
        { campo: 'situacao', mensagem: `A internação domiciliar ${e.situacao} não aceita esta ação.` },
      ],
    };
  if (e.quando.getTime() > e.agora.getTime())
    p.push({ campo: 'quando', mensagem: 'A data e hora não podem estar no futuro.' });
  if (e.acao === 'iniciar' && !e.medicoResponsavel)
    p.push({ campo: 'medico', mensagem: 'Para iniciar, informe o médico responsável.' });
  if ((e.acao === 'suspender' || e.acao === 'cancelar') && motivoCurto(e.motivo))
    p.push({ campo: 'motivo', mensagem: `Informe o motivo (${MOTIVO_MINIMO} caracteres ou mais).` });
  if (e.acao === 'encerrar') {
    if (e.inicio && e.quando.getTime() < e.inicio.getTime())
      p.push({ campo: 'quando', mensagem: 'O fim é anterior ao início da internação domiciliar.' });
    if (e.chamadosAbertos > 0)
      p.push({ campo: 'chamados', mensagem: 'Conclua ou anule os chamados em aberto antes de encerrar.' });
    if (e.visitasEmAndamento > 0)
      p.push({
        campo: 'visitas',
        mensagem: 'Há visita em andamento: registre o fim dela antes de encerrar.',
      });
  }
  return p.length ? { situacao: null, problemas: p } : { situacao: nova, problemas: [] };
}

// ---------------------------------------------------------------- chamados
export const PRIORIDADES_CHAMADO_DOMICILIAR = [
  'emergencia',
  'urgente',
  'pouco_urgente',
  'nao_urgente',
] as const;
export const DESFECHOS_CHAMADO_DOMICILIAR = [
  'atendido_domicilio',
  'orientado_telefone',
  'removido_hospital',
  'obito',
  'nao_localizado',
  'cancelado',
] as const;
export const SITUACOES_CHAMADO_DOMICILIAR = [
  'aberto',
  'triado',
  'atribuido',
  'em_atendimento',
  'concluido',
  'anulado',
] as const;
export type SituacaoChamadoDomiciliar = (typeof SITUACOES_CHAMADO_DOMICILIAR)[number];
export const SITUACOES_ABERTAS_CHAMADO_DOMICILIAR = [
  'aberto',
  'triado',
  'atribuido',
  'em_atendimento',
] as const;
export type AcaoChamadoDomiciliar = 'triar' | 'atribuir' | 'iniciar' | 'concluir' | 'anular';

/** Confere a abertura do chamado domiciliar. */
export function conferirChamadoDomiciliar(c: {
  readonly tipoAtivo: boolean;
  readonly motivoDeOutroTipo: boolean;
  readonly internacaoSituacao: string | null;
  readonly temEndereco: boolean;
  readonly prioridade: string | null;
  readonly chamadoEm: Date;
  readonly agora: Date;
}): ProblemaDomiciliar[] {
  const p: ProblemaDomiciliar[] = [];
  if (!c.tipoAtivo) p.push({ campo: 'tipo', mensagem: 'Escolha um tipo de chamado ativo.' });
  if (c.motivoDeOutroTipo) p.push({ campo: 'motivo', mensagem: 'O motivo é de outro tipo de chamado.' });
  if (c.internacaoSituacao !== null && !['ativa', 'suspensa'].includes(c.internacaoSituacao))
    p.push({ campo: 'internacao', mensagem: 'A internação domiciliar do chamado não está ativa.' });
  if (!c.temEndereco)
    p.push({
      campo: 'logradouro',
      mensagem: 'Informe o endereço (o paciente não tem internação domiciliar ativa).',
    });
  if (c.prioridade !== null && !(PRIORIDADES_CHAMADO_DOMICILIAR as readonly string[]).includes(c.prioridade))
    p.push({ campo: 'prioridade', mensagem: 'Prioridade desconhecida.' });
  if (c.chamadoEm.getTime() > c.agora.getTime())
    p.push({ campo: 'chamadoEm', mensagem: 'A hora do chamado não pode estar no futuro.' });
  return p;
}

/** Situação nova do chamado pela ação, ou os problemas. */
export function conferirAcaoChamadoDomiciliar(e: {
  readonly acao: AcaoChamadoDomiciliar;
  readonly situacao: string;
  readonly prioridade?: string | null;
  readonly profissional?: number | null;
  readonly desfecho?: string | null;
  readonly visitaRealizada?: boolean;
  readonly tipoComCoparticipacao?: boolean;
  readonly coparticipacao?: number | null;
  readonly motivo?: string | null;
}): { situacao: SituacaoChamadoDomiciliar | null; problemas: ProblemaDomiciliar[] } {
  const de: Record<AcaoChamadoDomiciliar, [string[], SituacaoChamadoDomiciliar]> = {
    triar: [['aberto', 'triado'], 'triado'],
    atribuir: [['aberto', 'triado'], 'atribuido'],
    iniciar: [['atribuido'], 'em_atendimento'],
    concluir: [['aberto', 'triado', 'atribuido', 'em_atendimento'], 'concluido'],
    anular: [['aberto', 'triado', 'atribuido'], 'anulado'],
  };
  const [origens, nova] = de[e.acao];
  if (!origens.includes(e.situacao))
    return {
      situacao: null,
      problemas: [{ campo: 'situacao', mensagem: `O chamado ${e.situacao} não aceita esta ação.` }],
    };
  const p: ProblemaDomiciliar[] = [];
  if (
    e.acao === 'triar' &&
    !(PRIORIDADES_CHAMADO_DOMICILIAR as readonly string[]).includes(e.prioridade ?? '')
  )
    p.push({ campo: 'prioridade', mensagem: 'Escolha a prioridade.' });
  if (e.acao === 'atribuir' && !e.profissional)
    p.push({ campo: 'profissional', mensagem: 'Escolha o profissional da visita.' });
  if (e.acao === 'concluir') {
    if (!(DESFECHOS_CHAMADO_DOMICILIAR as readonly string[]).includes(e.desfecho ?? ''))
      p.push({ campo: 'desfecho', mensagem: 'Escolha o desfecho do chamado.' });
    else if (e.desfecho === 'atendido_domicilio' && !e.visitaRealizada)
      p.push({ campo: 'desfecho', mensagem: 'Atendido no domicílio exige a visita do chamado realizada.' });
    if (e.coparticipacao !== null && e.coparticipacao !== undefined) {
      if (!e.tipoComCoparticipacao)
        p.push({ campo: 'coparticipacao', mensagem: 'Este tipo de chamado não tem coparticipação.' });
      else if (e.coparticipacao < 0)
        p.push({ campo: 'coparticipacao', mensagem: 'A coparticipação não pode ser negativa.' });
    }
  }
  if (e.acao === 'anular' && motivoCurto(e.motivo))
    p.push({
      campo: 'motivo',
      mensagem: `Informe o motivo da anulação (${MOTIVO_MINIMO} caracteres ou mais).`,
    });
  return p.length ? { situacao: null, problemas: p } : { situacao: nova, problemas: [] };
}

const PESO_PRIORIDADE: Record<string, number> = {
  emergencia: 0,
  urgente: 1,
  pouco_urgente: 2,
  nao_urgente: 3,
};

/** Fila dos chamados: prioridade (sem prioridade por último) e depois a hora do chamado. */
export function ordenarFilaChamadosDomiciliares<T extends { prioridade: string | null; chamadoEm: string }>(
  itens: readonly T[],
): T[] {
  return [...itens].sort(
    (a, b) =>
      (PESO_PRIORIDADE[a.prioridade ?? ''] ?? 9) - (PESO_PRIORIDADE[b.prioridade ?? ''] ?? 9) ||
      a.chamadoEm.localeCompare(b.chamadoEm),
  );
}

// ---------------------------------------------------------------- visitas
export const SITUACOES_VISITA_DOMICILIAR = [
  'agendada',
  'confirmada',
  'em_andamento',
  'realizada',
  'cancelada',
  'nao_realizada',
] as const;
export type SituacaoVisitaDomiciliar = (typeof SITUACOES_VISITA_DOMICILIAR)[number];
export type AcaoVisitaDomiciliar = 'confirmar' | 'iniciar' | 'realizar' | 'cancelar' | 'nao_realizar';
const DURACAO_PADRAO_MIN = 60;

/** Confere o agendamento da visita: internação ativa, depois do início e sem sobrepor o profissional. */
export function conferirVisitaDomiciliar(v: {
  readonly internacaoSituacao: string | null;
  readonly inicioInternacao: Date | null;
  readonly quando: Date;
  readonly duracaoMinutos: number | null;
  readonly outrasDoProfissional: readonly { readonly quando: Date; readonly duracaoMinutos: number | null }[];
}): ProblemaDomiciliar[] {
  const p: ProblemaDomiciliar[] = [];
  if (v.internacaoSituacao !== null && v.internacaoSituacao !== 'ativa')
    p.push({ campo: 'internacao', mensagem: 'Só se agenda visita na internação domiciliar ativa.' });
  if (v.inicioInternacao && v.quando.getTime() < v.inicioInternacao.getTime())
    p.push({ campo: 'quando', mensagem: 'A visita é anterior ao início da internação domiciliar.' });
  if (v.duracaoMinutos !== null && !(v.duracaoMinutos > 0 && v.duracaoMinutos <= 720))
    p.push({ campo: 'duracao', mensagem: 'A duração vai de 1 a 720 minutos.' });
  const fim = (q: Date, d: number | null) => q.getTime() + (d ?? DURACAO_PADRAO_MIN) * 60_000;
  const ini = v.quando.getTime();
  const fimNova = fim(v.quando, v.duracaoMinutos);
  if (
    v.outrasDoProfissional.some((o) => o.quando.getTime() < fimNova && ini < fim(o.quando, o.duracaoMinutos))
  )
    p.push({ campo: 'quando', mensagem: 'O profissional já tem visita neste horário.' });
  return p;
}

/** Situação nova da visita pela ação, ou os problemas. */
export function conferirAcaoVisitaDomiciliar(e: {
  readonly acao: AcaoVisitaDomiciliar;
  readonly situacao: string;
  readonly inicio: Date | null;
  readonly fim: Date | null;
  readonly agora: Date;
  readonly motivo: string | null;
}): { situacao: SituacaoVisitaDomiciliar | null; problemas: ProblemaDomiciliar[] } {
  const de: Record<AcaoVisitaDomiciliar, [string[], SituacaoVisitaDomiciliar]> = {
    confirmar: [['agendada'], 'confirmada'],
    iniciar: [['agendada', 'confirmada'], 'em_andamento'],
    realizar: [['agendada', 'confirmada', 'em_andamento'], 'realizada'],
    cancelar: [['agendada', 'confirmada'], 'cancelada'],
    nao_realizar: [['agendada', 'confirmada', 'em_andamento'], 'nao_realizada'],
  };
  const [origens, nova] = de[e.acao];
  if (!origens.includes(e.situacao))
    return {
      situacao: null,
      problemas: [{ campo: 'situacao', mensagem: `A visita ${e.situacao} não aceita esta ação.` }],
    };
  const p: ProblemaDomiciliar[] = [];
  if (e.acao === 'iniciar' && e.inicio && e.inicio.getTime() > e.agora.getTime())
    p.push({ campo: 'inicio', mensagem: 'O início não pode estar no futuro.' });
  if (e.acao === 'realizar') {
    if (!e.inicio || !e.fim) p.push({ campo: 'fim', mensagem: 'Informe o início e o fim da visita.' });
    else {
      if (e.fim.getTime() < e.inicio.getTime())
        p.push({ campo: 'fim', mensagem: 'O fim da visita é anterior ao início.' });
      if (e.fim.getTime() > e.agora.getTime())
        p.push({ campo: 'fim', mensagem: 'O fim da visita não pode estar no futuro.' });
    }
  }
  if ((e.acao === 'cancelar' || e.acao === 'nao_realizar') && motivoCurto(e.motivo))
    p.push({ campo: 'motivo', mensagem: `Informe o motivo (${MOTIVO_MINIMO} caracteres ou mais).` });
  return p.length ? { situacao: null, problemas: p } : { situacao: nova, problemas: [] };
}
