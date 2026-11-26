// F8 (08-SGO linha 114, C3-027): os portais externos da operadora — o do beneficiário, o da empresa contratante e o do
// corretor. Regras puras: nada de banco nem de I/O.
// - A conta do portal (conta_portal_beneficiario, conta_portal_contratante, conta_portal_corretor) liga a identidade de
//   acesso única da plataforma (o usuário; credencial e segundo fator ficam na administração) ao beneficiário, ao
//   gestor da contratante ou ao corretor. Nasce convidada; ativa só com o aceite dos termos; bloqueio pede motivo;
//   encerrada não volta. Quem é o beneficiário, a contratante ou o corretor sai sempre da conta, nunca da tela.
// - A solicitação do portal (solicitacao_portal_beneficiario) nunca altera o cadastro sozinha: a operadora analisa e
//   decide (aprovar, reprovar com o resultado, pedir documento), e o próprio solicitante só cancela a que ainda não foi
//   decidida. O beneficiário pede a segunda via do cartão, o reembolso (ligado ao pedido de reembolso), a alteração
//   cadastral e a própria exclusão; a contratante pede inclusão, exclusão e reativação dos beneficiários dela.
// - A exclusão em lote da contratante (movimentacao_lote_contratante) é criticada linha a linha: só beneficiário ativo
//   da própria contratante, sem repetição no lote, com motivo e data de efeito que não seja anterior à adesão.
// - As mensagens ao beneficiário (SMS, e-mail, aplicativo) saem pela plataforma Hal-AI, desligada até a DP-44 a: o
//   domínio só diz que o aviso ficou registrado e não enviado.

export const TIPOS_PORTAL_OPERADORA = ['beneficiario', 'contratante', 'corretor'] as const;
export type TipoPortalOperadora = (typeof TIPOS_PORTAL_OPERADORA)[number];

export const SITUACOES_CONTA_PORTAL = ['convidada', 'ativa', 'bloqueada', 'encerrada'] as const;
export type SituacaoContaPortal = (typeof SITUACOES_CONTA_PORTAL)[number];
export type AcaoContaPortal = 'ativar' | 'bloquear' | 'desbloquear' | 'encerrar';

export const TIPOS_SOLICITACAO_PORTAL = [
  'segunda_via_cartao',
  'inclusao_beneficiario',
  'exclusao_beneficiario',
  'reativacao_beneficiario',
  'reembolso',
  'alteracao_cadastral',
  'transferencia_plano',
  'outro',
] as const;
export type TipoSolicitacaoPortal = (typeof TIPOS_SOLICITACAO_PORTAL)[number];

export const SITUACOES_SOLICITACAO_PORTAL = [
  'aberta',
  'em_analise',
  'pendente_documento',
  'aprovada',
  'reprovada',
  'cancelada',
  'concluida',
] as const;
export type SituacaoSolicitacaoPortal = (typeof SITUACOES_SOLICITACAO_PORTAL)[number];
export type AcaoSolicitacaoPortal =
  'analisar' | 'pedir_documento' | 'aprovar' | 'reprovar' | 'cancelar' | 'concluir';

export interface ProblemaPortalOperadora {
  readonly codigo: string;
  readonly campo: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const vazio = (v: unknown) => v === null || v === undefined || v === '';
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// ── Conta do portal ─────────────────────────────────────────────────────────────────────────────────

export interface ContaPortalEntrada {
  readonly portal: TipoPortalOperadora;
  readonly login: string;
  readonly email: string | null;
  readonly celular: string | null;
  /** O beneficiário (portal do beneficiário). */
  readonly beneficiario?: number | null;
  /** A contratante e o gestor que opera em nome dela (portal da contratante). */
  readonly contratante?: number | null;
  readonly gestor?: number | null;
  /** A corretora ou o vendedor (portal do corretor; ao menos um). */
  readonly corretora?: number | null;
  readonly vendedor?: number | null;
}

/** O celular só com dígitos e com DDD (10 ou 11 dígitos), ou nulo. */
export const celularNormalizado = (v: string | null | undefined): string | null => {
  const d = (v ?? '').replace(/\D/g, '');
  return d ? d : null;
};

export function problemasDaContaPortal(e: ContaPortalEntrada): ProblemaPortalOperadora[] {
  const p: ProblemaPortalOperadora[] = [];
  if (!(TIPOS_PORTAL_OPERADORA as readonly string[]).includes(e.portal))
    p.push({ codigo: 'portal-invalido', campo: 'portal' });
  const login = (e.login ?? '').trim();
  if (!login || login.length > 254) p.push({ codigo: 'login-obrigatorio', campo: 'login' });
  if (e.email && !EMAIL.test(e.email.trim())) p.push({ codigo: 'email-invalido', campo: 'email' });
  if (EMAIL.test(login) === false && !e.email) p.push({ codigo: 'email-obrigatorio', campo: 'email' });
  const cel = celularNormalizado(e.celular);
  if (cel && (cel.length < 10 || cel.length > 11)) p.push({ codigo: 'celular-invalido', campo: 'celular' });
  if (e.portal === 'beneficiario' && vazio(e.beneficiario))
    p.push({ codigo: 'beneficiario-obrigatorio', campo: 'beneficiario' });
  if (e.portal === 'contratante') {
    if (vazio(e.contratante)) p.push({ codigo: 'contratante-obrigatoria', campo: 'contratante' });
    if (vazio(e.gestor)) p.push({ codigo: 'gestor-obrigatorio', campo: 'gestor' });
  }
  if (e.portal === 'corretor' && vazio(e.corretora) && vazio(e.vendedor))
    p.push({ codigo: 'corretor-obrigatorio', campo: 'corretora' });
  return p;
}

/**
 * O passo da conta: ativa só a convidada (com o aceite dos termos) ou a bloqueada (desbloquear zera as tentativas);
 * bloquear pede motivo; encerrada não volta.
 */
export function proximaSituacaoContaPortal(
  atual: SituacaoContaPortal,
  acao: AcaoContaPortal,
  o: { readonly motivo?: string | null; readonly termosAceitos?: boolean } = {},
): { readonly situacao: SituacaoContaPortal } | { readonly problema: ProblemaPortalOperadora } {
  const erro = (codigo: string, campo = 'situacao') => ({ problema: { codigo, campo } });
  if (atual === 'encerrada') return erro('conta-encerrada');
  switch (acao) {
    case 'ativar':
      if (atual !== 'convidada') return erro('conta-nao-convidada');
      if (!o.termosAceitos) return erro('termos-nao-aceitos', 'termos');
      return { situacao: 'ativa' };
    case 'bloquear':
      if (atual === 'bloqueada') return erro('conta-ja-bloqueada');
      if (!(o.motivo ?? '').trim()) return erro('motivo-obrigatorio', 'motivo');
      return { situacao: 'bloqueada' };
    case 'desbloquear':
      if (atual !== 'bloqueada') return erro('conta-nao-bloqueada');
      return { situacao: 'ativa' };
    case 'encerrar':
      return { situacao: 'encerrada' };
    default:
      return erro('acao-invalida', 'acao');
  }
}

/** A conta que entra no portal: só a ativa. */
export const contaPortalAcessa = (s: SituacaoContaPortal): boolean => s === 'ativa';

// ── Solicitação do portal ───────────────────────────────────────────────────────────────────────────

/** O que cada portal pede. O corretor não abre solicitação de movimentação: ele trabalha pela proposta. */
export const TIPOS_POR_PORTAL: Readonly<Record<TipoPortalOperadora, readonly TipoSolicitacaoPortal[]>> = {
  beneficiario: ['segunda_via_cartao', 'reembolso', 'alteracao_cadastral', 'exclusao_beneficiario', 'outro'],
  contratante: [
    'inclusao_beneficiario',
    'exclusao_beneficiario',
    'reativacao_beneficiario',
    'transferencia_plano',
    'segunda_via_cartao',
    'outro',
  ],
  corretor: [],
};

export interface SolicitacaoPortalEntrada {
  readonly portal: TipoPortalOperadora;
  readonly tipo: TipoSolicitacaoPortal;
  /** O beneficiário afetado (nulo só na inclusão). */
  readonly beneficiario: number | null;
  readonly motivo: number | null;
  readonly dataEfeito: string | null;
  readonly pedidoReembolso: number | null;
  readonly dados: Readonly<Record<string, unknown>> | null;
  readonly observacao: string | null;
}

/** Fatos do cadastro lidos pela gravação: o beneficiário afetado e a data de hoje. */
export interface FatosSolicitacaoPortal {
  readonly hoje: string;
  readonly situacaoBeneficiario: 'ativo' | 'suspenso' | 'excluido' | null;
  readonly adesao: string | null;
  /** Há outra solicitação do mesmo tipo, para o mesmo beneficiário, ainda não decidida. */
  readonly repetida: boolean;
}

export function problemasDaSolicitacaoPortal(
  e: SolicitacaoPortalEntrada,
  f: FatosSolicitacaoPortal,
): ProblemaPortalOperadora[] {
  const p: ProblemaPortalOperadora[] = [];
  if (!(TIPOS_SOLICITACAO_PORTAL as readonly string[]).includes(e.tipo))
    return [{ codigo: 'tipo-invalido', campo: 'tipo' }];
  if (!TIPOS_POR_PORTAL[e.portal].includes(e.tipo)) p.push({ codigo: 'tipo-fora-do-portal', campo: 'tipo' });
  if (e.tipo !== 'inclusao_beneficiario') {
    if (vazio(e.beneficiario)) p.push({ codigo: 'beneficiario-obrigatorio', campo: 'beneficiario' });
    else if (f.situacaoBeneficiario === null)
      p.push({ codigo: 'beneficiario-fora-da-conta', campo: 'beneficiario' });
  } else if (!e.dados || vazio(e.dados['nome'])) p.push({ codigo: 'dados-obrigatorios', campo: 'dados' });
  if (e.dataEfeito !== null && !DATA.test(e.dataEfeito))
    p.push({ codigo: 'data-invalida', campo: 'dataEfeito' });
  switch (e.tipo) {
    case 'exclusao_beneficiario':
      if (f.situacaoBeneficiario === 'excluido')
        p.push({ codigo: 'beneficiario-ja-excluido', campo: 'beneficiario' });
      if (vazio(e.motivo)) p.push({ codigo: 'motivo-obrigatorio', campo: 'motivo' });
      if (!e.dataEfeito) p.push({ codigo: 'data-efeito-obrigatoria', campo: 'dataEfeito' });
      else if (f.adesao && e.dataEfeito < f.adesao)
        p.push({ codigo: 'efeito-antes-da-adesao', campo: 'dataEfeito' });
      break;
    case 'reativacao_beneficiario':
      if (f.situacaoBeneficiario !== null && f.situacaoBeneficiario === 'ativo')
        p.push({ codigo: 'beneficiario-ativo', campo: 'beneficiario' });
      if (!e.dataEfeito) p.push({ codigo: 'data-efeito-obrigatoria', campo: 'dataEfeito' });
      break;
    case 'segunda_via_cartao':
      if (f.situacaoBeneficiario === 'excluido')
        p.push({ codigo: 'beneficiario-excluido', campo: 'beneficiario' });
      break;
    case 'reembolso':
      if (vazio(e.pedidoReembolso)) p.push({ codigo: 'reembolso-obrigatorio', campo: 'pedidoReembolso' });
      break;
    case 'alteracao_cadastral':
    case 'transferencia_plano':
      if (!e.dados || Object.keys(e.dados).length === 0)
        p.push({ codigo: 'dados-obrigatorios', campo: 'dados' });
      break;
    case 'outro':
      if (!(e.observacao ?? '').trim()) p.push({ codigo: 'observacao-obrigatoria', campo: 'observacao' });
      break;
    default:
      break;
  }
  if (f.repetida) p.push({ codigo: 'solicitacao-repetida', campo: 'tipo' });
  return p;
}

const DECIDIDAS: readonly SituacaoSolicitacaoPortal[] = ['aprovada', 'reprovada', 'cancelada', 'concluida'];
export const solicitacaoDecidida = (s: SituacaoSolicitacaoPortal): boolean => DECIDIDAS.includes(s);

/**
 * O passo da solicitação. A operadora analisa, pede documento, aprova ou reprova (com o resultado) e conclui a aprovada;
 * o solicitante só cancela a que não foi decidida. Decidida não volta.
 */
export function proximaSituacaoSolicitacaoPortal(
  atual: SituacaoSolicitacaoPortal,
  acao: AcaoSolicitacaoPortal,
  resultado: string | null,
): { readonly situacao: SituacaoSolicitacaoPortal } | { readonly problema: ProblemaPortalOperadora } {
  const erro = (codigo: string, campo = 'situacao') => ({ problema: { codigo, campo } });
  if (acao === 'concluir')
    return atual === 'aprovada' ? { situacao: 'concluida' } : erro('solicitacao-nao-aprovada');
  if (solicitacaoDecidida(atual)) return erro('solicitacao-decidida');
  switch (acao) {
    case 'analisar':
      return atual === 'em_analise' ? erro('solicitacao-em-analise') : { situacao: 'em_analise' };
    case 'pedir_documento':
      if (!(resultado ?? '').trim()) return erro('resultado-obrigatorio', 'resultado');
      return { situacao: 'pendente_documento' };
    case 'aprovar':
      return { situacao: 'aprovada' };
    case 'reprovar':
      if (!(resultado ?? '').trim()) return erro('resultado-obrigatorio', 'resultado');
      return { situacao: 'reprovada' };
    case 'cancelar':
      return { situacao: 'cancelada' };
    default:
      return erro('acao-invalida', 'acao');
  }
}

// ── Exclusão em lote da contratante ─────────────────────────────────────────────────────────────────

export interface LinhaExclusaoLote {
  readonly sequencia: number;
  readonly matricula: string;
  readonly motivo: number | null;
  readonly dataEfeito: string | null;
}

/** O beneficiário da contratante achado pela matrícula (carteira ou matrícula funcional). */
export interface BeneficiarioDoLote {
  readonly id: number;
  readonly matricula: string;
  readonly nome: string;
  readonly situacao: 'ativo' | 'suspenso' | 'excluido';
  readonly adesao: string;
  readonly titular: number | null;
}

export interface LinhaExclusaoCriticada {
  readonly sequencia: number;
  readonly matricula: string;
  readonly beneficiario: number | null;
  readonly nome: string;
  readonly situacao: 'aceito' | 'rejeitado';
  readonly critica: string | null;
}

/**
 * A crítica da exclusão em lote: cada linha só passa com beneficiário ativo ou suspenso da contratante, sem repetição
 * no lote, com motivo e data de efeito não anterior à adesão. O titular aceito leva os dependentes dele que não
 * estiverem no lote só se `desligaDependentes` (a linha do dependente é criada pela gravação; aqui só o aviso).
 */
export function criticarExclusaoLote(
  linhas: readonly LinhaExclusaoLote[],
  doContratante: readonly BeneficiarioDoLote[],
): {
  readonly linhas: readonly LinhaExclusaoCriticada[];
  readonly totais: { readonly registros: number; readonly aceitos: number; readonly rejeitados: number };
} {
  const porMatricula = new Map(doContratante.map((b) => [b.matricula.trim(), b]));
  const vistas = new Set<string>();
  const vistos = new Set<number>();
  const saida = linhas.map((l): LinhaExclusaoCriticada => {
    const mat = (l.matricula ?? '').trim();
    const b = porMatricula.get(mat);
    const rejeita = (critica: string): LinhaExclusaoCriticada => ({
      sequencia: l.sequencia,
      matricula: mat,
      beneficiario: b?.id ?? null,
      nome: b?.nome ?? '(não localizado)',
      situacao: 'rejeitado',
      critica,
    });
    if (!mat) return rejeita('matricula-obrigatoria');
    if (vistas.has(mat)) return rejeita('linha-repetida');
    vistas.add(mat);
    if (!b) return rejeita('beneficiario-fora-da-contratante');
    // O mesmo beneficiário pela carteira numa linha e pela matrícula funcional em outra também é repetição.
    if (vistos.has(b.id)) return rejeita('linha-repetida');
    vistos.add(b.id);
    if (b.situacao === 'excluido') return rejeita('beneficiario-ja-excluido');
    if (l.motivo === null) return rejeita('motivo-obrigatorio');
    if (!l.dataEfeito || !DATA.test(l.dataEfeito)) return rejeita('data-efeito-obrigatoria');
    if (l.dataEfeito < b.adesao) return rejeita('efeito-antes-da-adesao');
    return {
      sequencia: l.sequencia,
      matricula: mat,
      beneficiario: b.id,
      nome: b.nome,
      situacao: 'aceito',
      critica: null,
    };
  });
  const aceitos = saida.filter((x) => x.situacao === 'aceito').length;
  return { linhas: saida, totais: { registros: saida.length, aceitos, rejeitados: saida.length - aceitos } };
}

/** A situação do lote depois da crítica. */
export const situacaoDoLoteCriticado = (t: { aceitos: number; rejeitados: number }) =>
  t.aceitos === 0 ? ('rejeitado' as const) : ('criticado' as const);

/** A situação do lote depois do processamento das linhas aceitas. */
export const situacaoDoLoteProcessado = (t: { aceitos: number; rejeitados: number }) =>
  t.aceitos === 0
    ? ('rejeitado' as const)
    : t.rejeitados === 0
      ? ('processado' as const)
      : ('processado_parcial' as const);

// ── Cartão digital e mensagens ──────────────────────────────────────────────────────────────────────

export interface CartaoDigital {
  readonly matricula: string;
  readonly nome: string;
  readonly via: number;
  readonly produto: string;
  readonly registroAns: string | null;
  readonly inicioVigencia: string;
  readonly fimVigencia: string | null;
  readonly valido: boolean;
}

/** O cartão digital vale enquanto o beneficiário está ativo e dentro da vigência. */
export function cartaoDigitalValido(
  b: { readonly situacao: string; readonly inicioVigencia: string; readonly fimVigencia: string | null },
  hoje: string,
): boolean {
  return (
    b.situacao === 'ativo' && b.inicioVigencia <= hoje && (b.fimVigencia === null || b.fimVigencia >= hoje)
  );
}

/** O canal das mensagens do portal (SMS, e-mail, aplicativo) é a plataforma Hal-AI, desligada até a DP-44 a. */
export const CANAL_MENSAGEM_PORTAL = { canal: 'plataforma', ligado: false, decisao: 'DP-44 a' } as const;

/** O aviso ao titular da conta: registrado e não enviado enquanto o canal estiver desligado. */
export function avisoDaSolicitacao(
  conta: {
    readonly recebeNotificacoes: boolean;
    readonly celular: string | null;
    readonly email: string | null;
  },
  situacao: SituacaoSolicitacaoPortal,
): {
  readonly enviar: false;
  readonly motivo: 'canal-desligado' | 'sem-notificacao' | 'sem-contato';
  readonly situacao: SituacaoSolicitacaoPortal;
} {
  if (!conta.recebeNotificacoes) return { enviar: false, motivo: 'sem-notificacao', situacao };
  if (!conta.celular && !conta.email) return { enviar: false, motivo: 'sem-contato', situacao };
  return { enviar: false, motivo: 'canal-desligado', situacao };
}
