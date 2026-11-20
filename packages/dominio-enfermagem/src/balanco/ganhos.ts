// O que entra no balanço sem redigitar (M45, etapa 3; regra 6): o ganho do horário checado "Administrado" (soluções,
// medicamentos e dietas com a dose em mL, pela via) e a diurese registrada nos sinais vitais. Cada horário entra uma
// vez só, mesmo que a checagem tenha sido reenviada sem rede (os atos repetidos do mesmo horário são um ganho só), e
// cada sinal vital vigente uma vez só. O volume vem, nesta ordem: do volume infundido registrado nos eventos da
// infusão; da quantidade administrada da checagem, quando a dose é em mL; da dose prescrita em mL. Sem volume em mL, o
// horário aparece na lista "sem volume", com o motivo (a enfermagem lança à mão, se for o caso).
import {
  GRUPO_GANHO,
  type PendenteBalanco,
  type SemVolumeBalanco,
  TIPO_ELIMINACAO_DIURESE,
} from '@sgh/contratos';
import { dentroDaJanela } from './janela.js';

/** Um horário da prescrição já checado, com o que o balanço precisa (lido da checagem e do registro do novo). */
export interface ChecagemParaBalanco {
  readonly horario: number;
  readonly tipo: string;
  readonly situacao: string;
  readonly descricao: string;
  readonly dose: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  /** A hora da checagem gravada no horário (a do banco). */
  readonly checadoEm: string | null;
  /** A hora real do ato (a do aparelho sem rede), do registro do novo; a primeira, se houver repetidos. */
  readonly horaReal: string | null;
  /** A quantidade administrada registrada na checagem (na unidade da dose). */
  readonly quantidade: number | null;
  /** O volume infundido registrado nos eventos da infusão (fim ou troca de bolsa). */
  readonly volumeInfundidoMl: number | null;
}

/** Um sinal vital de diurese vigente (não retificado). */
export interface DiureseDoSinal {
  readonly id: number;
  readonly valor: number;
  readonly horaReal: string;
}

/** A via do cadastro → o grupo de ganho do balanço. Fora da lista, o horário não entra sozinho (lança-se à mão). */
export const GRUPO_DA_VIA: Readonly<Record<string, number>> = {
  EV: GRUPO_GANHO.endovenoso,
  VC: GRUPO_GANHO.endovenoso,
  VP: GRUPO_GANHO.endovenoso,
  VO: GRUPO_GANHO.oral,
  SL: GRUPO_GANHO.oral,
  '02': GRUPO_GANHO.enteral,
  VE: GRUPO_GANHO.enteral,
  GT: GRUPO_GANHO.enteral,
};

const emMl = (u: string | null) => (u ?? '').trim().toUpperCase() === 'ML';
const decimo = (v: number) => Math.round(v * 10) / 10;

export type GanhoOuMotivo =
  | { readonly ok: true; readonly grupo: number; readonly via: string | null; readonly volumeMl: number }
  | { readonly ok: false; readonly motivo: string };

/** O ganho de um horário checado (ou o motivo de não entrar sozinho). */
export function ganhoDoHorario(c: ChecagemParaBalanco): GanhoOuMotivo {
  if (c.situacao !== 'A') return { ok: false, motivo: 'O horário não foi administrado.' };
  const via = c.via?.trim().toUpperCase() || null;
  let grupo = via ? GRUPO_DA_VIA[via] : undefined;
  // A dieta sem via na prescrição é enteral (a oral vem com a via VO).
  if (grupo === undefined && c.tipo === 'dieta' && !via) grupo = GRUPO_GANHO.enteral;
  if (grupo === undefined)
    return {
      ok: false,
      motivo: via
        ? `A via ${via} não entra sozinha no balanço: lance à mão, se for o caso.`
        : 'O item não tem via: lance à mão, se for o caso.',
    };
  let volume: number | null = null;
  if (c.volumeInfundidoMl !== null && c.volumeInfundidoMl > 0) volume = c.volumeInfundidoMl;
  else if (emMl(c.unidadeDose) && c.quantidade !== null && c.quantidade > 0) volume = c.quantidade;
  else if (emMl(c.unidadeDose) && c.dose !== null && c.dose > 0) volume = c.dose;
  if (volume === null)
    return {
      ok: false,
      motivo: `A dose não está em mL (${c.unidadeDose ?? 'sem unidade'}): lance o volume à mão, se for o caso.`,
    };
  return { ok: true, grupo, via, volumeMl: decimo(volume) };
}

/**
 * Os ganhos dos horários checados no intervalo que ainda não entraram no balanço. O mesmo horário repetido (a
 * checagem reenviada sem rede) conta uma vez só; o horário já lançado não volta.
 */
export function ganhosDaChecagem(
  checagens: readonly ChecagemParaBalanco[],
  jaLancados: ReadonlySet<number>,
  intervalo: { readonly inicio: string; readonly fim: string },
): { pendentes: PendenteBalanco[]; semVolume: SemVolumeBalanco[] } {
  const vistos = new Set<number>();
  const pendentes: PendenteBalanco[] = [];
  const semVolume: SemVolumeBalanco[] = [];
  for (const c of checagens) {
    if (vistos.has(c.horario)) continue;
    vistos.add(c.horario);
    if (c.situacao !== 'A' || jaLancados.has(c.horario)) continue;
    const quando = (c.horaReal ?? c.checadoEm ?? '').slice(0, 16);
    if (!quando || !dentroDaJanela(quando, intervalo)) continue;
    const g = ganhoDoHorario(c);
    if (!g.ok) {
      semVolume.push({ horario: c.horario, horaReal: quando, descricao: c.descricao, motivo: g.motivo });
      continue;
    }
    pendentes.push({
      origem: 'checagem',
      referencia: c.horario,
      sentido: 'ganho',
      grupo: g.grupo,
      via: g.via,
      tipoEliminacao: null,
      volumeMl: g.volumeMl,
      horaReal: quando,
      descricao: c.descricao,
    });
  }
  pendentes.sort((a, b) => a.horaReal.localeCompare(b.horaReal) || a.referencia - b.referencia);
  return { pendentes, semVolume };
}

/** A diurese registrada nos sinais vitais no intervalo que ainda não entrou no balanço (uma vez só por sinal). */
export function diureseDosSinais(
  sinais: readonly DiureseDoSinal[],
  jaLancados: ReadonlySet<number>,
  intervalo: { readonly inicio: string; readonly fim: string },
): PendenteBalanco[] {
  const vistos = new Set<number>();
  const r: PendenteBalanco[] = [];
  for (const s of sinais) {
    if (vistos.has(s.id) || jaLancados.has(s.id)) continue;
    vistos.add(s.id);
    if (!dentroDaJanela(s.horaReal, intervalo) || !(s.valor >= 0)) continue;
    r.push({
      origem: 'sinal',
      referencia: s.id,
      sentido: 'perda',
      grupo: null,
      via: null,
      tipoEliminacao: TIPO_ELIMINACAO_DIURESE,
      volumeMl: decimo(s.valor),
      horaReal: s.horaReal.slice(0, 16),
      descricao: 'Diurese registrada nos sinais vitais',
    });
  }
  return r.sort((a, b) => a.horaReal.localeCompare(b.horaReal) || a.referencia - b.referencia);
}
