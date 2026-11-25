// F7 (F78.04-1): três controles da internação, como regra pura (sem banco):
//   - 04-INT linha 74: formulários numerados de declaração de óbito recebidos da secretaria de saúde (lote, uso,
//     extravio, cancelamento e devolução das vias à secretaria);
//   - 04-INT linha 75: auditoria do cumprimento do isolamento no leito (critérios por tipo de precaução, conformidade,
//     reauditoria);
//   - 04-INT linha 78: quadro clínico estruturado da solicitação à central reguladora e a evolução da solicitação.
// Nada aqui apaga registro: as mudanças são transições com motivo, e o histórico fica no banco.

export type Recusa = { readonly ok: false; readonly codigo: string; readonly mensagem: string };
const recusa = (codigo: string, mensagem: string): Recusa => ({ ok: false, codigo, mensagem });

// ── Formulários de declaração de óbito ───────────────────────────────────────────────────────────────────────────

export type SituacaoFormularioObito = 'disponivel' | 'utilizado' | 'cancelado' | 'extraviado' | 'devolvido';
export type AcaoFormularioObito = 'usar' | 'extraviar' | 'cancelar' | 'devolver';

/** Maior lote recebido de uma vez (a secretaria entrega blocos; acima disso é erro de digitação). */
export const MAXIMO_FORMULARIOS_POR_LOTE = 500;

/**
 * Os números de um lote recebido, do inicial ao final, com os zeros à esquerda do número impresso. Os dois números
 * têm o mesmo tamanho (até 11 dígitos, o tamanho do número na declaração).
 */
export function numerosDoLote(inicial: string, final: string): { ok: true; numeros: string[] } | Recusa {
  const a = inicial.trim();
  const b = final.trim();
  if (!/^\d{1,11}$/.test(a) || !/^\d{1,11}$/.test(b))
    return recusa('numero-invalido', 'O número do formulário tem só dígitos (até 11).');
  if (a.length !== b.length)
    return recusa('numero-invalido', 'O número inicial e o final do lote têm o mesmo tamanho.');
  const i = Number(a);
  const f = Number(b);
  if (f < i) return recusa('lote-invertido', 'O número final do lote é menor que o inicial.');
  if (f - i + 1 > MAXIMO_FORMULARIOS_POR_LOTE)
    return recusa(
      'lote-grande',
      `Um lote tem no máximo ${MAXIMO_FORMULARIOS_POR_LOTE} formulários: confira os números digitados.`,
    );
  const numeros: string[] = [];
  for (let n = i; n <= f; n++) numeros.push(String(n).padStart(a.length, '0'));
  return { ok: true, numeros };
}

export interface ContextoAcaoFormulario {
  readonly motivo?: string | null;
  /** Para usar: o número e a situação da declaração a que o formulário se liga. */
  readonly declaracao?: {
    readonly numero: string;
    readonly situacao: 'rascunho' | 'emitida' | 'cancelada';
    readonly jaTemFormulario: boolean;
  } | null;
  readonly numeroFormulario: string;
}

const MOTIVO_MINIMO = 10;

/**
 * Decide a transição do formulário:
 *   - usar: só o disponível, ligado à declaração vigente de mesmo número que ainda não tem formulário;
 *   - extraviar: só o disponível, com motivo (o extravio vai à vigilância);
 *   - cancelar: o disponível rasurado ou o utilizado cuja declaração foi cancelada, com motivo;
 *   - devolver: as vias do cancelado (ou o disponível que sobrou) voltam à secretaria.
 */
export function decidirAcaoFormularioObito(
  atual: SituacaoFormularioObito,
  acao: AcaoFormularioObito,
  ctx: ContextoAcaoFormulario,
): { ok: true; nova: SituacaoFormularioObito; motivo: string | null } | Recusa {
  const motivo = ctx.motivo?.trim() || null;
  const exigeMotivo = () =>
    !motivo || motivo.length < MOTIVO_MINIMO
      ? recusa('motivo-obrigatorio', `Descreva o motivo (pelo menos ${MOTIVO_MINIMO} caracteres).`)
      : null;
  switch (acao) {
    case 'usar': {
      if (atual !== 'disponivel')
        return recusa('formulario-indisponivel', 'Só o formulário disponível pode ser usado.');
      const d = ctx.declaracao;
      if (!d)
        return recusa(
          'declaracao-inexistente',
          'Informe a declaração de óbito em que o formulário foi usado.',
        );
      if (d.situacao === 'cancelada')
        return recusa('declaracao-cancelada', 'A declaração está cancelada: não recebe formulário.');
      if (d.jaTemFormulario)
        return recusa('declaracao-com-formulario', 'A declaração já tem um formulário ligado.');
      if (d.numero.trim() !== ctx.numeroFormulario.trim())
        return recusa(
          'numero-divergente',
          'O número da declaração é diferente do número impresso no formulário.',
        );
      return { ok: true, nova: 'utilizado', motivo: null };
    }
    case 'extraviar': {
      if (atual !== 'disponivel')
        return recusa('formulario-indisponivel', 'Só o formulário disponível pode ser dado como extraviado.');
      return exigeMotivo() ?? { ok: true, nova: 'extraviado', motivo };
    }
    case 'cancelar': {
      if (atual !== 'disponivel' && atual !== 'utilizado')
        return recusa('transicao-invalida', 'Só o formulário disponível ou utilizado pode ser cancelado.');
      if (atual === 'utilizado' && ctx.declaracao?.situacao !== 'cancelada')
        return recusa(
          'declaracao-vigente',
          'O formulário utilizado só é cancelado depois que a declaração de óbito foi cancelada.',
        );
      return exigeMotivo() ?? { ok: true, nova: 'cancelado', motivo };
    }
    case 'devolver': {
      if (atual !== 'cancelado' && atual !== 'disponivel')
        return recusa(
          'transicao-invalida',
          'Só as vias do formulário cancelado, ou o disponível que sobrou, voltam à secretaria.',
        );
      return { ok: true, nova: 'devolvido', motivo: atual === 'cancelado' ? null : motivo };
    }
  }
}

export interface ResumoFormulariosObito {
  readonly porSituacao: Record<SituacaoFormularioObito, number>;
  /** Cancelados com as vias ainda não devolvidas à secretaria. */
  readonly viasADevolver: number;
  readonly estoqueBaixo: boolean;
}

/** Contagem por situação, as vias a devolver e o alerta de estoque (disponíveis abaixo do mínimo). */
export function resumoFormulariosObito(
  situacoes: readonly SituacaoFormularioObito[],
  minimoEstoque = 10,
): ResumoFormulariosObito {
  const porSituacao: Record<SituacaoFormularioObito, number> = {
    disponivel: 0,
    utilizado: 0,
    cancelado: 0,
    extraviado: 0,
    devolvido: 0,
  };
  for (const s of situacoes) porSituacao[s]++;
  return {
    porSituacao,
    viasADevolver: porSituacao.cancelado,
    estoqueBaixo: porSituacao.disponivel < minimoEstoque,
  };
}

// ── Auditoria do cumprimento do isolamento ───────────────────────────────────────────────────────────────────────

export type RespostaCriterio = 'conforme' | 'nao_conforme' | 'nao_se_aplica';
export type AcaoNaoConformidade = 'registrar' | 'alertar' | 'bloquear';
export type ConformidadeGeral = 'conforme' | 'parcialmente_conforme' | 'nao_conforme';

export interface CriterioAuditoria {
  readonly id: number;
  readonly descricao: string;
  readonly acao: AcaoNaoConformidade;
  readonly validadeDias: number | null;
}

export interface RespostaAuditoria {
  readonly criterio: number;
  readonly resposta: RespostaCriterio;
  readonly naoConformidade?: string | null;
  readonly acaoCorretiva?: string | null;
}

/** Percentual mínimo para "parcialmente conforme"; abaixo dele a auditoria é não conforme. */
export const PERCENTUAL_PARCIAL = 80;

export interface ResultadoAuditoria {
  readonly percentual: number | null;
  readonly geral: ConformidadeGeral;
  /** Critérios não conformes cuja ação é alertar ou bloquear (vão para o aviso da CCIH). */
  readonly alertas: readonly { criterio: number; descricao: string; acao: AcaoNaoConformidade }[];
}

/**
 * Confere e calcula a auditoria do isolamento:
 *   - o isolamento auditado está ativo;
 *   - todo critério ativo do tipo de precaução tem resposta, uma só, e nenhum critério de fora;
 *   - o não conforme descreve a não conformidade;
 *   - percentual = conformes / (conformes + não conformes), sem os "não se aplica" (4 casas);
 *   - geral: tudo conforme → conforme; algum não conforme de critério que bloqueia, ou percentual abaixo de 80 → não
 *     conforme; senão, parcialmente conforme.
 */
export function avaliarAuditoriaIsolamento(
  isolamentoAtivo: boolean,
  criterios: readonly CriterioAuditoria[],
  respostas: readonly RespostaAuditoria[],
): ({ ok: true } & ResultadoAuditoria) | Recusa {
  if (!isolamentoAtivo) return recusa('isolamento-inativo', 'Só o isolamento ativo é auditado no leito.');
  if (criterios.length === 0)
    return recusa(
      'sem-criterios',
      'O tipo de precaução não tem critérios de auditoria cadastrados: cadastre-os antes de auditar.',
    );
  const porId = new Map(criterios.map((c) => [c.id, c]));
  const vistos = new Set<number>();
  for (const r of respostas) {
    if (!porId.has(r.criterio))
      return recusa('criterio-alheio', 'Há resposta para critério que não é deste tipo de precaução.');
    if (vistos.has(r.criterio)) return recusa('criterio-repetido', 'Um critério foi respondido duas vezes.');
    vistos.add(r.criterio);
    if (r.resposta === 'nao_conforme' && !r.naoConformidade?.trim())
      return recusa(
        'nao-conformidade-sem-descricao',
        `Descreva a não conformidade de "${porId.get(r.criterio)!.descricao}".`,
      );
  }
  const faltam = criterios.filter((c) => !vistos.has(c.id));
  if (faltam.length)
    return recusa(
      'criterio-sem-resposta',
      `Responda todos os critérios (faltam ${faltam.length}: ${faltam.map((c) => c.descricao).join('; ')}).`,
    );
  const conformes = respostas.filter((r) => r.resposta === 'conforme').length;
  const naoConformes = respostas.filter((r) => r.resposta === 'nao_conforme');
  const base = conformes + naoConformes.length;
  const percentual = base === 0 ? null : Math.round((conformes / base) * 100 * 10_000) / 10_000;
  const alertas = naoConformes
    .map((r) => porId.get(r.criterio)!)
    .filter((c) => c.acao !== 'registrar')
    .map((c) => ({ criterio: c.id, descricao: c.descricao, acao: c.acao }));
  const bloqueia = alertas.some((a) => a.acao === 'bloquear');
  const geral: ConformidadeGeral =
    naoConformes.length === 0
      ? 'conforme'
      : bloqueia || (percentual ?? 0) < PERCENTUAL_PARCIAL
        ? 'nao_conforme'
        : 'parcialmente_conforme';
  return { ok: true, percentual, geral, alertas };
}

/** A próxima auditoria: o menor prazo de validade entre os critérios (sem prazo: nenhuma data). */
export function proximaReauditoria(auditadoEm: Date, criterios: readonly CriterioAuditoria[]): Date | null {
  const prazos = criterios.map((c) => c.validadeDias).filter((d): d is number => d !== null && d > 0);
  if (!prazos.length) return null;
  return new Date(auditadoEm.getTime() + Math.min(...prazos) * 86_400_000);
}

// ── Regulação: quadro clínico e evolução da solicitação ──────────────────────────────────────────────────────────

export type CondicaoGeral = 'estavel' | 'instavel' | 'grave' | 'critico';
export type SituacaoRegulacao =
  'solicitada' | 'em_analise' | 'autorizada' | 'negada' | 'cancelada' | 'concluida';
export type TipoEventoRegulacao = 'resposta' | 'mudanca_situacao' | 'contato_central' | 'cancelamento';

export interface QuadroClinicoRegulacao {
  readonly quadroClinico: string;
  readonly condicaoGeral: CondicaoGeral;
  readonly nivelConsciencia?: number | null;
  /** Ordem de gravidade do nível de consciência (cadastro), quando informado. */
  readonly gravidadeConsciencia?: number | null;
  readonly suporteOxigenio?: number | null;
  readonly suporteInvasivo?: boolean;
  readonly fluxoOxigenio?: number | null;
  readonly fracaoInspirada?: number | null;
  readonly peep?: number | null;
  readonly faixaDiurese?: number | null;
  readonly frequenciaCardiaca?: number | null;
  readonly frequenciaRespiratoria?: number | null;
  readonly pressaoSistolica?: number | null;
  readonly pressaoDiastolica?: number | null;
  readonly temperatura?: number | null;
  readonly saturacao?: number | null;
  readonly usaDrogaVasoativa?: boolean;
  readonly drogasVasoativas?: string | null;
  readonly necessitaIsolamento?: boolean;
  readonly germes?: readonly number[];
  readonly germeMultirresistente?: string | null;
}

const ORDEM_CONDICAO: Record<CondicaoGeral, number> = { estavel: 0, instavel: 1, grave: 2, critico: 3 };

/**
 * A gravidade que os dados sugerem (para a validação na hora, nunca para trocar o que o médico declarou):
 * droga vasoativa, suporte invasivo ou saturação abaixo de 85 → crítico; FiO2 a partir de 50, saturação abaixo de 90,
 * sistólica abaixo de 90 ou frequência respiratória acima de 30 → grave; saturação abaixo de 94, FC acima de 120 ou
 * febre a partir de 38,5 → instável.
 */
export function gravidadeSugerida(q: QuadroClinicoRegulacao): CondicaoGeral {
  const sat = q.saturacao ?? null;
  if (q.usaDrogaVasoativa || q.suporteInvasivo || (sat !== null && sat < 85)) return 'critico';
  if (
    (q.fracaoInspirada ?? 0) >= 50 ||
    (sat !== null && sat < 90) ||
    (q.pressaoSistolica != null && q.pressaoSistolica < 90) ||
    (q.frequenciaRespiratoria ?? 0) > 30
  )
    return 'grave';
  if ((sat !== null && sat < 94) || (q.frequenciaCardiaca ?? 0) > 120 || (q.temperatura ?? 0) >= 38.5)
    return 'instavel';
  return 'estavel';
}

/**
 * Confere o quadro clínico antes de gravar (as faixas são as do banco; as dependências, de bom senso clínico):
 *   - texto do quadro com pelo menos 20 caracteres;
 *   - fluxo, FiO2 e PEEP só com suporte de oxigênio; PEEP só com suporte invasivo;
 *   - droga vasoativa em uso exige quais e as doses;
 *   - germes sem repetição (até 3); germe multirresistente pede isolamento;
 *   - sinais nas faixas (FC até 350, FR até 120, PA até 350/250 e sistólica maior que diastólica, temperatura 25 a
 *     45, saturação 0 a 100, FiO2 21 a 100).
 * Devolve também o aviso quando a condição declarada é mais leve que a sugerida pelos dados.
 */
export function conferirQuadroClinico(
  q: QuadroClinicoRegulacao,
): { ok: true; sugerida: CondicaoGeral; aviso: string | null } | Recusa {
  if ((q.quadroClinico ?? '').trim().length < 20)
    return recusa('quadro-curto', 'Descreva o quadro clínico (pelo menos 20 caracteres).');
  const temSuporte = q.suporteOxigenio != null;
  if (!temSuporte && (q.fluxoOxigenio != null || q.fracaoInspirada != null || q.peep != null))
    return recusa('sem-suporte-oxigenio', 'Fluxo, FiO2 e PEEP pedem o suporte de oxigênio em uso.');
  if (q.peep != null && !q.suporteInvasivo)
    return recusa('peep-sem-ventilacao', 'A PEEP só se informa com suporte ventilatório invasivo.');
  if (q.usaDrogaVasoativa && !q.drogasVasoativas?.trim())
    return recusa('droga-sem-descricao', 'Informe quais drogas vasoativas e as doses em uso.');
  const germes = q.germes ?? [];
  if (germes.length > 3) return recusa('germes-demais', 'Informe até 3 germes.');
  if (new Set(germes).size !== germes.length)
    return recusa('germe-repetido', 'Um germe foi informado duas vezes.');
  if (q.germeMultirresistente?.trim() && !q.necessitaIsolamento)
    return recusa(
      'multirresistente-sem-isolamento',
      'Germe multirresistente exige marcar a necessidade de isolamento.',
    );
  const fora = (v: number | null | undefined, min: number, max: number) => v != null && (v < min || v > max);
  if (
    fora(q.frequenciaCardiaca, 0, 350) ||
    fora(q.frequenciaRespiratoria, 0, 120) ||
    fora(q.pressaoSistolica, 0, 350) ||
    fora(q.pressaoDiastolica, 0, 250) ||
    fora(q.temperatura, 25, 45) ||
    fora(q.saturacao, 0, 100) ||
    fora(q.fracaoInspirada, 21, 100)
  )
    return recusa('sinal-fora-da-faixa', 'Há sinal vital fora da faixa possível: confira os valores.');
  if (q.pressaoSistolica != null && q.pressaoDiastolica != null && q.pressaoSistolica <= q.pressaoDiastolica)
    return recusa('pressao-invertida', 'A pressão sistólica é maior que a diastólica.');
  const sugerida = gravidadeSugerida(q);
  const aviso =
    ORDEM_CONDICAO[sugerida] > ORDEM_CONDICAO[q.condicaoGeral]
      ? `Os dados informados sugerem condição "${sugerida}", mais grave que a declarada: confira antes de enviar à central.`
      : null;
  return { ok: true, sugerida, aviso };
}

const TRANSICOES: Record<SituacaoRegulacao, readonly SituacaoRegulacao[]> = {
  solicitada: ['em_analise', 'autorizada', 'negada', 'cancelada'],
  em_analise: ['autorizada', 'negada', 'cancelada'],
  autorizada: ['concluida', 'cancelada'],
  negada: [],
  cancelada: [],
  concluida: [],
};

/**
 * Decide o evento da solicitação:
 *   - resposta e contato com a central: registram a conversa (observação obrigatória) e, na resposta, a situação nova
 *     opcional pela transição válida;
 *   - mudança de situação: só pela transição válida;
 *   - cancelamento: vai a "cancelada" com o motivo.
 * Solicitação encerrada (negada, cancelada ou concluída) não recebe evento nem quadro novo.
 */
export function decidirEventoRegulacao(
  atual: SituacaoRegulacao,
  tipo: TipoEventoRegulacao,
  situacaoNova: SituacaoRegulacao | null,
  observacao: string | null,
): { ok: true; situacaoNova: SituacaoRegulacao | null } | Recusa {
  if (!TRANSICOES[atual].length)
    return recusa('regulacao-encerrada', 'A solicitação está encerrada: não recebe evento novo.');
  const obs = observacao?.trim() ?? '';
  const transicao = (nova: SituacaoRegulacao | null) =>
    nova === null || TRANSICOES[atual].includes(nova)
      ? null
      : recusa(
          'transicao-invalida',
          `A solicitação ${atual.replace('_', ' ')} não passa a ${nova.replace('_', ' ')}.`,
        );
  switch (tipo) {
    case 'cancelamento':
      if (obs.length < 10) return recusa('motivo-obrigatorio', 'Descreva o motivo do cancelamento.');
      return transicao('cancelada') ?? { ok: true, situacaoNova: 'cancelada' };
    case 'mudanca_situacao':
      if (!situacaoNova) return recusa('situacao-obrigatoria', 'Informe a situação nova.');
      if (situacaoNova === 'cancelada')
        return recusa('use-cancelamento', 'Para cancelar, registre o cancelamento com o motivo.');
      return transicao(situacaoNova) ?? { ok: true, situacaoNova };
    case 'resposta':
    case 'contato_central':
      if (obs.length < 5) return recusa('observacao-obrigatoria', 'Descreva o que a central informou.');
      if (tipo === 'contato_central' && situacaoNova)
        return recusa(
          'contato-sem-situacao',
          'O contato não muda a situação: registre a resposta da central.',
        );
      if (situacaoNova === 'cancelada')
        return recusa('use-cancelamento', 'Para cancelar, registre o cancelamento com o motivo.');
      return transicao(situacaoNova) ?? { ok: true, situacaoNova };
  }
}

/**
 * Envio manual à central: as centrais públicas operam pelo próprio portal, e o hospital registra no contato com a
 * central a data e a hora em que enviou o pedido por lá (o padrão enquanto não houver interface confirmada).
 *   - só o contato com a central leva a data do envio;
 *   - o envio não fica no futuro (tolerância de 5 minutos de relógio) nem antes da solicitação.
 */
export function conferirEnvioManual(
  tipo: TipoEventoRegulacao,
  enviadoEm: Date | null,
  solicitadoEm: Date | null,
  agora: Date,
): { ok: true } | Recusa {
  if (!enviadoEm) return { ok: true };
  if (Number.isNaN(enviadoEm.getTime()))
    return recusa('envio-invalido', 'Informe uma data e hora válidas do envio.');
  if (tipo !== 'contato_central')
    return recusa('envio-so-no-contato', 'A data do envio à central vai no contato com a central.');
  if (enviadoEm.getTime() > agora.getTime() + 5 * 60_000)
    return recusa('envio-no-futuro', 'O envio à central não pode ficar no futuro.');
  if (solicitadoEm && enviadoEm.getTime() < solicitadoEm.getTime() - 60_000)
    return recusa('envio-antes-da-solicitacao', 'O envio à central não pode ser anterior à solicitação.');
  return { ok: true };
}

/** Situação que encerra a solicitação (marca o fim) ou a regula (marca a decisão da central). */
export function marcasDaSituacao(nova: SituacaoRegulacao): { regulado: boolean; encerrado: boolean } {
  return {
    regulado: nova === 'autorizada' || nova === 'negada',
    encerrado: nova === 'negada' || nova === 'cancelada' || nova === 'concluida',
  };
}
