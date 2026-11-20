// Regra 5 do M48 (cap-05b §5.11, Denominadores; Anvisa, indicadores nacionais de IRAS): os denominadores saem do
// censo diário do M16 (pacientes-dia) e do registro de dispositivos (dispositivos-dia), nunca de digitação paralela; a
// densidade de incidência é por 1.000 dispositivos-dia e a taxa de utilização por 100 pacientes-dia, sempre com o
// numerador e o denominador impressos.
//
// Contagem (D-CORTE-48.3, como o censo do M16, que conta quem está internado no fechamento do dia): o dispositivo conta
// no dia D se estava instalado no fim do dia (inserido antes de D+1 00:00 e não retirado antes disso). Inserido e
// retirado no mesmo dia: 0 dia, como o paciente que entra e sai no mesmo dia não é paciente-dia. Dia que ainda não
// terminou não conta (`agora`).
import type {
  DenominadorSetor,
  DispositivoInvasivoLido,
  ParcelaIndicador,
  SitioIras,
  TipoDispositivoInvasivo,
} from '@sgh/contratos';
import { CODIGOS_DISPOSITIVO_INVASIVO } from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';
import { diasDaCompetencia, diferencaDias, diaDe, somarDias } from './tempo.js';

/** O mínimo do dispositivo para a contagem. */
export type IntervaloDispositivo = Pick<
  DispositivoInvasivoLido,
  'tipo' | 'setor' | 'inseridoEm' | 'retiradoEm'
> & {
  /** W0-04: o dispositivo cancelado (lançado errado) não conta dispositivo-dia. */
  readonly canceladoEm?: string | null;
};

/** Os dispositivos que contam no denominador: o mesmo registro da CCIH e do prontuário, sem os cancelados. */
export function dispositivosDoDenominador<D extends object>(ds: readonly D[]): D[] {
  return ds.filter((d) => !(d as { readonly canceladoEm?: string | null }).canceladoEm);
}

/** Arredonda em duas casas (a tela mostra assim; as parcelas vão inteiras). */
const duasCasas = (v: number) => Math.round(v * 100) / 100;

export function parcela(numerador: number, denominador: number, fator: 1 | 100 | 1000): ParcelaIndicador {
  return {
    numerador,
    denominador,
    fator,
    valor: denominador > 0 ? duasCasas((numerador / denominador) * fator) : null,
  };
}

/** O dispositivo estava instalado no fim do dia `data`. */
function instaladoNoFimDoDia(d: IntervaloDispositivo, data: string): boolean {
  const fim = msLocal(somarDias(data, 1));
  return msLocal(d.inseridoEm) < fim && (d.retiradoEm === null || msLocal(d.retiradoEm) >= fim);
}

/** Dispositivos-dia do dispositivo na competência, sem contar o dia que ainda não terminou. */
export function diasDeDispositivoNaCompetencia(
  d: IntervaloDispositivo,
  competencia: string,
  agora: string,
): number {
  const limite = msLocal(agora);
  return diasDaCompetencia(competencia).filter(
    (dia) => msLocal(somarDias(dia, 1)) <= limite && instaladoNoFimDoDia(d, dia),
  ).length;
}

/**
 * W0-04 (M1): os dispositivos-dia da aba de dispositivos do prontuário na competência, um por dispositivo, pela MESMA
 * contagem do denominador (o mesmo registro e sem os cancelados): a soma por tipo é o `dispositivosDia` do setor.
 */
export function dispositivosDiaDaAba<D extends IntervaloDispositivo & { readonly id: number }>(
  ds: readonly D[],
  competencia: string,
  agora: string,
): { id: number; tipo: string; dias: number }[] {
  return dispositivosDoDenominador(ds).map((d) => ({
    id: d.id,
    tipo: d.tipo,
    dias: diasDeDispositivoNaCompetencia(d, competencia, agora),
  }));
}

/** Dias de uso para a tela: o dia da inserção é o dia 1 (até a retirada ou até hoje). */
export function diasDeUso(
  d: Pick<DispositivoInvasivoLido, 'inseridoEm' | 'retiradoEm'>,
  agora: string,
): number {
  return Math.max(1, diferencaDias(d.inseridoEm, d.retiradoEm ?? agora) + 1);
}

/** Sítio com densidade por dispositivo e o dispositivo do denominador. */
export const SITIO_DO_DISPOSITIVO = {
  ipcs: 'cvc',
  pav: 'ventilacaoMecanica',
  itu: 'sondaVesical',
} as const satisfies Partial<Record<SitioIras, TipoDispositivoInvasivo>>;
export type SitioComDensidade = keyof typeof SITIO_DO_DISPOSITIVO;

export interface IrasDoDenominador {
  readonly sitio: SitioIras;
  readonly setor: string;
  /** A ficha ficou associada a um dispositivo (só estas entram na densidade por dispositivo-dia). */
  readonly associada: boolean;
}

/**
 * Os denominadores e indicadores de um setor na competência: pacientes-dia do censo, dispositivos-dia do registro,
 * densidade das IRAS associadas a dispositivo e taxa de utilização.
 */
export function denominadoresDoSetor(e: {
  readonly setor: string;
  readonly competencia: string;
  readonly agora: string;
  readonly pacientesDia: number;
  readonly dispositivos: readonly IntervaloDispositivo[];
  readonly iras: readonly IrasDoDenominador[];
}): DenominadorSetor {
  const dispositivosDia = Object.fromEntries(
    CODIGOS_DISPOSITIVO_INVASIVO.map((t) => [
      t,
      dispositivosDoDenominador(e.dispositivos)
        .filter((d) => d.tipo === t)
        .reduce((s, d) => s + diasDeDispositivoNaCompetencia(d, e.competencia, e.agora), 0),
    ]),
  ) as Record<TipoDispositivoInvasivo, number>;
  const sitios = Object.keys(SITIO_DO_DISPOSITIVO) as SitioComDensidade[];
  const iras = Object.fromEntries(
    sitios.map((s) => [s, e.iras.filter((i) => i.sitio === s && i.associada).length]),
  ) as Record<SitioComDensidade, number>;
  return {
    setor: e.setor,
    pacientesDia: e.pacientesDia,
    dispositivosDia,
    iras,
    densidade: Object.fromEntries(
      sitios.map((s) => [s, parcela(iras[s], dispositivosDia[SITIO_DO_DISPOSITIVO[s]], 1000)]),
    ) as Record<SitioComDensidade, ParcelaIndicador>,
    utilizacao: Object.fromEntries(
      CODIGOS_DISPOSITIVO_INVASIVO.map((t) => [t, parcela(dispositivosDia[t], e.pacientesDia, 100)]),
    ) as Record<TipoDispositivoInvasivo, ParcelaIndicador>,
  };
}

/** O hospital inteiro: soma das parcelas dos setores (as razões recalculadas, nunca a média das razões). */
export function consolidarSetores(setores: readonly DenominadorSetor[], rotulo = 'todos'): DenominadorSetor {
  const soma = <K extends string>(
    f: (d: DenominadorSetor) => Readonly<Record<K, number>>,
    chaves: readonly K[],
  ) =>
    Object.fromEntries(chaves.map((k) => [k, setores.reduce((s, d) => s + f(d)[k], 0)])) as Record<K, number>;
  const dispositivosDia = soma((d) => d.dispositivosDia, CODIGOS_DISPOSITIVO_INVASIVO);
  const sitios = Object.keys(SITIO_DO_DISPOSITIVO) as SitioComDensidade[];
  const iras = soma((d) => d.iras, sitios);
  const pacientesDia = setores.reduce((s, d) => s + d.pacientesDia, 0);
  return {
    setor: rotulo,
    pacientesDia,
    dispositivosDia,
    iras,
    densidade: Object.fromEntries(
      sitios.map((s) => [s, parcela(iras[s], dispositivosDia[SITIO_DO_DISPOSITIVO[s]], 1000)]),
    ) as Record<SitioComDensidade, ParcelaIndicador>,
    utilizacao: Object.fromEntries(
      CODIGOS_DISPOSITIVO_INVASIVO.map((t) => [t, parcela(dispositivosDia[t], pacientesDia, 100)]),
    ) as Record<TipoDispositivoInvasivo, ParcelaIndicador>,
  };
}

/** Pacientes-dia por setor a partir das linhas do censo diário (soma dos internados no fechamento de cada dia). */
export function pacientesDiaPorSetor(
  linhas: readonly { readonly setor: string; readonly data: string; readonly internados: number }[],
  competencia: string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of linhas)
    if (diaDe(l.data).startsWith(competencia)) m.set(l.setor, (m.get(l.setor) ?? 0) + l.internados);
  return m;
}

/**
 * O fim efetivo do dispositivo para o denominador (D-ALTA-DISP-48.3): a alta é feita também no outro sistema, e o
 * dispositivo sem retirada registrada de internação já encerrada pararia de contar só quando a CCIH registrasse a
 * retirada. A alta (data civil) vira o fim: o dia da alta não conta, como no censo do M16 (o paciente não está
 * internado no fechamento dele). Vale o que vier primeiro, a retirada ou a alta.
 */
export function limitarPelaAlta<D extends { readonly retiradoEm: string | null }>(
  d: D,
  alta: string | null,
): D {
  if (alta === null) return d;
  const fimAlta = `${alta}T00:00:00`;
  if (d.retiradoEm !== null && msLocal(d.retiradoEm) <= msLocal(fimAlta)) return d;
  return { ...d, retiradoEm: fimAlta };
}

/** Os dispositivos sem retirada registrada de internação já encerrada (a CCIH registra a retirada). */
export function dispositivosSemRetiradaAposAlta<
  D extends { readonly reg: number; readonly retiradoEm: string | null },
>(dispositivos: readonly D[], altas: ReadonlyMap<number, string | null>): (D & { readonly alta: string })[] {
  return dispositivos.flatMap((d) => {
    const alta = altas.get(d.reg) ?? null;
    return d.retiradoEm === null && alta !== null ? [{ ...d, alta }] : [];
  });
}
