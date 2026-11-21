// Regra única da validade vigente da inscrição no conselho (M52.1; lote F2.2 05-16). Pura, sem I/O: o worker (retrato
// diário) aplica sobre as linhas lidas; a API (folha, tela) deve aplicar a mesma (pedido no saida/05-16.json de mover
// este arquivo para @sgh/dominio-pessoas, já que este lote não edita o pacote de domínio nem a API).
// Critério:
//   1. A conferência vigente é o último evento da inscrição por (ocorrido em, id): uma conferência lançada com data
//      retroativa não passa à frente de uma posterior.
//   2. Se o último evento é uma exclusão, nenhuma conferência vale: volta a validade da inscrição.
//   3. Conferência com o registro suspenso ou cancelado tira a inscrição da conta (não é ativa).
//   4. A validade é a da conferência vigente; sem data nela (ou sem conferência), a da inscrição.
// Melhoria: um só critério para o retrato do worker e a folha/tela (antes divergiam: maior id contra ocorrido em, e a
// exclusão só era descartada num dos lados).

export type OperacaoConferencia = 'inclusao' | 'alteracao' | 'exclusao';
export type SituacaoRegistroConselho = 'ativo' | 'vencido' | 'suspenso' | 'cancelado' | 'provisorio';

export interface ConferenciaConselho {
  readonly id: number;
  /** Instante ISO do fato conferido. */
  readonly ocorridoEm: string;
  readonly operacao: OperacaoConferencia;
  /** AAAA-MM-DD ou null. */
  readonly dataValidade: string | null;
  readonly situacaoRegistro: SituacaoRegistroConselho;
}

export interface InscricaoParaValidade {
  /** A inscrição está ativa no cadastro (ativa ou provisória). */
  readonly ativa: boolean;
  /** AAAA-MM-DD ou null. */
  readonly validade: string | null;
}

export interface ValidadeVigente {
  readonly ativo: boolean;
  readonly validade: string | null;
}

const SITUACOES_FORA = new Set<SituacaoRegistroConselho>(['suspenso', 'cancelado']);

/** O último evento por (ocorrido em, id); null quando não há conferência ou o último é uma exclusão. */
export function conferenciaVigente(cs: readonly ConferenciaConselho[]): ConferenciaConselho | null {
  let ultima: ConferenciaConselho | null = null;
  for (const c of cs) {
    if (
      ultima === null ||
      c.ocorridoEm > ultima.ocorridoEm ||
      (c.ocorridoEm === ultima.ocorridoEm && c.id > ultima.id)
    )
      ultima = c;
  }
  return ultima && ultima.operacao !== 'exclusao' ? ultima : null;
}

/** A validade vigente da inscrição e se ela entra na conta (regra única do worker e da API). */
export function validadeVigente(i: InscricaoParaValidade, cs: readonly ConferenciaConselho[]): ValidadeVigente {
  const c = conferenciaVigente(cs);
  return {
    ativo: i.ativa && !(c && SITUACOES_FORA.has(c.situacaoRegistro)),
    validade: c?.dataValidade ?? i.validade,
  };
}
