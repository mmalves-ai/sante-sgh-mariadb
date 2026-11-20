// W0-04 (M1, mercado: dispositivos invasivos do paciente): as regras puras do bundle por turno e do alerta de
// permanência longa, sobre o MESMO registro de dispositivos da CCIH.
//   - Turno do instante local: manhã 07–13 h, tarde 13–19 h, noite 19–07 h (a noite que passa da meia-noite é do dia
//     em que começou).
//   - Conformidade do turno: todos os itens do bundle do tipo marcados.
//   - Alerta de permanência: o dispositivo ativo (não retirado, não cancelado) acima do limite do tipo (sonda vesical:
//     48 h) sem a indicação revisada (item "indicacao" marcado) nas últimas 24 horas.
import {
  type AlertaPermanencia,
  ITENS_BUNDLE,
  LIMITE_PERMANENCIA_HORAS,
  type TipoDispositivoInvasivo,
  type TurnoBundle,
} from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';
import { somarDias } from './tempo.js';

const HORA = 3_600_000;

/** O turno e o dia do turno de um instante local (`AAAA-MM-DDTHH:MM`). */
export function turnoDe(instante: string): { data: string; turno: TurnoBundle } {
  const h = Number(instante.slice(11, 13));
  const dia = instante.slice(0, 10);
  if (h >= 7 && h < 13) return { data: dia, turno: 'manha' };
  if (h >= 13 && h < 19) return { data: dia, turno: 'tarde' };
  return { data: h < 7 ? somarDias(dia, -1) : dia, turno: 'noite' };
}

/** Os códigos dos itens do bundle do tipo (vazio: o tipo não tem bundle, como o dreno). */
export const itensDoBundle = (tipo: string): string[] =>
  (ITENS_BUNDLE[tipo as TipoDispositivoInvasivo] ?? []).map((i) => i.codigo);

export type RecusaBundle =
  'bundle-sem-itens' | 'item-de-outro-tipo' | 'bundle-no-futuro' | 'dispositivo-inativo';

export const MENSAGENS_BUNDLE: Readonly<Record<RecusaBundle, string>> = {
  'bundle-sem-itens': 'Este tipo de dispositivo não tem bundle de manutenção.',
  'item-de-outro-tipo': 'O checklist tem item que não é do bundle deste dispositivo.',
  'bundle-no-futuro': 'O turno do checklist ainda não começou.',
  'dispositivo-inativo': 'O dispositivo já foi retirado ou cancelado: o bundle não se registra mais.',
};

/** Confere o checklist e devolve a conformidade (todos os itens marcados) e se a indicação foi revisada. */
export function conferirBundle(e: {
  readonly tipo: string;
  readonly ativo: boolean;
  readonly itens: Readonly<Record<string, boolean>>;
  readonly data: string;
  readonly turno: TurnoBundle;
  readonly agora: string;
}): { recusa: RecusaBundle } | { conforme: boolean; indicacaoRevisada: boolean } {
  const doTipo = itensDoBundle(e.tipo);
  if (!doTipo.length) return { recusa: 'bundle-sem-itens' };
  if (!e.ativo) return { recusa: 'dispositivo-inativo' };
  if (Object.keys(e.itens).some((k) => !doTipo.includes(k))) return { recusa: 'item-de-outro-tipo' };
  const atual = turnoDe(e.agora);
  const ordem = (x: { data: string; turno: TurnoBundle }) =>
    `${x.data}|${['manha', 'tarde', 'noite'].indexOf(x.turno)}`;
  if (ordem({ data: e.data, turno: e.turno }) > ordem(atual)) return { recusa: 'bundle-no-futuro' };
  return {
    conforme: doTipo.every((k) => e.itens[k] === true),
    indicacaoRevisada: e.itens['indicacao'] === true,
  };
}

/**
 * O alerta de permanência longa: ativo acima do limite do tipo sem a indicação revisada nas últimas 24 h (o instante
 * do registro do bundle). Sem limite para o tipo, ou retirado, ou cancelado: sem alerta.
 */
export function alertaPermanencia(
  d: {
    readonly tipo: string;
    readonly inseridoEm: string;
    readonly retiradoEm: string | null;
    readonly canceladoEm?: string | null;
  },
  indicacoes: readonly string[],
  agora: string,
): AlertaPermanencia | null {
  const limite = LIMITE_PERMANENCIA_HORAS[d.tipo as TipoDispositivoInvasivo];
  if (!limite || d.retiradoEm !== null || d.canceladoEm) return null;
  const a = msLocal(agora);
  const horas = Math.floor((a - msLocal(d.inseridoEm)) / HORA);
  if (horas <= limite) return null;
  const ultima = [...indicacoes].sort().at(-1) ?? null;
  if (ultima !== null && a - msLocal(ultima) <= 24 * HORA) return null;
  return { horas, limiteHoras: limite, ultimaIndicacao: ultima };
}
