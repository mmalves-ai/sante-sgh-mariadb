// Lactário (M45, etapa 6; cap-06a §6.3 "Lactário e produção: ordens de produção por horário, rotulagem e controle de
// validade"; DP-32). Regras puras (a API aplica):
//   - a ordem de produção é de uma fórmula para um paciente, com o volume por porção e os horários das porções; cada
//     horário vira um instante a partir do preparo (o horário antes da hora do preparo é do dia seguinte);
//   - a validade é o preparo mais as horas do parâmetro (fórmula refrigerada; 24 h); porção depois dela é recusada;
//   - a conferência é de OUTRA pessoa (dois olhos), uma vez só; a etiqueta sai só da ordem conferida;
//   - a ordem vencida (validade <= relógio do estabelecimento) não é conferida nem etiquetada: 'ordem-vencida'.
import type { RegistrarOrdemLactarioEntrada } from '@sgh/contratos';
import { minutosEntreCivis, recusar, somarHorasCivil } from './comum.js';

export interface PorcaoLactario {
  readonly horario: string;
  /** O instante civil da porção ("AAAA-MM-DDTHH:MM"). */
  readonly em: string;
}

/** Os instantes das porções a partir do preparo, em ordem. */
export function porcoesDaOrdem(preparoEm: string, horarios: readonly string[]): PorcaoLactario[] {
  const dia = preparoEm.slice(0, 10);
  const horaPreparo = preparoEm.slice(11, 16);
  return [...horarios]
    .map((h) => ({ horario: h, em: h >= horaPreparo ? `${dia}T${h}` : somarHorasCivil(`${dia}T${h}`, 24) }))
    .sort((a, b) => a.em.localeCompare(b.em));
}

/** Confere a ordem e devolve a validade e as porções. */
export function conferirOrdemLactario(
  e: RegistrarOrdemLactarioEntrada,
  c: { readonly agora: string; readonly validadeHoras: number; readonly admissao: string },
): { validadeEm: string; porcoes: PorcaoLactario[] } {
  if (new Set(e.horarios).size !== e.horarios.length)
    recusar('horario-repetido', 'O mesmo horário de porção aparece duas vezes.');
  if (minutosEntreCivis(c.agora, e.preparoEm) > 5)
    recusar('instante-futuro', 'O preparo não pode ser no futuro.');
  if (minutosEntreCivis(c.admissao, e.preparoEm) < 0)
    recusar('antes-da-admissao', 'O preparo é anterior à admissão do paciente.');
  const validadeEm = somarHorasCivil(e.preparoEm, c.validadeHoras);
  const porcoes = porcoesDaOrdem(e.preparoEm, e.horarios);
  const fora = porcoes.filter((p) => p.em > validadeEm);
  if (fora.length > 0)
    recusar(
      'horario-apos-validade',
      `A porção das ${fora[0]?.horario} passa da validade da fórmula (${c.validadeHoras} h desde o preparo): faça outra ordem.`,
    );
  return { validadeEm, porcoes };
}

/** A ordem vencida (validade igual ou anterior ao relógio do estabelecimento) não é conferida nem etiquetada. */
export function ordemVencida(validadeEm: string, agora: string): boolean {
  return validadeEm <= agora;
}

const recusarVencida = (validadeEm: string): never =>
  recusar(
    'ordem-vencida',
    `A ordem passou da validade (${validadeEm.slice(8, 10)}/${validadeEm.slice(5, 7)} ${validadeEm.slice(11, 16)}): descarte a fórmula e faça outra ordem.`,
  );

/** A conferência: outra pessoa, uma vez só, e só da ordem dentro da validade. */
export function conferirConferencia(
  o: { readonly por: string; readonly conferidoPor: string | null; readonly validadeEm: string },
  login: string,
  agora: string,
): void {
  if (o.conferidoPor !== null) recusar('ordem-ja-conferida', 'A ordem já foi conferida.');
  if (o.por.trim().toUpperCase() === login.trim().toUpperCase())
    recusar('conferente-e-preparador', 'A conferência é feita por outra pessoa, não por quem preparou.');
  if (ordemVencida(o.validadeEm, agora)) recusarVencida(o.validadeEm);
}

/** A etiqueta: só da ordem conferida por outra pessoa e dentro da validade. */
export function conferirEtiquetaLactario(
  o: { readonly situacao: string; readonly conferidoPor: string | null; readonly validadeEm: string },
  agora: string,
): void {
  if (o.situacao !== 'conferida' || !o.conferidoPor)
    recusar('ordem-nao-conferida', 'A etiqueta sai só da ordem conferida por outra pessoa.');
  if (ordemVencida(o.validadeEm, agora)) recusarVencida(o.validadeEm);
}

/** Totais do dia por fórmula (porções e volume), as parcelas que a tela imprime. */
export function totaisDoLactario(
  ordens: readonly {
    readonly formula: string;
    readonly volumeMl: number;
    readonly horarios: readonly string[];
  }[],
): { formula: string; porcoes: number; volumeMl: number }[] {
  const m = new Map<string, { formula: string; porcoes: number; volumeMl: number }>();
  for (const o of ordens) {
    const k = o.formula.toUpperCase();
    const t = m.get(k) ?? { formula: o.formula, porcoes: 0, volumeMl: 0 };
    t.porcoes += o.horarios.length;
    t.volumeMl += o.horarios.length * o.volumeMl;
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => a.formula.localeCompare(b.formula));
}

// ── W0-05: alteração e cancelamento da ordem ─────────────────────────────────────────────────────

/**
 * A ordem é um pedido interno antes da conferência (altera-se livremente, com o log). Depois da conferência, a etiqueta
 * pode ter sido impressa: só o cancelamento com motivo (409 com a ação oferecida). A cancelada não se altera.
 */
export function exigirOrdemAlteravel(o: {
  readonly situacao: string;
  readonly canceladaEm: string | null;
}): void {
  if (o.canceladaEm !== null) recusar('ordem-cancelada', 'A ordem foi cancelada: faça outra ordem.');
  if (o.situacao === 'conferida')
    recusar(
      'ordem-ja-conferida',
      'A ordem já foi conferida e a etiqueta pode ter sido impressa: não se altera. Cancele a ordem com o motivo e faça outra.',
    );
}

/** A ordem cancelada não é conferida nem etiquetada. */
export function exigirOrdemNaoCancelada(o: { readonly canceladaEm: string | null }): void {
  if (o.canceladaEm !== null)
    recusar('ordem-cancelada', 'A ordem foi cancelada: não é conferida nem etiquetada.');
}
