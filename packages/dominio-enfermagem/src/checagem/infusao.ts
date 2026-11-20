// Infusão contínua (ficha do M25, regra 11; cap-05b §5.8):
//   11. a infusão contínua tem início, pausa, retomada, troca de bolsa, mudança de velocidade e fim, com o volume
//       infundido; mudar a velocidade só se a unidade e o item permitem (a velocidade é da solução prescrita).
import type { EventoInfusao } from '@sgh/contratos';
import { diferencaMinutos } from '../tempo.js';

export type EstadoInfusao = 'naoIniciada' | 'emCurso' | 'pausada' | 'encerrada';

export interface EventoInfusaoRegistrado {
  readonly evento: EventoInfusao;
  readonly horaReal: string;
  readonly velocidadeMlH: number | null;
  readonly volumeInfundidoMl: number | null;
}

/** O estado da infusão depois dos eventos (na ordem da hora real). */
export function estadoDaInfusao(eventos: readonly EventoInfusaoRegistrado[]): EstadoInfusao {
  let e: EstadoInfusao = 'naoIniciada';
  for (const x of [...eventos].sort((a, b) => a.horaReal.localeCompare(b.horaReal))) {
    if (x.evento === 'inicio') e = 'emCurso';
    else if (x.evento === 'pausa') e = 'pausada';
    else if (x.evento === 'retomada') e = 'emCurso';
    else if (x.evento === 'fim') e = 'encerrada';
  }
  return e;
}

const PERMITIDOS: Readonly<Record<EstadoInfusao, readonly EventoInfusao[]>> = {
  naoIniciada: ['inicio'],
  emCurso: ['pausa', 'trocaBolsa', 'velocidade', 'fim'],
  pausada: ['retomada', 'trocaBolsa', 'fim'],
  encerrada: [],
};

/** Regra 11: o evento pedido vale no estado atual? O problema, ou null. */
export function conferirEventoInfusao(c: {
  readonly anteriores: readonly EventoInfusaoRegistrado[];
  readonly evento: EventoInfusao;
  readonly velocidadeMlH: number | null;
  /** A unidade permite mudar a velocidade e o item (a solução) tem a velocidade prescrita. */
  readonly velocidadeAjustavel: boolean;
  readonly horaReal: string;
}): string | null {
  const estado = estadoDaInfusao(c.anteriores);
  if (!PERMITIDOS[estado].includes(c.evento))
    return estado === 'encerrada'
      ? 'A infusão já foi encerrada.'
      : estado === 'naoIniciada'
        ? 'Registre o início da infusão primeiro.'
        : `Evento fora de ordem: a infusão está ${estado === 'pausada' ? 'pausada' : 'em curso'}.`;
  const ultimo = [...c.anteriores].sort((a, b) => b.horaReal.localeCompare(a.horaReal))[0];
  if (ultimo && c.horaReal < ultimo.horaReal)
    return 'A hora do evento é anterior à do último evento da infusão.';
  if (c.evento === 'velocidade') {
    if (!c.velocidadeAjustavel)
      return 'A velocidade desta infusão não pode ser mudada pela enfermagem (unidade ou item sem permissão).';
    if (!c.velocidadeMlH) return 'Informe a nova velocidade (mL/h).';
  }
  if (c.evento === 'inicio' && !c.velocidadeMlH) return 'Informe a velocidade do início (mL/h).';
  return null;
}

/** Volume infundido estimado pela velocidade entre os eventos (mL), até a hora dada. */
export function volumeEstimado(eventos: readonly EventoInfusaoRegistrado[], ate: string): number {
  const ord = [...eventos].sort((a, b) => a.horaReal.localeCompare(b.horaReal));
  let volume = 0;
  let correndo = false;
  let velocidade = 0;
  let desde: string | null = null;
  for (const x of ord) {
    if (correndo && desde) volume += (velocidade * Math.max(0, diferencaMinutos(desde, x.horaReal))) / 60;
    if (x.evento === 'inicio' || x.evento === 'retomada') correndo = true;
    if (x.evento === 'pausa' || x.evento === 'fim') correndo = false;
    if (x.velocidadeMlH) velocidade = x.velocidadeMlH;
    desde = x.horaReal;
  }
  if (correndo && desde) volume += (velocidade * Math.max(0, diferencaMinutos(desde, ate))) / 60;
  return Math.round(volume * 10) / 10;
}
