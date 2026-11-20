// Painel do dia, fechamento e próximo livre (ficha do M17: leituras "Pauta do dia e painel do dia", "Busca de
// vaga"; `agenda.registrarFalta`: "quem não fez check-in vira candidato a falta e o coordenador revisa antes de
// gravar F"). Tudo pelo relógio do banco.
import { ehVaga, estadoDaMarcacao, type LinhaGrade, type SinaisMarcacao } from './estado-horario.js';
import { faixaAntecedencia, riscoDeFalta } from './indicadores.js';
import { horarioJaPassou, paraMinutos, type Relogio } from './tempo.js';

export interface MarcacaoDoDia extends SinaisMarcacao {
  readonly id: number;
  readonly data: string;
  readonly hora: string;
  readonly dataMarcacao: string | null;
}

/**
 * Candidatos a falta no fechamento: marcação do dia, horário já passado (com a tolerância), sem chegada
 * (sem senha, não atendida) e ainda marcada ou confirmada. Nada é gravado aqui: o coordenador revisa.
 */
export function candidatosAFalta(
  marcacoes: readonly MarcacaoDoDia[],
  relogio: Relogio,
  toleranciaMin = 30,
): MarcacaoDoDia[] {
  const limite = paraMinutos(relogio.hhmm) - toleranciaMin;
  return marcacoes.filter((m) => {
    const e = estadoDaMarcacao(m);
    if (e !== 'marcada' && e !== 'confirmada') return false;
    if (m.data < relogio.hoje) return true;
    if (m.data > relogio.hoje) return false;
    return paraMinutos(m.hora) <= limite;
  });
}

/** Resumo do painel: por estado da marcação, com o risco de falta pela antecedência. */
export function resumoDoDia(marcacoes: readonly MarcacaoDoDia[]): {
  total: number;
  porEstado: Readonly<Record<string, number>>;
  riscoAlto: number;
} {
  const porEstado: Record<string, number> = {};
  let riscoAlto = 0;
  for (const m of marcacoes) {
    const e = estadoDaMarcacao(m);
    porEstado[e] = (porEstado[e] ?? 0) + 1;
    if (
      (e === 'marcada' || e === 'confirmada') &&
      riscoDeFalta(faixaAntecedencia(m.dataMarcacao, m.data)).nivel === 'alto'
    )
      riscoAlto++;
  }
  return { total: marcacoes.length, porEstado, riscoAlto };
}

/** Próxima vaga que ainda não começou, numa lista de horários de agendas (ordenada por data e hora). */
export function proximaVaga<T extends LinhaGrade>(horarios: readonly T[], relogio: Relogio): T | null {
  let melhor: T | null = null;
  for (const h of horarios) {
    if (!ehVaga(h) || horarioJaPassou(h, relogio)) continue;
    if (!melhor || h.data < melhor.data || (h.data === melhor.data && h.hora < melhor.hora)) melhor = h;
  }
  return melhor;
}

export type Turno = 'manha' | 'tarde' | 'noite';

/** Turno do horário: manhã até 11:59, tarde até 17:59, noite depois. */
export function turnoDaHora(hhmm: string): Turno {
  const m = paraMinutos(hhmm);
  return m < 12 * 60 ? 'manha' : m < 18 * 60 ? 'tarde' : 'noite';
}
