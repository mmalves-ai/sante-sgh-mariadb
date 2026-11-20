// Regras puras do suporte técnico e do "login como" (ADR 0021). O controle é só QUEM entra e ONDE: a
// PLATAFORMA (o dono) entra em todos os estabelecimentos configurados (ARQ-2 reescrita, R2); o SUPORTE, só nos
// atribuídos e enquanto a função estiver ativa. Dentro do "como" não há bloqueio de uso (vale o que o alvo
// pode); o resto é auditoria e correção. Prazo absoluto da sessão "como" (R5), nunca renovado.

export type PapelConta = 'PLATAFORMA' | 'SUPORTE';

export interface ContaRegra {
  readonly papel: PapelConta;
  readonly ativo: boolean;
  readonly atribuicoes: readonly { readonly rede: string; readonly hospital: string }[];
}

/** Tipo do ator real na sessão "como". */
export function tipoDoAtor(papel: PapelConta): 'plataforma' | 'suporte' {
  return papel === 'PLATAFORMA' ? 'plataforma' : 'suporte';
}

/** Tela "Suporte técnico" (designação e auditoria completa): só a plataforma ativa. */
export function podeDesignar(c: ContaRegra): boolean {
  return c.ativo && c.papel === 'PLATAFORMA';
}

/** Ícone do "login como": plataforma ativa, ou suporte ativo com ao menos um estabelecimento. */
export function podeEntrarComo(c: ContaRegra): boolean {
  if (!c.ativo) return false;
  return c.papel === 'PLATAFORMA' || c.atribuicoes.length > 0;
}

/**
 * ADR 0022: "Eu mesmo, com acesso total" (todas as permissões do catálogo, sem segregação), só a PLATAFORMA
 * ativa, em qualquer estabelecimento configurado. O suporte técnico NUNCA tem acesso total: continua só com o
 * "como" nos estabelecimentos atribuídos.
 */
export function podeAcessoTotal(c: ContaRegra): boolean {
  return c.ativo && c.papel === 'PLATAFORMA';
}

/**
 * A conta pode entrar (ou corrigir) neste estabelecimento? Só os configurados nesta rede; a plataforma, em
 * todos eles; o suporte, só nos atribuídos.
 */
export function podeEntrarNoEstabelecimento(
  c: ContaRegra,
  rede: string,
  hospital: string,
  configurados: readonly string[],
): boolean {
  if (!c.ativo || !configurados.includes(hospital)) return false;
  if (c.papel === 'PLATAFORMA') return true;
  return c.atribuicoes.some((a) => a.rede === rede && a.hospital === hospital);
}

/** Estabelecimentos onde a conta entra, na ordem da configuração. */
export function estabelecimentosDaConta(
  c: ContaRegra,
  rede: string,
  configurados: readonly string[],
): string[] {
  return configurados.filter((h) => podeEntrarNoEstabelecimento(c, rede, h, configurados));
}

export const SUPORTE_SESSAO_MINUTOS_PADRAO = 60;
/** Teto do prazo configurável (SUPORTE_SESSAO_MINUTOS): um turno. */
export const SUPORTE_SESSAO_MINUTOS_TETO = 480;

/** Prazo da sessão "como" em minutos (R5: padrão 60; inválido vale o padrão; acima do teto, o teto). */
export function minutosSessaoComo(valor: string | undefined): number {
  const n = Number((valor ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) return SUPORTE_SESSAO_MINUTOS_PADRAO;
  return Math.min(n, SUPORTE_SESSAO_MINUTOS_TETO);
}

/** Fim absoluto: renovar é abrir nova sessão (nunca estende). */
export function fimAbsolutoComo(inicioMs: number, minutos: number): number {
  return inicioMs + minutos * 60_000;
}

/** Segundo fator (TOTP) das contas da plataforma: obrigatório fora de dev e ci. */
export function segundoFatorObrigatorio(ambiente: string): boolean {
  return ambiente !== 'dev' && ambiente !== 'ci';
}

export interface EstadoSessaoComo {
  /** A linha da SGH_SUP_SESSAO: null quando não existe (ou não pôde ser lida: o chamador falha fechado). */
  readonly sessao: {
    readonly idConta: string;
    readonly atorTipo: 'plataforma' | 'suporte';
    readonly rede: string;
    readonly hospital: string;
    readonly expiraMs: number;
    readonly encerrada: boolean;
    /** ADR 0022: ausente = `como`. */
    readonly modo?: 'como' | 'acesso-total';
  } | null;
  readonly conta: (ContaRegra & { readonly id: string }) | null;
  readonly configurados: readonly string[];
  readonly agoraMs: number;
}

export type VereditoComo =
  | { readonly valida: true }
  | {
      readonly valida: false;
      readonly motivo: 'inexistente' | 'encerrada' | 'expirada' | 'conta' | 'funcao' | 'atribuicao';
    };

/**
 * Guarda por requisição (R5, regra 3): a sessão "como" vale só se a linha existe e está aberta, dentro do
 * prazo absoluto, a conta é a mesma e está ativa com a função do ator, e (suporte) o estabelecimento continua
 * atribuído. Qualquer outra coisa encerra a sessão.
 */
export function conferirSessaoComo(e: EstadoSessaoComo): VereditoComo {
  const s = e.sessao;
  if (!s) return { valida: false, motivo: 'inexistente' };
  if (s.encerrada) return { valida: false, motivo: 'encerrada' };
  if (e.agoraMs >= s.expiraMs) return { valida: false, motivo: 'expirada' };
  const c = e.conta;
  if (!c || c.id !== s.idConta || !c.ativo) return { valida: false, motivo: 'conta' };
  if (tipoDoAtor(c.papel) !== s.atorTipo) return { valida: false, motivo: 'funcao' };
  // Acesso total: só enquanto a conta continuar PLATAFORMA ativa (o suporte nunca o mantém).
  if (s.modo === 'acesso-total' && !podeAcessoTotal(c)) return { valida: false, motivo: 'funcao' };
  if (!podeEntrarNoEstabelecimento(c, s.rede, s.hospital, e.configurados))
    return { valida: false, motivo: 'atribuicao' };
  return { valida: true };
}
