// Regra 3 do M55 (cap-07 §7.2): disponibilidade, MTBF e MTTR com as parcelas impressas (horas paradas, número de
// falhas, tempo de reparo). Conta por equipamento e somada no recorte:
//   horas do período  = do início do período (ou da instalação) ao fim do período (ou à desativação, ou ao "agora");
//   horas paradas     = união das paradas recortadas ao período (paradas sobrepostas do mesmo equipamento contam uma vez);
//   horas de operação = horas do período − horas paradas;
//   disponibilidade   = horas de operação ÷ horas do período × 100;
//   MTBF              = horas de operação ÷ falhas (corretivas abertas no período, sem as "sem defeito constatado");
//   MTTR              = horas de reparo ÷ reparos (corretivas concluídas no período, do início ao fim do reparo).
// Sem falha, MTBF é nulo ("sem falha no período"); sem reparo, MTTR é nulo. Tudo em horas com 2 casas.
import { CAUSAS_SEM_FALHA, type CausaFalha } from '@sgh/contratos';
import { arred2, horas2, minutoDe, somarDias } from './tempo.js';

export interface EquipamentoNoPeriodo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  /** Data de instalação (conta a partir dela, se cair no período). */
  readonly instalacao: string | null;
  /** Data da desativação (conta até ela, se cair no período). */
  readonly desativacao: string | null;
}

export interface Parada {
  readonly equipamento: number;
  readonly inicio: string;
  /** Nulo: ainda parado. */
  readonly fim: string | null;
}

export interface FalhaOuReparo {
  readonly equipamento: number;
  /** Registro da OS corretiva (conta a falha se cair no período). */
  readonly registro: string;
  /** Causa da conclusão; nula enquanto não concluída (a falha conta). */
  readonly causa: CausaFalha | null;
  readonly inicioReparo: string | null;
  /** Fim do reparo (conta o reparo se cair no período). */
  readonly fimReparo: string | null;
}

export interface PedidoIndicadores {
  /** Datas civis, fim inclusive. */
  readonly inicio: string;
  readonly fim: string;
  /** O período não passa do "agora" (o resto ainda não aconteceu). */
  readonly agora: string;
  readonly equipamentos: readonly EquipamentoNoPeriodo[];
  readonly paradas: readonly Parada[];
  readonly corretivas: readonly FalhaOuReparo[];
}

export interface ParcelasIndicadores {
  readonly horasPeriodo: number;
  readonly horasParadas: number;
  readonly horasOperacao: number;
  readonly falhas: number;
  readonly reparos: number;
  readonly horasReparo: number;
}

export interface Indicadores {
  readonly parcelas: ParcelasIndicadores;
  readonly disponibilidade: number | null;
  readonly mtbf: number | null;
  readonly mttr: number | null;
}

export interface IndicadoresCalculados extends Indicadores {
  readonly equipamentos: number;
  readonly porEquipamento: readonly (Indicadores & { readonly equipamento: EquipamentoNoPeriodo })[];
}

interface Minutos {
  periodo: number;
  parados: number;
  falhas: number;
  reparos: number;
  reparo: number;
}

/** União de intervalos [a, b) já recortados; devolve o total em minutos. */
export function minutosDaUniao(intervalos: readonly (readonly [number, number])[]): number {
  const ordenados = intervalos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let ini = Number.NaN;
  let fim = Number.NaN;
  for (const [a, b] of ordenados) {
    if (Number.isNaN(ini) || a > fim) {
      if (!Number.isNaN(ini)) total += fim - ini;
      ini = a;
      fim = b;
    } else fim = Math.max(fim, b);
  }
  if (!Number.isNaN(ini)) total += fim - ini;
  return total;
}

function indicadoresDe(m: Minutos): Indicadores {
  const operacao = m.periodo - m.parados;
  return {
    parcelas: {
      horasPeriodo: horas2(m.periodo),
      horasParadas: horas2(m.parados),
      horasOperacao: horas2(operacao),
      falhas: m.falhas,
      reparos: m.reparos,
      horasReparo: horas2(m.reparo),
    },
    disponibilidade: m.periodo > 0 ? arred2((operacao / m.periodo) * 100) : null,
    mtbf: m.falhas > 0 ? horas2(operacao / m.falhas) : null,
    mttr: m.reparos > 0 ? horas2(m.reparo / m.reparos) : null,
  };
}

export function calcularIndicadores(p: PedidoIndicadores): IndicadoresCalculados {
  const agora = minutoDe(p.agora);
  const ini = minutoDe(p.inicio);
  const fim = Math.min(minutoDe(somarDias(p.fim, 1)), agora);
  if (fim < ini) throw new Error('Período inválido.');
  const dentro = (instante: string | null): boolean => {
    if (instante === null) return false;
    const t = minutoDe(instante);
    return t >= ini && t < fim;
  };
  const total: Minutos = { periodo: 0, parados: 0, falhas: 0, reparos: 0, reparo: 0 };
  const porEquipamento = p.equipamentos.map((e) => {
    const a = Math.max(ini, e.instalacao ? minutoDe(e.instalacao) : ini);
    const b = Math.min(fim, e.desativacao ? minutoDe(e.desativacao) : fim);
    const periodo = Math.max(0, b - a);
    const parados = minutosDaUniao(
      p.paradas
        .filter((x) => x.equipamento === e.id)
        .map((x): [number, number] => [
          Math.max(a, minutoDe(x.inicio)),
          Math.min(b, x.fim ? minutoDe(x.fim) : agora),
        ]),
    );
    const doEquipamento = p.corretivas.filter((c) => c.equipamento === e.id);
    const falhas = doEquipamento.filter(
      (c) => dentro(c.registro) && (c.causa === null || !CAUSAS_SEM_FALHA.includes(c.causa)),
    ).length;
    const reparados = doEquipamento.filter((c) => c.inicioReparo !== null && dentro(c.fimReparo));
    const reparo = reparados.reduce(
      (s, c) => s + Math.max(0, minutoDe(c.fimReparo as string) - minutoDe(c.inicioReparo as string)),
      0,
    );
    const m: Minutos = { periodo, parados, falhas, reparos: reparados.length, reparo };
    total.periodo += m.periodo;
    total.parados += m.parados;
    total.falhas += m.falhas;
    total.reparos += m.reparos;
    total.reparo += m.reparo;
    return { equipamento: e, ...indicadoresDe(m) };
  });
  return { equipamentos: p.equipamentos.length, ...indicadoresDe(total), porEquipamento };
}
