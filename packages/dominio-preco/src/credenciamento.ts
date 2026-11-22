// ADR 0009, decisões 25 e 26: atender sem credenciamento é ALERTA por padrão e BLOQUEIO quando o convênio pede
// (bloqueia_sem_credenciamento). O particular nunca pede credenciamento. Credenciamento sem plano vale para todos os
// planos; com plano, vale para ele e para os subplanos dele (plano superior). Um registro vigente com credenciado =
// falso descredencia (vence o de plano mais específico). Função pura: a porta traz os credenciamentos vigentes.
import type { Credenciamento, OpcoesCredenciamentoConvenio, VerificacaoCredenciamento } from '@sgh/contratos';

export interface EntradaVerificarCredenciamento {
  readonly particular: boolean;
  readonly profissionalId: number | null;
  readonly planoId: number | null;
  /** Plano superior do plano do paciente (subplano), quando houver. */
  readonly planoSuperiorId: number | null;
  /**
   * O plano do paciente não é conhecido neste passo (a marcação da agenda não traz o plano). Com planoId nulo, o
   * credenciamento vigente em qualquer plano do convênio impede o bloqueio: o resultado é só alerta, para conferir o
   * plano na abertura do atendimento.
   */
  readonly planoDesconhecido?: boolean;
  readonly data: string;
  readonly credenciamentos: readonly Credenciamento[];
  readonly opcoes: OpcoesCredenciamentoConvenio | null;
}

function especificidade(c: Credenciamento, e: EntradaVerificarCredenciamento): number {
  if (c.planoId === null) return 1;
  if (e.planoId !== null && c.planoId === e.planoId) return 3;
  if (e.planoSuperiorId !== null && c.planoId === e.planoSuperiorId) return 2;
  return 0;
}

export function verificarCredenciamento(e: EntradaVerificarCredenciamento): VerificacaoCredenciamento {
  if (e.particular || e.profissionalId === null)
    return { credenciado: true, efeito: 'nenhum', credenciamentoId: null, motivo: null };
  const vale = e.credenciamentos
    .filter(
      (c) =>
        c.profissionalId === e.profissionalId &&
        c.vigenciaInicio <= e.data &&
        (c.vigenciaFim === null || c.vigenciaFim >= e.data) &&
        especificidade(c, e) > 0,
    )
    .sort(
      (a, b) =>
        especificidade(b, e) - especificidade(a, e) ||
        (b.estabelecimentoId !== null ? 1 : 0) - (a.estabelecimentoId !== null ? 1 : 0) ||
        b.id - a.id,
    )[0];
  if (vale?.credenciado)
    return { credenciado: true, efeito: 'nenhum', credenciamentoId: vale.id, motivo: null };
  if (e.planoDesconhecido && e.planoId === null) {
    const emPlano = e.credenciamentos
      .filter(
        (c) =>
          c.profissionalId === e.profissionalId &&
          c.planoId !== null &&
          c.credenciado &&
          c.vigenciaInicio <= e.data &&
          (c.vigenciaFim === null || c.vigenciaFim >= e.data),
      )
      .sort((a, b) => b.id - a.id)[0];
    if (emPlano)
      return {
        credenciado: false,
        efeito: 'alerta',
        credenciamentoId: emPlano.id,
        motivo:
          'O profissional é credenciado só em plano do convênio e o plano do paciente não foi informado; confira o plano no atendimento. O atendimento segue com alerta.',
      };
  }
  const bloqueia = e.opcoes?.bloqueiaSemCredenciamento ?? false;
  const base = vale
    ? 'O profissional está descredenciado neste convênio ou plano'
    : 'O profissional não tem credenciamento vigente neste convênio ou plano';
  return {
    credenciado: false,
    efeito: bloqueia ? 'bloqueio' : 'alerta',
    credenciamentoId: vale?.id ?? null,
    motivo: bloqueia
      ? `${base}; o convênio bloqueia o atendimento.`
      : `${base}; o atendimento segue com alerta.`,
  };
}

/** Decisão 26: ao criar o convênio, credenciar todos os profissionais ativos quando a opção estiver ligada. */
export function deveCredenciarTodosAoCriar(
  o: OpcoesCredenciamentoConvenio | null,
  particular: boolean,
): boolean {
  return !particular && (o?.credenciaTodosAoCriar ?? false);
}

/**
 * Decisão 26 (quem entra no credenciamento em massa): só quem atende pelo convênio, ou seja, o profissional do corpo
 * clínico, o plantonista, o residente, o externo e o terceiro. O pessoal administrativo e o assistencial (enfermagem e
 * apoio) nunca são credenciados em convênio, porque isso criaria vínculo falso e calaria o alerta da decisão 25.
 */
export const TIPOS_PROFISSIONAL_CREDENCIAVEIS: readonly string[] = [
  'corpo_clinico',
  'plantonista',
  'residente',
  'externo',
  'terceiro',
];

/** O profissional deste tipo pode ser credenciado em convênio (decisão 26)? */
export function profissionalCredenciavel(tipo: string): boolean {
  return TIPOS_PROFISSIONAL_CREDENCIAVEIS.includes(tipo);
}
