// Horários previstos de cada item (regra 11 da ficha do M24; cap-11 §11.2, "Frequência e aprazamento"): uma linha de
// checagem por dose prevista no período, na situação "P" (prescrito). Medido na cópia (internados, 2026-06): os
// intervalos seguem a grade da regra do horário de medicação por número de doses (8/8: 22:00, 06:00 e 14:00 em 1.904
// de 2.050; 12/12: 22:00 e 10:00; 6/6: 18:00, 00:00, 06:00 e 12:00; 24/24: 22:00); a frequência relativa usa o
// horário de cada âncora de refeição escolhida; ACM, contínua, livre demanda, outras e sem frequência têm uma linha
// no início do período (16:01) ou, no período já começado, no minuto da prescrição; "iniciar agora" acrescenta a
// primeira dose imediata; um primeiro horário escolhido desloca a grade pelo intervalo. Só horários dentro do período
// e não anteriores ao momento da prescrição; vencida não gera horários.
import type { Frequencia } from '@sgh/contratos';
import { DIA, inicioDoDia, localDe, minutoDoDia, minLocal } from './tempo.js';
import type { Periodo } from './vigencia.js';

export interface PedidoHorarios {
  readonly frequencia: Frequencia;
  readonly vigencia: Periodo;
  /** Momento da prescrição (relógio do banco, hora local). */
  readonly agora: string;
  /** Grade da unidade por número de doses (HHMM, na ordem do cadastro). */
  readonly grade: ReadonlyMap<number, readonly string[]>;
  readonly iniciarAgora?: boolean;
  /** Primeiro horário escolhido (HH:MM): desloca a grade pelo intervalo. */
  readonly primeiroHorario?: string | null;
  /** Horários das âncoras relativas escolhidas (id, HHMM). */
  readonly relativos?: readonly { readonly id: number; readonly horario: string }[];
}

export interface HorarioPrevisto {
  readonly dataHora: string;
  /** Âncora relativa (frequência relativa). */
  readonly relativo: number | null;
  readonly agora: boolean;
}

/** Os minutos (no período) em que cai a hora do dia `mdd`: uma ocorrência (o período tem 24 h). */
function noPeriodo(mdd: number, ini: number, fim: number): number | null {
  let t = inicioDoDia(ini) + mdd;
  if (t < ini) t += DIA;
  return t <= fim ? t : null;
}

export function horariosPrevistos(p: PedidoHorarios): HorarioPrevisto[] {
  const ini = minLocal(p.vigencia.inicio);
  const fim = minLocal(p.vigencia.fim);
  const agora = minLocal(p.agora);
  if (agora > fim) return []; // vencida: nenhum horário novo
  const desde = Math.max(ini, agora);
  const r: HorarioPrevisto[] = [];
  const add = (t: number, relativo: number | null, imediata = false) => {
    if (t < desde || t > fim) return;
    if (r.some((x) => x.dataHora === localDe(t))) return;
    r.push({ dataHora: localDe(t), relativo, agora: imediata });
  };
  if (p.iniciarAgora) add(desde, null, true);
  const f = p.frequencia;
  if (f.natureza === 'relativa') {
    for (const a of p.relativos ?? []) {
      const t = noPeriodo(minutoDoDia(a.horario), ini, fim);
      if (t !== null) add(t, a.id);
    }
  } else if (f.natureza === 'intervalo' || f.natureza === 'unica') {
    const doses = f.doses ?? 1;
    if (p.primeiroHorario) {
      const t0 = noPeriodo(minutoDoDia(p.primeiroHorario), ini, fim);
      const passo = (f.intervaloHoras ?? 24) * 60;
      if (t0 !== null) for (let k = 0; k < doses; k++) add(t0 + k * passo, null);
    } else if (!(f.natureza === 'unica' && p.iniciarAgora)) {
      const horas = p.grade.get(doses) ?? [];
      // A grade do cadastro repete a hora em algumas linhas (dose única com a mesma hora duas vezes): uma só.
      for (const h of [...new Set(horas)]) {
        const t = noPeriodo(minutoDoDia(h), ini, fim);
        if (t !== null) add(t, null);
      }
      if (horas.length === 0) add(desde, null);
    }
  } else if (!p.iniciarAgora) {
    // ACM, contínua, livre demanda, outras e sem frequência: uma linha no início do que resta do período.
    add(desde, null);
  }
  return r.sort((a, b) => a.dataHora.localeCompare(b.dataHora));
}
