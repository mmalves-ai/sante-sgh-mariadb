// Linha do tempo do turno (ficha do M25, seção 7 e regras 3 e 10): os horários da unidade no turno de 12 horas, com o
// estado de cada um (a checar, atrasada em vermelho, omitida, administrada, não administrada, suspensa), o resumo por
// estado e as mudanças de situação que a vigia avisa (a suspensão feita na prescrição ou no outro sistema passa os
// horários futuros a suspensos na tela em até 2 segundos).
import { ESTADOS_HORARIO_ENFERMAGEM, type EstadoHorario, type Turno } from '@sgh/contratos';
import { deMinutos, minutos, minutosDoDia } from '../tempo.js';
import { estadoDoHorario, toleranciaDaClasse } from '../checagem/tolerancia.js';

export interface JanelaTurno {
  readonly nome: Turno;
  readonly inicio: string;
  readonly fim: string;
}

/** O turno de 12 horas em que o instante cai (o diurno começa no parâmetro da unidade; o noturno, 12 horas depois). */
export function turnoDoInstante(agora: string, inicioDiurno = '0700'): JanelaTurno {
  const t = minutos(agora);
  const dia = Math.floor(t / 1440) * 1440;
  const ini = minutosDoDia(inicioDiurno);
  const candidatos = [dia - 1440 + ini, dia - 1440 + ini + 720, dia + ini, dia + ini + 720];
  const inicio = candidatos.filter((c) => c <= t).sort((a, b) => b - a)[0] as number;
  const nome: Turno = (inicio - ini) % 1440 === 0 ? 'diurno' : 'noturno';
  return { nome, inicio: deMinutos(inicio), fim: deMinutos(inicio + 720) };
}

/** O turno pedido do dia (diurno ou noturno que começa na data). */
export function turnoDoDia(data: string, nome: Turno, inicioDiurno = '0700'): JanelaTurno {
  const ini = minutos(`${data}T00:00`) + minutosDoDia(inicioDiurno) + (nome === 'noturno' ? 720 : 0);
  return { nome, inicio: deMinutos(ini), fim: deMinutos(ini + 720) };
}

export interface HorarioCru {
  readonly id: number;
  readonly previsto: string;
  readonly situacao: string;
  readonly altaVigilancia: boolean;
  readonly antimicrobiano?: boolean;
}

/** Regra 3 na linha do tempo: o estado de cada horário com a tolerância da classe e o resumo por estado. */
export function estadosNoTurno<T extends HorarioCru>(
  horarios: readonly T[],
  c: {
    readonly agora: string;
    readonly turno: JanelaTurno;
    readonly tolerancia: number;
    readonly toleranciaTempoCritico: number;
  },
): {
  itens: (T & { estado: EstadoHorario; atrasoMinutos: number | null })[];
  resumo: Record<EstadoHorario, number>;
} {
  const resumo = Object.fromEntries(ESTADOS_HORARIO_ENFERMAGEM.map((e) => [e, 0])) as Record<
    EstadoHorario,
    number
  >;
  const itens = [...horarios]
    .sort((a, b) => a.previsto.localeCompare(b.previsto) || a.id - b.id)
    .map((h) => {
      const tol = toleranciaDaClasse({
        geral: c.tolerancia,
        tempoCritico: c.toleranciaTempoCritico,
        altaVigilancia: h.altaVigilancia,
        antimicrobiano: h.antimicrobiano ?? false,
      });
      // A omissão fecha no fim do turno em que o horário caiu (o de antes do turno atual já fechou).
      const fim = minutos(h.previsto) < minutos(c.turno.inicio) ? c.turno.inicio : c.turno.fim;
      const estado = estadoDoHorario({
        situacao: h.situacao,
        previsto: h.previsto,
        agora: c.agora,
        toleranciaMinutos: tol,
        fimDoTurno: fim,
      });
      resumo[estado] += 1;
      const atraso =
        estado === 'atrasada' || estado === 'omitida'
          ? Math.max(0, minutos(c.agora) - minutos(h.previsto))
          : null;
      return { ...h, estado, atrasoMinutos: atraso };
    });
  return { itens, resumo };
}

/** Os horários agrupados pela hora cheia (a coluna da linha do tempo). */
export function porHora<T extends { readonly previsto: string }>(horarios: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const h of horarios) {
    const k = `${h.previsto.slice(0, 13)}:00`;
    m.set(k, [...(m.get(k) ?? []), h]);
  }
  return m;
}

/** Regra 10: as mudanças de situação entre duas leituras (a vigia avisa a enfermagem). */
export function mudancasDeSituacao(
  antes: ReadonlyMap<number, string>,
  depois: ReadonlyMap<number, string>,
): { readonly horario: number; readonly de: string; readonly para: string }[] {
  const r: { horario: number; de: string; para: string }[] = [];
  for (const [id, para] of depois) {
    const de = antes.get(id);
    if (de !== undefined && de !== para) r.push({ horario: id, de, para });
  }
  return r.sort((a, b) => a.horario - b.horario);
}

/** As mudanças que são suspensão (o aviso à enfermagem é imediato). */
export function suspensoes(m: readonly { readonly para: string }[]): number {
  return m.filter((x) => x.para === 'S' || x.para === 'C').length;
}
