// Análise de causa e plano de ação 5W2H, etapa 2 do M48 (ficha, seção 5: qualidade.registrarAnalise e
// qualidade.registrarPlanoAcao; manual m17 "Como o NSP trata uma notificação"):
//   - quem analisa: o NSP ou o gestor a quem a notificação foi distribuída (o gestor nunca vê quem notificou, regra 1);
//   - a análise começa na distribuída (distribuída → em análise) e conclui com a causa raiz e o plano com pelo menos uma
//     ação, ou com a justificativa de não haver ação (em análise → concluída: cumpre o prazo de 60 dias do óbito e do
//     never event, prazos.ts); depois de concluída a análise não muda (as ações seguem até a eficácia);
//   - cada ação do plano responde às sete perguntas (o quê, por quê, onde, quando, quem, como, quanto); o prazo não fica
//     no passado; a situação anda planejada → em andamento → concluída (com a evidência) ou cancelada (com o motivo);
//     a eficácia só se verifica na concluída, uma vez;
//   - controle otimista pela versão da análise e de cada ação (outra pessoa mexeu → recusa).
import type {
  AcaoPlanoLida,
  ConteudoAnalise,
  EficaciaAcao,
  FatorContribuinte,
  SituacaoAcao,
  SituacaoAnalise,
  SituacaoNotificacao,
  TipoEventoNotificacao,
} from '@sgh/contratos';

export type RecusaAnalise =
  | 'versao-desatualizada'
  | 'situacao-nao-permite'
  | 'analise-concluida'
  | 'sem-causa-raiz'
  | 'sem-acao'
  | 'conteudo-grande'
  | 'prazo-no-passado'
  | 'texto-obrigatorio'
  | 'eficacia-so-concluida'
  | 'eficacia-ja-verificada'
  | 'limite-acoes';

export type ResultadoAnalise<T> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly motivo: RecusaAnalise };

const recusa = <T>(motivo: RecusaAnalise): ResultadoAnalise<T> => ({ ok: false, motivo });

/** Teto do conteúdo serializado (SGH_QUA_ANALISE.CONTEUDO). */
export const TETO_CONTEUDO_ANALISE = 6000;
/** Teto de ações por notificação. */
export const TETO_ACOES_PLANO = 30;

/** Situações da notificação em que a análise pode ser registrada. */
const ANALISAVEL: ReadonlySet<SituacaoNotificacao> = new Set(['distribuida', 'emAnalise']);
/** Situações em que o plano aceita ação nova ou mudança (a ação continua depois da análise concluída). */
const PLANO_ABERTO: ReadonlySet<SituacaoNotificacao> = new Set(['distribuida', 'emAnalise', 'concluida']);

/** Quem pode ver e registrar a análise: o NSP ou o gestor a quem foi distribuída. */
export function podeAnalisar(
  n: { readonly situacao: SituacaoNotificacao; readonly gestor: string | null },
  quem: { readonly nsp: boolean; readonly login: string },
): boolean {
  if (!PLANO_ABERTO.has(n.situacao)) return false;
  if (quem.nsp) return true;
  return n.gestor !== null && n.gestor.trim().toUpperCase() === quem.login.trim().toUpperCase();
}

/** Os fatores contribuintes da análise: os informados mais os dos problemas do Protocolo de Londres, sem repetir. */
export function fatoresDaAnalise(
  conteudo: ConteudoAnalise,
  informados: readonly FatorContribuinte[],
): FatorContribuinte[] {
  const s = new Set<FatorContribuinte>(informados);
  if (conteudo.metodo === 'londres') for (const p of conteudo.problemas) for (const f of p.fatores) s.add(f);
  return [...s];
}

/** A causa raiz proposta pelo método quando o analista não escreveu uma: o último porquê. */
export function causaRaizProposta(conteudo: ConteudoAnalise): string | null {
  if (conteudo.metodo === 'cincoPorques') return conteudo.porques[conteudo.porques.length - 1] ?? null;
  return null;
}

export interface DecisaoAnalise {
  /** Ainda não havia análise: INSERT. */
  readonly criar: boolean;
  readonly situacao: SituacaoAnalise;
  /** Eventos na linha do tempo da notificação (na ordem). */
  readonly eventos: readonly TipoEventoNotificacao[];
  /** A situação nova da notificação, quando muda. */
  readonly situacaoNotificacao: SituacaoNotificacao | null;
  readonly causaRaiz: string | null;
  readonly fatores: readonly FatorContribuinte[];
}

/** `qualidade.registrarAnalise` sobre a notificação travada e a análise atual (null: ainda não existe). */
export function conferirAnalise(
  notificacao: { readonly situacao: SituacaoNotificacao },
  atual: { readonly situacao: SituacaoAnalise; readonly versao: number } | null,
  e: {
    readonly versao: number;
    readonly conteudo: ConteudoAnalise;
    readonly causaRaiz: string | null;
    readonly fatores: readonly FatorContribuinte[];
    readonly concluir: boolean;
    readonly semAcaoJustificativa: string | null;
  },
  acoesAtivas: number,
): ResultadoAnalise<DecisaoAnalise> {
  if (atual === null ? e.versao !== 0 : atual.versao !== e.versao) return recusa('versao-desatualizada');
  if (atual?.situacao === 'concluida') return recusa('analise-concluida');
  if (!ANALISAVEL.has(notificacao.situacao)) return recusa('situacao-nao-permite');
  if (JSON.stringify(e.conteudo).length > TETO_CONTEUDO_ANALISE) return recusa('conteudo-grande');
  const causaRaiz = (e.causaRaiz ?? '').trim() || causaRaizProposta(e.conteudo);
  if (e.concluir) {
    if (causaRaiz === null || causaRaiz.trim().length < 10) return recusa('sem-causa-raiz');
    if (acoesAtivas < 1 && (e.semAcaoJustificativa ?? '').trim().length < 10) return recusa('sem-acao');
  }
  const eventos: TipoEventoNotificacao[] = [];
  let situacaoNotificacao: SituacaoNotificacao | null = null;
  if (notificacao.situacao === 'distribuida') {
    eventos.push('analiseIniciada');
    situacaoNotificacao = 'emAnalise';
  }
  if (e.concluir) {
    eventos.push('analiseConcluida');
    situacaoNotificacao = 'concluida';
  }
  return {
    ok: true,
    valor: {
      criar: atual === null,
      situacao: e.concluir ? 'concluida' : 'rascunho',
      eventos,
      situacaoNotificacao,
      causaRaiz: causaRaiz === null ? null : causaRaiz.slice(0, 2000),
      fatores: fatoresDaAnalise(e.conteudo, e.fatores),
    },
  };
}

// ── Plano de ação ──────────────────────────────────────────────────────────────────────────────────

export interface EstadoAcao {
  readonly situacao: SituacaoAcao;
  readonly versao: number;
  readonly quando: string;
  readonly eficacia: EficaciaAcao | null;
}

const ABERTA: ReadonlySet<SituacaoAcao> = new Set(['planejada', 'emAndamento']);

/** Ação nova (`hoje`: AAAA-MM-DD local). */
export function conferirAcaoNova(
  notificacao: { readonly situacao: SituacaoNotificacao },
  acao: { readonly quando: string },
  hoje: string,
  totalAcoes: number,
): ResultadoAnalise<{ readonly situacao: SituacaoAcao }> {
  if (!PLANO_ABERTO.has(notificacao.situacao)) return recusa('situacao-nao-permite');
  if (totalAcoes >= TETO_ACOES_PLANO) return recusa('limite-acoes');
  if (acao.quando < hoje) return recusa('prazo-no-passado');
  return { ok: true, valor: { situacao: 'planejada' } };
}

/** Alteração do 5W2H de uma ação aberta (o prazo que não mudou pode ficar no passado: a ação atrasada). */
export function conferirAlteracaoAcao(
  notificacao: { readonly situacao: SituacaoNotificacao },
  atual: EstadoAcao,
  e: { readonly versao: number; readonly quando: string },
  hoje: string,
): ResultadoAnalise<{ readonly situacao: SituacaoAcao }> {
  if (atual.versao !== e.versao) return recusa('versao-desatualizada');
  if (!PLANO_ABERTO.has(notificacao.situacao) || !ABERTA.has(atual.situacao))
    return recusa('situacao-nao-permite');
  if (e.quando !== atual.quando && e.quando < hoje) return recusa('prazo-no-passado');
  return { ok: true, valor: { situacao: atual.situacao } };
}

const PROXIMAS: Readonly<Record<SituacaoAcao, readonly SituacaoAcao[]>> = {
  planejada: ['emAndamento', 'concluida', 'cancelada'],
  emAndamento: ['concluida', 'cancelada'],
  concluida: [],
  cancelada: [],
};

/** Iniciar, concluir (com a evidência) ou cancelar (com o motivo). */
export function conferirSituacaoAcao(
  notificacao: { readonly situacao: SituacaoNotificacao },
  atual: EstadoAcao,
  e: { readonly versao: number; readonly situacao: SituacaoAcao; readonly texto: string | null },
): ResultadoAnalise<{ readonly situacao: SituacaoAcao; readonly encerra: boolean }> {
  if (atual.versao !== e.versao) return recusa('versao-desatualizada');
  if (!PLANO_ABERTO.has(notificacao.situacao) || !PROXIMAS[atual.situacao].includes(e.situacao))
    return recusa('situacao-nao-permite');
  const encerra = e.situacao === 'concluida' || e.situacao === 'cancelada';
  if (encerra && (e.texto ?? '').trim().length < 10) return recusa('texto-obrigatorio');
  return { ok: true, valor: { situacao: e.situacao, encerra } };
}

/** A verificação da eficácia (só na concluída, uma vez). */
export function conferirEficacia(
  atual: EstadoAcao,
  e: { readonly versao: number },
): ResultadoAnalise<{ readonly verificada: true }> {
  if (atual.versao !== e.versao) return recusa('versao-desatualizada');
  if (atual.situacao !== 'concluida') return recusa('eficacia-so-concluida');
  if (atual.eficacia !== null) return recusa('eficacia-ja-verificada');
  return { ok: true, valor: { verificada: true } };
}

/** Aberta (planejada ou em andamento) com o prazo antes de hoje. */
export function acaoAtrasada(
  a: { readonly situacao: SituacaoAcao; readonly quando: string },
  hoje: string,
): boolean {
  return ABERTA.has(a.situacao) && a.quando < hoje;
}

/** Ações que contam para concluir a análise (as não canceladas). */
export function acoesAtivas(acoes: readonly { readonly situacao: SituacaoAcao }[]): number {
  return acoes.filter((a) => a.situacao !== 'cancelada').length;
}

export interface ResumoPlano {
  readonly total: number;
  readonly abertas: number;
  readonly atrasadas: number;
  readonly concluidas: number;
  readonly canceladas: number;
  /** Concluídas com a eficácia verificada (o denominador da eficácia). */
  readonly verificadas: number;
  readonly eficazes: number;
}

export function resumoDoPlano(
  acoes: readonly Pick<AcaoPlanoLida, 'situacao' | 'quando' | 'eficacia'>[],
  hoje: string,
): ResumoPlano {
  let abertas = 0;
  let atrasadas = 0;
  let concluidas = 0;
  let canceladas = 0;
  let verificadas = 0;
  let eficazes = 0;
  for (const a of acoes) {
    if (ABERTA.has(a.situacao)) abertas++;
    if (acaoAtrasada(a, hoje)) atrasadas++;
    if (a.situacao === 'concluida') concluidas++;
    if (a.situacao === 'cancelada') canceladas++;
    if (a.eficacia !== null) verificadas++;
    if (a.eficacia === 'eficaz') eficazes++;
  }
  return { total: acoes.length, abertas, atrasadas, concluidas, canceladas, verificadas, eficazes };
}

export const MENSAGENS_RECUSA_ANALISE: Readonly<Record<RecusaAnalise, string>> = {
  'versao-desatualizada': 'Outra pessoa alterou a análise ou o plano. Recarregue para ver a versão atual.',
  'situacao-nao-permite': 'A situação atual da notificação ou da ação não permite esta mudança.',
  'analise-concluida': 'A análise já foi concluída e não muda mais; o plano de ação continua aberto.',
  'sem-causa-raiz': 'Para concluir, escreva a causa raiz (pelo menos 10 caracteres).',
  'sem-acao':
    'Para concluir, inclua pelo menos uma ação no plano ou explique por que não há ação (pelo menos 10 caracteres).',
  'conteudo-grande': 'A análise ficou grande demais: resuma os itens.',
  'prazo-no-passado': 'O prazo da ação não pode ser anterior a hoje.',
  'texto-obrigatorio':
    'Escreva a evidência da conclusão ou o motivo do cancelamento (pelo menos 10 caracteres).',
  'eficacia-so-concluida': 'A eficácia só se verifica depois de a ação ser concluída.',
  'eficacia-ja-verificada': 'A eficácia desta ação já foi verificada.',
  'limite-acoes': 'O plano já tem 30 ações. Agrupe as ações parecidas.',
};
