// Estados da prescrição e do item (regra 13 da ficha do M24; cap-05b §5.7; ref 04 §1.2): suspender a prescrição ou
// um item exige o conjunto completo (quem, quando, fuso, horário de verão e justificativa), que o gatilho do cabeçalho
// recusa pela metade; os horários ainda não checados ficam suspensos ("S"), com quem, quando e a justificativa;
// horário já checado não muda (vira pendência); nada se apaga. Medido na cópia (2026-06/07): a suspensão da
// prescrição marca "S" em 3.290 horários com o mesmo quem, quando e justificativa do cabeçalho (272 deles anteriores
// à suspensão: os ainda não checados também); a correção marca a correção no item e "S" nos horários (654; nenhum
// "C" na cópia: o valor nunca foi visto e o novo não o grava). As situações da checagem são sensíveis a maiúsculas
// ("P" prescrito × "p" parcial).

export const SITUACAO_PRESCRITO = 'P';
export const SITUACAO_SUSPENSO = 'S';

export interface ConjuntoSuspensao {
  readonly profissional: number | null;
  readonly dataHora: string | null;
  readonly fuso: number | null;
  readonly horarioVerao: string | null;
  readonly justificativa: string | null;
}

/** Conjunto completo ou vazio: o gatilho do cabeçalho recusa o meio-termo (e_prpresc1). */
export function conjuntoSuspensaoValido(c: ConjuntoSuspensao): boolean {
  const presentes = [
    c.profissional !== null,
    c.dataHora !== null && c.dataHora !== '',
    c.fuso !== null,
    c.horarioVerao !== null && c.horarioVerao !== '',
    c.justificativa !== null && c.justificativa.trim().length > 0,
  ];
  return presentes.every(Boolean) || presentes.every((x) => !x);
}

export function justificativaValida(j: string | null | undefined): boolean {
  return typeof j === 'string' && j.trim().length >= 10;
}

export interface HorarioLido {
  readonly id: number;
  readonly dataHora: string;
  readonly situacao: string;
}

/**
 * Horários que a suspensão muda: os ainda prescritos (não checados), como o legado. Os já checados ficam como estão
 * e voltam como pendência para a enfermagem; os passados ainda prescritos são marcados, e a tela os conta à parte.
 */
export function horariosASuspender(
  horarios: readonly HorarioLido[],
  agora: string,
): { suspender: HorarioLido[]; pendentes: HorarioLido[]; passados: number } {
  const suspender: HorarioLido[] = [];
  const pendentes: HorarioLido[] = [];
  let passados = 0;
  for (const h of horarios) {
    if (h.situacao === SITUACAO_PRESCRITO) {
      suspender.push(h);
      if (h.dataHora < agora.slice(0, 16)) passados++;
    } else if (h.situacao !== SITUACAO_SUSPENSO) pendentes.push(h);
  }
  return { suspender, pendentes, passados };
}

export type SituacaoItemLida = 'ativo' | 'suspenso' | 'suspenso-correcao' | 'vencido';

/** Situação do item pelos horários e pela marca de correção (o legado não tem coluna de situação no item). */
export function situacaoDoItem(
  horarios: readonly HorarioLido[],
  corrigido: boolean,
  vigenciaVencida: boolean,
): SituacaoItemLida {
  if (corrigido) return 'suspenso-correcao';
  if (horarios.length > 0 && horarios.every((h) => h.situacao === SITUACAO_SUSPENSO)) return 'suspenso';
  if (
    horarios.some((h) => h.situacao === SITUACAO_SUSPENSO) &&
    !horarios.some((h) => h.situacao === SITUACAO_PRESCRITO)
  )
    return 'suspenso';
  if (vigenciaVencida) return 'vencido';
  return 'ativo';
}

/**
 * Rótulos das situações da checagem que esta tela grava (ficha, seção 8; Anexo A §A.7). As demais (14 códigos do
 * M14, legenda da checagem do M25) aparecem pelo código, "a confirmar".
 */
export const ROTULOS_CHECAGEM: Readonly<Record<string, string>> = {
  P: 'Prescrito',
  p: 'Parcial',
  S: 'Suspenso',
};

export const rotuloChecagem = (s: string): string => ROTULOS_CHECAGEM[s] ?? `Situação ${s} (a confirmar)`;
