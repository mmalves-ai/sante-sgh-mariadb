// Auditoria da prescrição de antimicrobiano pela comissão de controle de infecção (F7, 03-PEP linha 110). A ficha de
// antimicrobiano que o prescritor preenche junto da prescrição chega à comissão pendente; a auditoria avalia a droga, a
// dose, o tempo e a via, registra a indicação e o parecer, e o parecer volta à ficha (aprovada, ajuste solicitado,
// reprovada ou suspensa). Regras puras, sem banco: a API recusa com os mesmos códigos e a tela trava o botão na hora.
// Melhoria: o parecer padrão do cadastro e o tipo de auditoria já trazem a prorrogação e o parecer sugerido (menos
// cliques); a indicação vem da finalidade da ficha; o parecer que contradiz a avaliação (aprovado com item inadequado,
// tipo "suspender" sem suspensão) é recusado; todo parecer que não aprova traz a recomendação ao prescritor; a ficha não
// avaliável não marca adequação nem prorroga.

export const PARECERES_AUDITORIA_ANTIMICROBIANO = [
  'aprovado',
  'aprovado_com_ressalva',
  'reprovado',
  'suspenso',
] as const;
export type ParecerAuditoriaAntimicrobiano = (typeof PARECERES_AUDITORIA_ANTIMICROBIANO)[number];

export const ADEQUACOES_AUDITORIA = ['adequada', 'inadequada', 'nao_avaliada'] as const;
export type AdequacaoAuditoria = (typeof ADEQUACOES_AUDITORIA)[number];

export const INDICACOES_AUDITORIA = ['profilaxia', 'empirico', 'direcionado_cultura', 'outro'] as const;
export type IndicacaoAuditoria = (typeof INDICACOES_AUDITORIA)[number];

/** A ação do tipo de auditoria (cadastro do cliente). */
export type AcaoTipoAuditoria =
  'manter' | 'descalonar' | 'escalonar' | 'suspender' | 'trocar' | 'ajustar_dose' | 'ajustar_tempo';

/** A situação da avaliação que o parecer deixa na ficha de antimicrobiano. */
export type AvaliacaoFicha = 'aprovada' | 'ajuste_solicitado' | 'reprovada' | 'suspensa';

export const RECOMENDACAO_MINIMA = 10;

export interface EntradaAuditoriaAntimicrobiano {
  readonly avaliavel: boolean;
  readonly droga: AdequacaoAuditoria;
  readonly dose: AdequacaoAuditoria;
  readonly tempo: AdequacaoAuditoria;
  readonly via: AdequacaoAuditoria;
  readonly indicacao: IndicacaoAuditoria | null;
  readonly parecer: ParecerAuditoriaAntimicrobiano | '';
  /** null: herda do parecer padrão (ou não prorroga). */
  readonly permiteProrrogacao: boolean | null;
  readonly recomendacao: string | null;
}

export interface ContextoAuditoria {
  /** O parecer padrão escolhido do cadastro (null: nenhum). */
  readonly parecerPadrao: { readonly ativo: boolean; readonly permiteProrrogacao: boolean } | null;
  /** O tipo de auditoria escolhido do cadastro (null: nenhum). */
  readonly tipo: { readonly ativo: boolean; readonly acao: AcaoTipoAuditoria } | null;
  /** A finalidade da ficha auditada (código do catálogo), para sugerir a indicação. */
  readonly finalidade: string | null;
}

export type RecusaAuditoriaAntimicrobiano =
  | 'parecer-obrigatorio'
  | 'parecer-incoerente'
  | 'recomendacao-obrigatoria'
  | 'prorrogacao-sem-aprovacao'
  | 'parecer-padrao-inativo'
  | 'tipo-auditoria-inativo';

export const MENSAGENS_AUDITORIA_ANTIMICROBIANO: Record<RecusaAuditoriaAntimicrobiano, string> = {
  'parecer-obrigatorio': 'Escolha o parecer: aprovado, aprovado com ressalva, reprovado ou suspenso.',
  'parecer-incoerente':
    'O parecer contradiz a avaliação: com droga, dose, tempo ou via inadequada (ou o tipo "suspender") não há aprovação sem ressalva.',
  'recomendacao-obrigatoria': `O parecer que não aprova leva a recomendação ao prescritor (ao menos ${String(RECOMENDACAO_MINIMA)} caracteres).`,
  'prorrogacao-sem-aprovacao':
    'Só o parecer que aprova (com ou sem ressalva) permite prorrogar o tratamento.',
  'parecer-padrao-inativo': 'O parecer padrão escolhido está inativo no cadastro.',
  'tipo-auditoria-inativo': 'O tipo de auditoria escolhido está inativo no cadastro.',
};

/** Finalidade da ficha (código do catálogo) → indicação da auditoria. */
export function indicacaoDaFinalidade(finalidade: string | null): IndicacaoAuditoria | null {
  if (finalidade === null) return null;
  if (finalidade === 'empirica') return 'empirico';
  if (finalidade === 'terapeutica') return 'direcionado_cultura';
  if (finalidade.startsWith('profila')) return 'profilaxia';
  return 'outro';
}

/** O parecer sugerido pela ação do tipo de auditoria (a tela pré-seleciona). */
export function parecerSugerido(acao: AcaoTipoAuditoria | null): ParecerAuditoriaAntimicrobiano | null {
  if (acao === null) return null;
  if (acao === 'manter') return 'aprovado';
  if (acao === 'suspender') return 'suspenso';
  return 'aprovado_com_ressalva';
}

/** A situação que o parecer deixa na ficha. */
export function avaliacaoDaFicha(p: ParecerAuditoriaAntimicrobiano): AvaliacaoFicha {
  if (p === 'aprovado') return 'aprovada';
  if (p === 'aprovado_com_ressalva') return 'ajuste_solicitado';
  if (p === 'reprovado') return 'reprovada';
  return 'suspensa';
}

export interface AuditoriaParaGravar {
  readonly avaliavel: boolean;
  readonly droga: AdequacaoAuditoria;
  readonly dose: AdequacaoAuditoria;
  readonly tempo: AdequacaoAuditoria;
  readonly via: AdequacaoAuditoria;
  readonly indicacao: IndicacaoAuditoria | null;
  readonly parecer: ParecerAuditoriaAntimicrobiano;
  readonly permiteProrrogacao: boolean;
  readonly recomendacao: string | null;
  readonly avaliacaoFicha: AvaliacaoFicha;
}

export type ResultadoAuditoria =
  | { readonly ok: true; readonly gravar: AuditoriaParaGravar }
  | { readonly ok: false; readonly recusas: readonly RecusaAuditoriaAntimicrobiano[] };

/** Decide o que a auditoria grava, ou as recusas (todas de uma vez, para a tela mostrar o que falta). */
export function avaliarAuditoriaAntimicrobiano(
  e: EntradaAuditoriaAntimicrobiano,
  ctx: ContextoAuditoria,
): ResultadoAuditoria {
  const recusas: RecusaAuditoriaAntimicrobiano[] = [];
  if (ctx.parecerPadrao && !ctx.parecerPadrao.ativo) recusas.push('parecer-padrao-inativo');
  if (ctx.tipo && !ctx.tipo.ativo) recusas.push('tipo-auditoria-inativo');
  const adequacoes = e.avaliavel
    ? { droga: e.droga, dose: e.dose, tempo: e.tempo, via: e.via }
    : {
        droga: 'nao_avaliada' as const,
        dose: 'nao_avaliada' as const,
        tempo: 'nao_avaliada' as const,
        via: 'nao_avaliada' as const,
      };
  const parecer = e.parecer;
  if (parecer === '') recusas.push('parecer-obrigatorio');
  else {
    const inadequada = Object.values(adequacoes).includes('inadequada');
    if (parecer === 'aprovado' && (inadequada || ctx.tipo?.acao === 'suspender'))
      recusas.push('parecer-incoerente');
    if (ctx.tipo?.acao === 'suspender' && parecer !== 'suspenso' && parecer !== 'aprovado')
      recusas.push('parecer-incoerente');
  }
  const recomendacao = e.recomendacao?.trim() ? e.recomendacao.trim() : null;
  if (parecer !== '' && parecer !== 'aprovado' && (recomendacao?.length ?? 0) < RECOMENDACAO_MINIMA)
    recusas.push('recomendacao-obrigatoria');
  const aprova = parecer === 'aprovado' || parecer === 'aprovado_com_ressalva';
  const prorroga = e.avaliavel && (e.permiteProrrogacao ?? ctx.parecerPadrao?.permiteProrrogacao ?? false);
  if (e.permiteProrrogacao === true && (!aprova || !e.avaliavel)) recusas.push('prorrogacao-sem-aprovacao');
  if (recusas.length || parecer === '') return { ok: false, recusas: [...new Set(recusas)] };
  return {
    ok: true,
    gravar: {
      avaliavel: e.avaliavel,
      ...adequacoes,
      indicacao: e.indicacao ?? indicacaoDaFinalidade(ctx.finalidade),
      parecer,
      permiteProrrogacao: aprova && prorroga,
      recomendacao,
      avaliacaoFicha: avaliacaoDaFicha(parecer),
    },
  };
}
