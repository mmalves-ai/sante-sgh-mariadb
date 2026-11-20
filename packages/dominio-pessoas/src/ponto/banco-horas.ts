// Banco de horas, regra 14 do M52 (cap-07 §7.1.3): por regra do regime (destino das horas pelo domínio POBANCOHRTP e o
// início de cada ciclo pelo POTPINIBANCO); o saldo é a SOMA dos movimentos, nunca um campo editável (os movimentos são
// só de inclusão: o fechamento credita as extras e debita os atrasos; a reabertura estorna com outro movimento). CLT,
// art. 59, §§ 2º e 5º: o ciclo é de até 12 meses por acordo coletivo ou 6 por acordo individual (parâmetro do regime).
import type { DestinoBanco, InicioBanco, OrigemBanco } from '@sgh/contratos';
import { extrasDosEventos, type MinutosPorEvento } from './apuracao.js';
import { type RecusaPonto } from './ajuste.js';
import { recusaSesmt as recusa } from '../sesmt/recusa.js';

export interface MovimentoBancoLido {
  readonly minutos: number;
  readonly competencia: string;
  readonly origem: OrigemBanco;
}

export interface RegraBanco {
  readonly destino: DestinoBanco;
  readonly inicio: InicioBanco;
  /** Primeira competência do primeiro ciclo (`AAAA-MM`). */
  readonly desde: string;
  readonly cicloMeses: number;
  /** A falta não abonada também debita o banco (padrão: não; a falta vai à folha). */
  readonly faltaDebita: boolean;
}

/** Saldo = soma dos movimentos (regra 14). */
export function saldoBanco(movimentos: readonly Pick<MovimentoBancoLido, 'minutos'>[]): number {
  return movimentos.reduce((s, m) => s + m.minutos, 0);
}

const mes = (competencia: string): number => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!m) throw new Error(`Competência inválida: ${competencia}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
};

/** A competência começa um ciclo novo (não o primeiro) do banco. */
export function comecaCiclo(competencia: string, regra: Pick<RegraBanco, 'desde' | 'cicloMeses'>): boolean {
  const d = mes(competencia) - mes(regra.desde);
  return d > 0 && regra.cicloMeses > 0 && d % regra.cicloMeses === 0;
}

export interface MovimentoProposto {
  readonly origem: OrigemBanco;
  /** Destino do movimento no domínio do ramo (2 banco; 3 folha; 4 expiração de negativas). */
  readonly destino: DestinoBanco;
  readonly minutos: number;
}

/** A virada do ciclo pelo início escolhido (POTPINIBANCO): o que vai à folha e o que expira. */
export function viradaDoCiclo(saldo: number, inicio: InicioBanco): MovimentoProposto[] {
  const pagar = saldo > 0 && (inicio === 1 || inicio === 3);
  const expirar = saldo < 0 && (inicio === 1 || inicio === 2);
  return [
    ...(pagar ? [{ origem: 'pago-folha' as const, destino: 3 as const, minutos: -saldo }] : []),
    ...(expirar ? [{ origem: 'expiracao' as const, destino: 4 as const, minutos: -saldo }] : []),
  ];
}

export interface ResultadoBanco {
  /** Os eventos que vão à folha (as extras e os atrasos que foram ao banco saem daqui). */
  readonly eventosFolha: MinutosPorEvento;
  readonly credito: number;
  readonly debito: number;
  readonly movimentos: readonly MovimentoProposto[];
  readonly saldoAnterior: number;
  readonly saldoFinal: number;
}

/**
 * O fechamento do período no banco: com o destino "banco de horas", as extras creditam e os atrasos (e, se a regra
 * mandar, as faltas) debitam; sem banco (1) ou para a folha (3), os eventos vão inteiros à folha. Na virada do ciclo, o
 * saldo anterior é tratado antes (o positivo pago na folha entra na 1ª faixa de hora extra).
 */
export function fecharNoBanco(
  eventos: MinutosPorEvento,
  regra: RegraBanco | null,
  competencia: string,
  saldoAnterior: number,
): ResultadoBanco {
  const folha: MinutosPorEvento = { ...eventos };
  if (!regra || regra.destino !== 2)
    return {
      eventosFolha: folha,
      credito: 0,
      debito: 0,
      movimentos: [],
      saldoAnterior,
      saldoFinal: saldoAnterior,
    };
  const virada = comecaCiclo(competencia, regra) ? viradaDoCiclo(saldoAnterior, regra.inicio) : [];
  const pago = virada.filter((v) => v.origem === 'pago-folha').reduce((s, v) => s - v.minutos, 0);
  const credito = extrasDosEventos(eventos);
  const debito = eventos[4] + (regra.faltaDebita ? eventos[3] : 0);
  for (const k of [4, 6, 7, 8, 9, 10, 11, 12, 13] as const) folha[k] = 0;
  if (regra.faltaDebita) folha[3] = 0;
  folha[10] += pago;
  const movimentos: MovimentoProposto[] = [
    ...virada,
    ...(credito - debito !== 0
      ? [{ origem: 'apuracao' as const, destino: 2 as const, minutos: credito - debito }]
      : []),
  ];
  return {
    eventosFolha: folha,
    credito,
    debito,
    movimentos,
    saldoAnterior,
    saldoFinal: saldoAnterior + movimentos.reduce((s, m) => s + m.minutos, 0),
  };
}

/** O acerto manual do banco (aprovador, com motivo): nunca zero, no máximo 200 h num acerto. */
export function conferirAcerto(minutos: number, periodoFechado: boolean): RecusaPonto | null {
  if (!Number.isInteger(minutos) || minutos === 0 || Math.abs(minutos) > 200 * 60)
    return recusa('minutos', 'O acerto vai de 1 minuto a 200 horas, para mais ou para menos.', 'minutos');
  if (periodoFechado)
    return recusa(
      'periodo-fechado',
      'O período está fechado: lance o acerto numa competência aberta.',
      'competencia',
    );
  return null;
}

/** Minutos em `±H h MM` (o espelho e o banco mostram assim). */
export function horasMinutos(min: number): string {
  const s = min < 0 ? '−' : '';
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}`;
}
