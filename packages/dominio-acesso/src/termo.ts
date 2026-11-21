// Termo de uso (cap-08 §8.8; ficha do M05, regra 12): sem aceite da versão vigente (aceite do termo), a sessão
// sai com termoPendente e as rotas do PEP ficam fechadas. Quem aceitou no sistema de origem não aceita de novo. Com
// aceite periódico ligado (na configuração de login), o aceite vence após o período.

export interface SituacaoTermo {
  /** Há termo vigente (cadastro do termo ativo). */
  readonly vigente: boolean;
  /** Data do último aceite do usuário para o termo vigente (null: nunca aceitou). */
  readonly aceitoEm: Date | null;
  readonly periodico: boolean;
  readonly quantidadePeriodo: number | null;
  /** TIPO_PERIODO_TERMO_ACEITE: D dias, M meses, A anos. */
  readonly tipoPeriodo: string | null;
}

export function venceAceite(aceitoEm: Date, quantidade: number, tipo: string): Date {
  const d = new Date(aceitoEm.getTime());
  if (tipo === 'D') d.setUTCDate(d.getUTCDate() + quantidade);
  else if (tipo === 'A') d.setUTCFullYear(d.getUTCFullYear() + quantidade);
  else d.setUTCMonth(d.getUTCMonth() + quantidade);
  return d;
}

export function termoPendente(s: SituacaoTermo, agora: Date): boolean {
  if (!s.vigente) return false;
  if (s.aceitoEm === null) return true;
  if (s.periodico && s.quantidadePeriodo && s.quantidadePeriodo > 0) {
    return agora.getTime() >= venceAceite(s.aceitoEm, s.quantidadePeriodo, s.tipoPeriodo ?? 'M').getTime();
  }
  return false;
}
