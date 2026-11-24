// Regras puras da auditoria da conta item a item, do protocolo de documentos entre setores e do acompanhamento da guia
// do convênio no hospital (F3.7, 06-FAT linhas 21, 22 e 24). Sem banco: a API lê, confere aqui e grava; a tela usa as
// mesmas funções para mostrar a recusa enquanto se preenche.

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const vazio = (s: string | null | undefined) => !s || !s.trim();

// ── Auditoria da conta: o parecer de cada item ──────────────────────────────────────────────────────────────────────

export const DECISOES_ITEM_AUDITORIA = ['mantido', 'alterado', 'glosado', 'excluido'] as const;
export type DecisaoItemAuditoria = (typeof DECISOES_ITEM_AUDITORIA)[number];
export const MODALIDADES_AUDITORIA = ['interna', 'operadora', 'presencial', 'pre_analise'] as const;
export type ModalidadeAuditoria = (typeof MODALIDADES_AUDITORIA)[number];

export interface ParecerItemEntrada {
  readonly quantidadeOriginal: number;
  readonly valorOriginal: number;
  readonly decisao: DecisaoItemAuditoria;
  /** Alterado: a quantidade aceita (o valor aceito sai do unitário, salvo `valorAceito`). Glosa parcial: opcional. */
  readonly quantidadeAceita?: number | null;
  readonly valorAceito?: number | null;
  readonly motivoGlosaId?: number | null;
  readonly justificativa?: string | null;
}
export interface ParecerItemAvaliado {
  readonly quantidadeAceita: number;
  readonly valorAceito: number;
  /** O que o auditor tirou da conta (nunca negativo: o acréscimo de um item alterado não é glosa). */
  readonly valorGlosa: number;
  /** O valor da conta muda com este parecer. */
  readonly mudaValor: boolean;
}
export type ResultadoParecerItem =
  | ({ readonly ok: true } & ParecerItemAvaliado)
  | { readonly ok: false; readonly erros: Record<string, string> };

/**
 * O parecer do auditor sobre um item: mantido (nada muda), alterado (quantidade ou valor corrigidos, com
 * justificativa), glosado (glosa interna com motivo; sem valor informado, a glosa é total) ou excluído (item lançado
 * indevidamente: fica sem cobrança, nunca apagado, com justificativa).
 */
export function avaliarParecerItem(e: ParecerItemEntrada): ResultadoParecerItem {
  const erros: Record<string, string> = {};
  const qo = e.quantidadeOriginal;
  const vo = r2(e.valorOriginal);
  const unit = qo > 0 ? vo / qo : 0;
  const qa = e.quantidadeAceita ?? null;
  const va = e.valorAceito ?? null;
  if (qa !== null && (!Number.isFinite(qa) || qa < 0))
    erros['quantidadeAceita'] = 'A quantidade aceita não pode ser negativa.';
  if (va !== null && (!Number.isFinite(va) || va < 0))
    erros['valorAceito'] = 'O valor aceito não pode ser negativo.';
  let quantidade = qo;
  let valor = vo;
  switch (e.decisao) {
    case 'mantido':
      break;
    case 'alterado':
      if (qa === null && va === null)
        erros['quantidadeAceita'] = 'Informe a quantidade ou o valor aceito do item alterado.';
      quantidade = qa ?? qo;
      valor = va ?? r2(unit * quantidade);
      if (!erros['quantidadeAceita'] && quantidade === qo && valor === vo)
        erros['quantidadeAceita'] = 'Nada mudou: marque o item como mantido.';
      if (vazio(e.justificativa)) erros['justificativa'] = 'Diga por que o item foi alterado.';
      break;
    case 'glosado':
      if (!e.motivoGlosaId) erros['motivoGlosaId'] = 'Escolha o motivo da glosa.';
      quantidade = qa ?? (va === null ? 0 : qo);
      valor = va ?? (qa === null ? 0 : r2(unit * quantidade));
      if (!erros['valorAceito'] && valor >= vo)
        erros['valorAceito'] = 'Na glosa o valor aceito fica abaixo do valor lançado.';
      if (quantidade > qo) erros['quantidadeAceita'] = 'Na glosa a quantidade aceita não passa da lançada.';
      break;
    case 'excluido':
      quantidade = 0;
      valor = 0;
      if (vazio(e.justificativa)) erros['justificativa'] = 'Diga por que o item sai da conta.';
      break;
    default:
      erros['decisao'] = 'Decisão desconhecida.';
  }
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    quantidadeAceita: r4(quantidade),
    valorAceito: r2(valor),
    valorGlosa: r2(Math.max(0, vo - valor)),
    mudaValor: r2(valor) !== vo || r4(quantidade) !== r4(qo),
  };
}

export type ResultadoAuditoria = 'sem_alteracao' | 'com_ajuste' | 'com_glosa_interna';

/** O fechamento da auditoria: o valor auditado da conta, a glosa interna somada e o resultado. */
export function concluirAuditoria(
  valorOriginalConta: number,
  pareceres: readonly {
    readonly decisao: DecisaoItemAuditoria;
    readonly valorOriginal: number;
    readonly valorAceito: number;
    readonly valorGlosa: number;
  }[],
): { valorAuditado: number; valorGlosaInterna: number; resultado: ResultadoAuditoria; itensMudados: number } {
  let delta = 0;
  let glosa = 0;
  let mudados = 0;
  let glosou = false;
  for (const p of pareceres) {
    const d = r2(p.valorAceito - p.valorOriginal);
    if (p.decisao !== 'mantido') mudados++;
    delta += d;
    glosa += p.valorGlosa;
    if (p.decisao === 'glosado') glosou = true;
  }
  return {
    valorAuditado: r2(Math.max(0, valorOriginalConta + delta)),
    valorGlosaInterna: r2(glosa),
    resultado: mudados === 0 ? 'sem_alteracao' : glosou ? 'com_glosa_interna' : 'com_ajuste',
    itensMudados: mudados,
  };
}

/**
 * Antes de concluir, todo item cobrado da conta tem parecer e nenhum item auditado mudou depois do parecer. O item
 * lançado depois da abertura não está no retrato "antes" nem foi visto pelo auditor: sem parecer, a conclusão é
 * recusada (nunca conta como mantido). O parecer de um item que saiu da conta ou mudou de quantidade ou valor também
 * recusa: o auditor registra de novo.
 */
export function conferirConclusaoAuditoria(
  itensAtivos: readonly { readonly id: number; readonly quantidade: number; readonly valor: number }[],
  pareceres: readonly {
    readonly itemId: number;
    readonly quantidadeOriginal: number;
    readonly valorOriginal: number;
  }[],
): { semParecer: number[]; mudados: number[] } {
  const ativos = new Map(itensAtivos.map((i) => [i.id, i]));
  const vistos = new Set(pareceres.map((p) => p.itemId));
  const semParecer = itensAtivos.filter((i) => !vistos.has(i.id)).map((i) => i.id);
  const mudados = pareceres
    .filter((p) => {
      const i = ativos.get(p.itemId);
      return !i || r2(i.valor) !== r2(p.valorOriginal) || r4(i.quantidade) !== r4(p.quantidadeOriginal);
    })
    .map((p) => p.itemId);
  return { semParecer, mudados };
}

/** Quem audita: auditor do hospital (usuário ou profissional) ou a empresa externa da operadora. */
export function validarAberturaAuditoria(e: {
  readonly modalidade: ModalidadeAuditoria;
  readonly empresaExternaId: number | null;
  readonly auditorProfissionalId: number | null;
  readonly auditoriaEmAndamento: boolean;
}): Record<string, string> {
  const erros: Record<string, string> = {};
  if (e.auditoriaEmAndamento)
    erros['contaId'] = 'Já há uma auditoria em andamento nesta conta: conclua-a ou cancele-a.';
  if (e.modalidade === 'operadora' && !e.empresaExternaId)
    erros['empresaExternaId'] = 'Na auditoria da operadora, escolha a empresa de auditoria externa.';
  if (e.modalidade === 'interna' && e.empresaExternaId)
    erros['empresaExternaId'] = 'A auditoria interna é do hospital: tire a empresa externa.';
  return erros;
}

/** CNPJ com os dígitos verificadores (só números). */
export function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos =
      base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = base.split('').reduce((a, c, i) => a + Number(c) * pesos[i]!, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d.endsWith(`${d1}${d2}`);
}

// ── Protocolo de documentos entre setores ───────────────────────────────────────────────────────────────────────────

export const TIPOS_ITEM_PROTOCOLO = ['volume_prontuario', 'atendimento', 'conta', 'documento'] as const;
export type TipoItemProtocolo = (typeof TIPOS_ITEM_PROTOCOLO)[number];
export type SituacaoProtocolo =
  'aberto' | 'enviado' | 'recebido_parcial' | 'recebido' | 'recusado' | 'cancelado';

export interface ItemProtocoloEntrada {
  readonly tipo: TipoItemProtocolo;
  readonly alvoId?: number | null;
  readonly descricao?: string | null;
}

/** O tipo de conteúdo do lote sai dos itens (um tipo só: ele; vários: misto). */
export function conteudoDoProtocolo(
  itens: readonly ItemProtocoloEntrada[],
): 'prontuario' | 'conta' | 'documento' | 'misto' {
  const tipos = new Set(itens.map((i) => i.tipo));
  if (tipos.size !== 1) return 'misto';
  const t = [...tipos][0];
  return t === 'volume_prontuario'
    ? 'prontuario'
    : t === 'conta'
      ? 'conta'
      : t === 'documento'
        ? 'documento'
        : 'misto';
}

export function validarProtocolo(e: {
  readonly remetente: number;
  readonly destinatario: number;
  readonly itens: readonly ItemProtocoloEntrada[];
}): Record<string, string> {
  const erros: Record<string, string> = {};
  if (e.remetente === e.destinatario) erros['destinatarioId'] = 'O setor de destino é o mesmo de origem.';
  if (e.itens.length === 0) erros['itens'] = 'Inclua ao menos um item no protocolo.';
  const vistos = new Set<string>();
  e.itens.forEach((i, k) => {
    if (i.tipo === 'documento') {
      if (!i.alvoId && vazio(i.descricao)) erros[`itens.${k}`] = 'Descreva o documento avulso.';
    } else if (!i.alvoId) erros[`itens.${k}`] = 'Escolha o item a enviar.';
    const chave = i.alvoId ? `${i.tipo}:${i.alvoId}` : null;
    if (chave && vistos.has(chave)) erros[`itens.${k}`] = 'O item já está no protocolo.';
    if (chave) vistos.add(chave);
  });
  return erros;
}

/** Transições do protocolo: aberto → enviado → conferido (recebido, recebido em parte ou recusado). */
export function podeNoProtocolo(
  situacao: SituacaoProtocolo,
  acao: 'enviar' | 'conferir' | 'cancelar',
): string | null {
  if (acao === 'enviar' && situacao !== 'aberto') return 'Só o protocolo aberto é enviado.';
  if (acao === 'conferir' && situacao !== 'enviado' && situacao !== 'recebido_parcial')
    return 'Só o protocolo enviado é conferido no recebimento.';
  if (acao === 'cancelar' && situacao !== 'aberto')
    return 'O protocolo já saiu do setor: não se cancela, recusa-se no recebimento.';
  return null;
}

/** A situação depois da conferência: tudo recebido, tudo recusado ou parte pendente. */
export function situacaoAposConferencia(
  itens: readonly { readonly recebido: boolean; readonly recusado: boolean }[],
): SituacaoProtocolo {
  const recebidos = itens.filter((i) => i.recebido).length;
  const recusados = itens.filter((i) => i.recusado).length;
  if (recusados === itens.length) return 'recusado';
  if (recebidos + recusados === itens.length) return recebidos > 0 ? 'recebido' : 'recusado';
  return 'recebido_parcial';
}

// ── Guia do convênio no hospital: autorização, pendência, responsável e anexos ─────────────────────────────────────

export type SituacaoGuia =
  | 'rascunho'
  | 'solicitada'
  | 'em_analise'
  | 'pendente'
  | 'autorizada'
  | 'autorizada_parcial'
  | 'negada'
  | 'cancelada'
  | 'utilizada'
  | 'vencida';
const GUIA_ENCERRADA: readonly SituacaoGuia[] = ['cancelada', 'utilizada', 'vencida'];
export const TIPOS_ANEXO_GUIA = [
  'pedido_medico',
  'laudo',
  'relatorio_medico',
  'resultado_exame',
  'orcamento_opme',
  'termo',
  'documento_beneficiario',
  'outro',
] as const;

export const guiaEncerrada = (s: string) => (GUIA_ENCERRADA as readonly string[]).includes(s);

/** A resposta da operadora à guia: autorizada (com senha), autorizada em parte, negada (com motivo) ou em análise. */
export function validarRespostaGuia(e: {
  readonly situacaoAtual: string;
  readonly resposta: 'em_analise' | 'autorizada' | 'autorizada_parcial' | 'negada';
  readonly senha?: string | null;
  readonly validadeSenha?: string | null;
  readonly diasSolicitados?: number | null;
  readonly diasAutorizados?: number | null;
  readonly motivoNegacao?: string | null;
  readonly pendenciasAbertas: number;
  readonly hoje: string;
}): Record<string, string> {
  const erros: Record<string, string> = {};
  if (guiaEncerrada(e.situacaoAtual)) erros['resposta'] = 'A guia está encerrada: não recebe resposta.';
  const autoriza = e.resposta === 'autorizada' || e.resposta === 'autorizada_parcial';
  if (autoriza && vazio(e.senha)) erros['senha'] = 'Informe a senha dada pela operadora.';
  // Qualquer resposta tira a guia de "pendente": com pendência aberta a situação e as pendências ficariam incoerentes.
  if (e.pendenciasAbertas > 0)
    erros['resposta'] = 'Resolva as pendências abertas da guia antes de registrar a resposta da operadora.';
  if (e.validadeSenha && e.validadeSenha < e.hoje) erros['validadeSenha'] = 'A senha já venceu.';
  if (e.resposta === 'negada' && vazio(e.motivoNegacao))
    erros['motivoNegacao'] = 'Diga o motivo da negativa.';
  const ds = e.diasSolicitados ?? null;
  const da = e.diasAutorizados ?? null;
  if (da !== null && ds !== null && da > ds)
    erros['diasAutorizados'] = 'Os dias autorizados passam dos solicitados.';
  if (e.resposta === 'autorizada_parcial' && da !== null && ds !== null && da === ds)
    erros['diasAutorizados'] = 'Autorização parcial com todos os dias pedidos: marque autorizada.';
  return erros;
}

/** Abrir pendência: a guia vai para "pendente" com o motivo; o prazo não fica no passado. */
export function validarPendenciaGuia(e: {
  readonly situacaoAtual: string;
  readonly motivoId: number | null;
  readonly prazo?: string | null;
  readonly agora: string;
}): Record<string, string> {
  const erros: Record<string, string> = {};
  if (guiaEncerrada(e.situacaoAtual) || e.situacaoAtual === 'negada')
    erros['motivoId'] = 'A guia está encerrada: não recebe pendência.';
  if (!e.motivoId) erros['motivoId'] = 'Escolha o motivo da pendência.';
  if (e.prazo && e.prazo < e.agora) erros['prazo'] = 'O prazo fica no passado.';
  return erros;
}

/**
 * Ao resolver uma pendência, a guia volta à situação em que estava antes da primeira pendência aberta, mas só quando
 * não sobra outra aberta; a pendência seguinte assume o motivo corrente.
 */
export function situacaoAoResolver(e: {
  readonly situacaoAntesDaPendencia: string | null;
  readonly outrasAbertas: number;
}): { situacao: SituacaoGuia | null } {
  if (e.outrasAbertas > 0) return { situacao: null };
  const s = (e.situacaoAntesDaPendencia ?? 'em_analise') as SituacaoGuia;
  return { situacao: s === 'pendente' || s === 'rascunho' ? 'em_analise' : s };
}

/** Anexo da guia: tipo conhecido, arquivo pequeno o bastante para a operadora e um tipo de arquivo aceito. */
export const TETO_ANEXO_GUIA_BYTES = 10 * 1024 * 1024;
export const MIMES_ANEXO_GUIA = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export function validarAnexoGuia(e: {
  readonly situacaoGuia: string;
  readonly tipoDocumento: string;
  readonly tipoMime: string;
  readonly tamanhoBytes: number;
}): Record<string, string> {
  const erros: Record<string, string> = {};
  if (guiaEncerrada(e.situacaoGuia)) erros['arquivo'] = 'A guia está encerrada: não recebe anexo.';
  if (!(TIPOS_ANEXO_GUIA as readonly string[]).includes(e.tipoDocumento))
    erros['tipoDocumento'] = 'Escolha o tipo do documento.';
  if (!(MIMES_ANEXO_GUIA as readonly string[]).includes(e.tipoMime))
    erros['arquivo'] = 'Anexe PDF, JPEG ou PNG.';
  if (e.tamanhoBytes <= 0) erros['arquivo'] = 'O arquivo está vazio.';
  else if (e.tamanhoBytes > TETO_ANEXO_GUIA_BYTES) erros['arquivo'] = 'O arquivo passa de 10 MB.';
  return erros;
}
