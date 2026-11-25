// Entrega de resultados (F3.5, 05-SADT linha 21): o prazo de entrega por setor e exame, o protocolo de entrega no
// balcão e a publicação no portal conforme o perfil (setores visíveis, dias de visibilidade) e o exame restrito
// (nunca publica, só depois da entrega presencial ou só depois da carência). Regras puras: a porta lê o cadastro e
// grava o que a regra decide. Datas civis do estabelecimento em texto ("AAAA-MM-DDTHH:MM"), sem fuso.

export class RecusaEntrega extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'RecusaEntrega';
  }
}
const recusar = (codigo: string, mensagem: string): never => {
  throw new RecusaEntrega(codigo, mensagem);
};

// ── Prazo de entrega ───────────────────────────────────────────────────────────────────────────────────────────

export const PRIORIDADES_PRAZO = ['rotina', 'urgencia', 'emergencia'] as const;
export type PrioridadePrazo = (typeof PRIORIDADES_PRAZO)[number];
export const ATENDIMENTOS_PRAZO = [
  'ambulatorial',
  'externo',
  'urgencia',
  'internacao',
  'hospital_dia',
  'domiciliar',
] as const;
export type AtendimentoPrazo = (typeof ATENDIMENTOS_PRAZO)[number];

export interface PrazoEntrega {
  readonly id: number;
  readonly exame: number;
  /** Setor executante; nulo vale para todos. */
  readonly setor: number | null;
  /** Setor solicitante; nulo vale para todos. */
  readonly setorSolicitante: number | null;
  readonly material: number | null;
  readonly prioridade: PrioridadePrazo;
  readonly tipoAtendimento: AtendimentoPrazo | null;
  readonly prazoDias: number;
  readonly prazoMinutos: number | null;
  /** "HH:MM": o pedido depois desta hora conta a partir do dia seguinte. */
  readonly horarioCorte: string | null;
  /** Domingo a sábado: os dias em que o exame é realizado. */
  readonly diasDaSemana: readonly boolean[];
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** O cadastro do prazo é coerente? (a mesma conferência na tela e na gravação). */
export function conferirPrazo(p: Omit<PrazoEntrega, 'id'>): void {
  if (!Number.isInteger(p.prazoDias) || p.prazoDias < 0 || p.prazoDias > 365)
    recusar('prazo-dias-invalido', 'O prazo em dias vai de 0 a 365.');
  if (p.prazoMinutos !== null && (!Number.isInteger(p.prazoMinutos) || p.prazoMinutos < 0))
    recusar('prazo-minutos-invalido', 'O prazo em minutos não pode ser negativo.');
  if (p.prazoDias === 0 && (p.prazoMinutos ?? 0) === 0)
    recusar('prazo-sem-tempo', 'Informe o prazo em dias ou em minutos.');
  if (p.horarioCorte !== null && !HORA.test(p.horarioCorte))
    recusar('horario-corte-invalido', 'O horário de corte é uma hora do dia (HH:MM).');
  if (p.diasDaSemana.length !== 7 || !p.diasDaSemana.some(Boolean))
    recusar('prazo-sem-dia', 'Marque ao menos um dia da semana em que o exame é realizado.');
}

export interface PedidoParaPrazo {
  readonly exame: number;
  readonly setor: number | null;
  readonly setorSolicitante: number | null;
  readonly material: number | null;
  readonly prioridade: PrioridadePrazo;
  readonly tipoAtendimento: AtendimentoPrazo | null;
}

/**
 * O prazo que vale para o pedido: o mais específico entre os que casam (cada critério preenchido do prazo tem de ser
 * igual ao do pedido). A prioridade do pedido sem prazo próprio cai no prazo de rotina. Empate: o cadastro mais novo.
 */
export function escolherPrazo(prazos: readonly PrazoEntrega[], p: PedidoParaPrazo): PrazoEntrega | null {
  const casa = (r: PrazoEntrega, prioridade: PrioridadePrazo) =>
    r.exame === p.exame &&
    r.prioridade === prioridade &&
    (r.setor === null || r.setor === p.setor) &&
    (r.setorSolicitante === null || r.setorSolicitante === p.setorSolicitante) &&
    (r.material === null || r.material === p.material) &&
    (r.tipoAtendimento === null || r.tipoAtendimento === p.tipoAtendimento);
  const peso = (r: PrazoEntrega) =>
    [r.setor, r.setorSolicitante, r.material, r.tipoAtendimento].filter((x) => x !== null).length;
  for (const prioridade of p.prioridade === 'rotina'
    ? (['rotina'] as const)
    : [p.prioridade, 'rotina' as const]) {
    const candidatos = prazos.filter((r) => casa(r, prioridade));
    if (candidatos.length > 0)
      return [...candidatos].sort((a, b) => peso(b) - peso(a) || b.id - a.id)[0] ?? null;
  }
  return null;
}

const ms = (civil: string) => Date.parse(`${civil.slice(0, 16)}:00Z`);
const civil = (t: number) => new Date(t).toISOString().slice(0, 16);
const DIA = 86_400_000;

/**
 * A previsão de entrega (data civil do estabelecimento): o pedido depois do horário de corte, ou num dia em que o
 * exame não é realizado, começa a contar à zero hora do próximo dia de realização; os dias do prazo são dias de
 * realização; os minutos somam ao fim, e a previsão nunca cai num dia sem realização.
 */
export function preverEntrega(
  prazo: Pick<PrazoEntrega, 'prazoDias' | 'prazoMinutos' | 'horarioCorte' | 'diasDaSemana'>,
  pedidoEm: string,
): string {
  const realiza = (t: number) => prazo.diasDaSemana[new Date(t).getUTCDay()] === true;
  if (!prazo.diasDaSemana.some(Boolean)) recusar('prazo-sem-dia', 'O prazo não tem dia de realização.');
  const zeroHora = (t: number) => t - (t % DIA);
  const proximoDia = (t: number) => {
    let d = zeroHora(t) + DIA;
    while (!realiza(d)) d += DIA;
    return d;
  };
  let t = ms(pedidoEm);
  if (prazo.horarioCorte !== null && pedidoEm.slice(11, 16) > prazo.horarioCorte) t = proximoDia(t);
  else if (!realiza(t)) t = proximoDia(t);
  for (let i = 0; i < prazo.prazoDias; i += 1) {
    const hora = t % DIA;
    t = proximoDia(t) + hora;
  }
  t += (prazo.prazoMinutos ?? 0) * 60_000;
  if (!realiza(t)) t = proximoDia(t);
  return civil(t);
}

export type SituacaoPrazo = 'sem_prazo' | 'no_prazo' | 'atrasado' | 'liberado_no_prazo' | 'liberado_atrasado';

/** A situação do exame diante da previsão (datas civis; `liberadoEm` nulo: ainda não liberado). */
export function situacaoDoPrazo(
  previsto: string | null,
  agora: string,
  liberadoEm: string | null,
): SituacaoPrazo {
  if (previsto === null) return 'sem_prazo';
  if (liberadoEm !== null) return ms(liberadoEm) <= ms(previsto) ? 'liberado_no_prazo' : 'liberado_atrasado';
  return ms(agora) <= ms(previsto) ? 'no_prazo' : 'atrasado';
}

// ── Protocolo de entrega no balcão ─────────────────────────────────────────────────────────────────────────────

/** CPF com os dois dígitos verificadores corretos (11 dígitos, sem máscara). */
export function cpfConfere(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(cpf[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

export interface ItemParaEntrega {
  readonly item: number;
  /** O resultado do exame está liberado (só o liberado sai do hospital). */
  readonly liberado: boolean;
  /** Já consta num protocolo de entrega vigente (não cancelado). */
  readonly jaEntregue: boolean;
}

export interface EntregaNoBalcao {
  readonly retiradoPeloPaciente: boolean;
  readonly nomeResponsavel: string | null;
  readonly cpfResponsavel: string | null;
  readonly documentoResponsavel: string | null;
  readonly itens: readonly ItemParaEntrega[];
}

/**
 * A entrega pode ser registrada? Ao menos um exame, sem repetição, todos liberados e ainda não entregues; quando quem
 * retira não é o paciente, o nome e um documento (CPF válido ou outro documento) ficam no protocolo.
 */
export function conferirEntrega(e: EntregaNoBalcao): void {
  if (e.itens.length === 0) recusar('entrega-vazia', 'Escolha ao menos um exame para entregar.');
  if (new Set(e.itens.map((i) => i.item)).size !== e.itens.length)
    recusar('entrega-item-repetido', 'O mesmo exame aparece duas vezes na entrega.');
  if (e.itens.some((i) => !i.liberado))
    recusar('entrega-nao-liberado', 'Só o exame com resultado liberado pode ser entregue.');
  if (e.itens.some((i) => i.jaEntregue))
    recusar('entrega-ja-feita', 'Há exame que já foi entregue em outro protocolo.');
  if (e.retiradoPeloPaciente) return;
  if ((e.nomeResponsavel ?? '').trim().length < 3)
    recusar('entrega-sem-responsavel', 'Informe o nome de quem retirou o resultado.');
  const cpf = e.cpfResponsavel ?? '';
  const documento = (e.documentoResponsavel ?? '').trim();
  if (cpf === '' && documento === '')
    recusar('entrega-sem-documento', 'Informe o CPF ou outro documento de quem retirou.');
  if (cpf !== '' && !cpfConfere(cpf)) recusar('entrega-cpf-invalido', 'O CPF de quem retirou não confere.');
}

/** O protocolo pode ser cancelado? Só o vigente, e com o motivo (o protocolo nunca é apagado). */
export function conferirCancelamentoEntrega(situacao: string, motivo: string): void {
  if (situacao !== 'entregue') recusar('entrega-ja-cancelada', 'O protocolo já está cancelado.');
  if (motivo.trim().length < 5)
    recusar('entrega-sem-motivo', 'Informe o motivo do cancelamento (ao menos 5 letras).');
}

// ── Publicação no portal: perfil e exame restrito ──────────────────────────────────────────────────────────────

export const REGRAS_RESTRICAO_PORTAL = ['nunca_publicar', 'apos_entrega_presencial', 'apos_dias'] as const;
export type RegraRestricaoPortal = (typeof REGRAS_RESTRICAO_PORTAL)[number];
export const PUBLICOS_PORTAL = ['paciente', 'medico_externo', 'empresa', 'interno'] as const;
export type PublicoPortal = (typeof PUBLICOS_PORTAL)[number];
/**
 * Os públicos que o portal aplica hoje: o acesso do paciente e o do médico externo. Os outros dois existem no
 * vocabulário (um perfil trazido de outro sistema pode tê-los), mas nenhum acesso do portal os usa: o cadastro não os
 * aceita, para ninguém confiar num perfil que não filtra nada.
 */
export const PUBLICOS_PORTAL_APLICADOS = [
  'paciente',
  'medico_externo',
] as const satisfies readonly PublicoPortal[];
export const publicoAplicado = (p: PublicoPortal): boolean =>
  (PUBLICOS_PORTAL_APLICADOS as readonly PublicoPortal[]).includes(p);

export interface RestricaoPortal {
  readonly regra: RegraRestricaoPortal;
  readonly diasCarencia: number | null;
}

export function conferirRestricaoPortal(r: RestricaoPortal): void {
  if (r.regra === 'apos_dias') {
    if (
      r.diasCarencia === null ||
      !Number.isInteger(r.diasCarencia) ||
      r.diasCarencia < 1 ||
      r.diasCarencia > 365
    )
      recusar('restricao-sem-carencia', 'Informe a carência em dias (de 1 a 365).');
  } else if (r.diasCarencia !== null)
    recusar('restricao-carencia-indevida', 'A carência em dias só vale na regra "depois de alguns dias".');
}

/** Entre a restrição do estabelecimento e a que vale para todos, vale a do estabelecimento. */
export function restricaoVigente<T extends { readonly global: boolean }>(restricoes: readonly T[]): T | null {
  return restricoes.find((r) => !r.global) ?? restricoes[0] ?? null;
}

export interface PerfilPortal {
  /** Setores cujos resultados o perfil vê; vazio: todos os setores publicados. */
  readonly setores: readonly number[];
  readonly ocultaExameRestrito: boolean;
  /** Por quantos dias o resultado fica no portal; nulo: sem limite. */
  readonly diasVisibilidade: number | null;
}

export function conferirPerfilPortal(p: {
  codigo: string;
  descricao: string;
  publico: PublicoPortal;
  diasVisibilidade: number | null;
  atualizacaoMinutos: number | null;
  setores: readonly number[];
}): void {
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(p.codigo))
    recusar('perfil-codigo-invalido', 'O código do perfil tem de 2 a 30 letras, números, ponto, hífen ou _.');
  if (p.descricao.trim().length < 3) recusar('perfil-sem-descricao', 'Descreva o perfil.');
  if (!publicoAplicado(p.publico))
    recusar(
      'perfil-publico-sem-efeito',
      'O portal ainda não aplica perfil a este público: cadastre o perfil do paciente ou o do médico externo.',
    );
  if (p.diasVisibilidade !== null && (!Number.isInteger(p.diasVisibilidade) || p.diasVisibilidade < 1))
    recusar('perfil-visibilidade-invalida', 'Os dias de visibilidade começam em 1 (ou vazio: sem limite).');
  if (p.atualizacaoMinutos !== null && (!Number.isInteger(p.atualizacaoMinutos) || p.atualizacaoMinutos < 1))
    recusar(
      'perfil-atualizacao-invalida',
      'A atualização automática começa em 1 minuto (ou vazio: desligada).',
    );
  if (new Set(p.setores).size !== p.setores.length)
    recusar('perfil-setor-repetido', 'O mesmo setor aparece duas vezes no perfil.');
}

/** O que a escolha do perfil olha: o público, o alcance (do estabelecimento ou de todos) e se está ativo. */
export interface PerfilNoAlcance {
  readonly id: number;
  readonly publico: PublicoPortal;
  readonly global: boolean;
  readonly ativo: boolean;
}

/**
 * Um perfil ativo por público e alcance: ao salvar (ou reativar) um perfil, os outros ativos do mesmo público e do
 * mesmo alcance são desativados (ficam no histórico). Devolve os ids a desativar.
 */
export function perfisSubstituidos(
  salvo: Omit<PerfilNoAlcance, 'ativo'>,
  existentes: readonly PerfilNoAlcance[],
): number[] {
  return existentes
    .filter((p) => p.ativo && p.id !== salvo.id && p.publico === salvo.publico && p.global === salvo.global)
    .map((p) => p.id);
}

/**
 * O perfil que o portal aplica a um público: o do estabelecimento vence o que vale para todos; se houver mais de um
 * ativo no mesmo alcance (perfis trazidos de outro sistema, antes de alguém salvá-los aqui), vale o mais novo. Público
 * que o portal não aplica não tem perfil aplicado.
 */
export function perfilAplicado<T extends PerfilNoAlcance>(
  perfis: readonly T[],
  publico: PublicoPortal,
): T | null {
  if (!publicoAplicado(publico)) return null;
  const candidatos = perfis
    .filter((p) => p.ativo && p.publico === publico)
    .sort((a, b) => Number(a.global) - Number(b.global) || b.id - a.id);
  return candidatos[0] ?? null;
}

export type MotivoNaoPublicado = 'setor' | 'expirado' | 'restrito' | 'aguarda_entrega' | 'carencia';

export interface LaudoParaPublicar {
  readonly setor: number | null;
  readonly liberadoEm: Date;
  /** O resultado já foi entregue no balcão (protocolo vigente). */
  readonly entreguePresencialmente: boolean;
}

/**
 * O laudo liberado aparece no portal para este perfil? Sem perfil cadastrado, valem só as restrições do exame. O
 * perfil que não oculta exame restrito (o do médico, quando o hospital decide assim) vê o restrito.
 */
export function publicacaoNoPortal(
  perfil: PerfilPortal | null,
  restricao: RestricaoPortal | null,
  laudo: LaudoParaPublicar,
  agora: Date,
): { publica: true } | { publica: false; motivo: MotivoNaoPublicado } {
  const dias = (agora.getTime() - laudo.liberadoEm.getTime()) / DIA;
  if (perfil) {
    if (perfil.setores.length > 0 && (laudo.setor === null || !perfil.setores.includes(laudo.setor)))
      return { publica: false, motivo: 'setor' };
    if (perfil.diasVisibilidade !== null && dias > perfil.diasVisibilidade)
      return { publica: false, motivo: 'expirado' };
  }
  if (restricao && (perfil === null || perfil.ocultaExameRestrito)) {
    if (restricao.regra === 'nunca_publicar') return { publica: false, motivo: 'restrito' };
    if (restricao.regra === 'apos_entrega_presencial' && !laudo.entreguePresencialmente)
      return { publica: false, motivo: 'aguarda_entrega' };
    if (restricao.regra === 'apos_dias' && dias < (restricao.diasCarencia ?? 0))
      return { publica: false, motivo: 'carencia' };
  }
  return { publica: true };
}
