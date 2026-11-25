// Riscos por função, EPI e exposições (regra 19; NR32-03, NR32-05; NR-6 6.6.1; CNEN NN 3.01): o EPI exigido pela
// função (no setor ou em todo o estabelecimento), a entrega com o número e a validade do CA (CA vencido na data da
// entrega é recusado) e a assinatura do colaborador; a dosimetria (dose efetiva acumulada no ano contra 20 e 50 mSv) e a
// exposição a quimioterápico registradas. A função é comparada sem acento, sem caixa e sem espaço repetido.
import { LIMITE_DOSE_ANUAL_MSV, type PendenciaSesmt, TETO_DOSE_ANUAL_MSV } from '@sgh/contratos';
import { diasEntre } from '../datas.js';
import { recusaSesmt, type RecusaSesmt } from './recusa.js';

/** A chave da função para o mapa de riscos: maiúsculas, sem acento e sem espaço repetido (até 60 caracteres). */
export function chaveFuncao(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

export interface LinhaRiscoLida {
  readonly id: number;
  readonly unidade: number | null;
  readonly funcaoChave: string;
  readonly tipo: 'risco' | 'epi';
  readonly epi: string | null;
  readonly inicio: string;
  readonly fim: string | null;
}

/** As linhas do mapa que valem para a função e a unidade do vínculo no dia (a linha sem unidade vale em todas). */
export function linhasDaFuncao<T extends LinhaRiscoLida>(
  mapa: readonly T[],
  funcao: string,
  unidade: number | null,
  hoje: string,
): T[] {
  const chave = chaveFuncao(funcao);
  return mapa.filter(
    (l) =>
      l.funcaoChave === chave &&
      (l.unidade === null || l.unidade === unidade) &&
      diasEntre(l.inicio, hoje) >= 0 &&
      (l.fim === null || diasEntre(hoje, l.fim) >= 0),
  );
}

export interface EntregaLida {
  readonly id: number;
  readonly tipo: 'epi' | 'dosimetria' | 'quimio';
  readonly data: string;
  readonly epi: string | null;
  readonly caValidade: string | null;
  readonly assinatura: 'pendente' | 'assinada' | null;
  readonly doseMsv: number | null;
  /** O registro cancelado (marcado com o motivo, nunca apagado) fica no histórico, mas não conta em dose nem pendência. */
  readonly cancelada?: boolean;
}

/** Só os registros que valem: o cancelado não entra na dose do ano, nos EPI entregues nem nas pendências. */
const ativas = (entregas: readonly EntregaLida[]): EntregaLida[] =>
  entregas.filter((e) => e.cancelada !== true);

export interface EntradaEntregaEpi {
  readonly epi: string;
  readonly caNumero: string;
  readonly caValidade: string;
  readonly quantidade: number;
  readonly data: string;
}

/** Confere a entrega do EPI (regra 19): data não futura, CA com número e válido na data da entrega. */
export function conferirEntregaEpi(e: EntradaEntregaEpi, hoje: string, admissao: string): RecusaSesmt | null {
  if (diasEntre(hoje, e.data) > 0)
    return recusaSesmt('data-futura', 'A data da entrega não pode ser futura.', 'data');
  if (diasEntre(admissao, e.data) < 0)
    return recusaSesmt('antes-admissao', 'A entrega é anterior à admissão do vínculo.', 'data');
  if (!/^\d{1,12}$/.test(e.caNumero.trim()))
    return recusaSesmt('ca-invalido', 'O número do CA tem só algarismos (até 12).', 'caNumero');
  if (diasEntre(e.data, e.caValidade) < 0)
    return recusaSesmt(
      'ca-vencido',
      'O CA deste EPI estava vencido na data da entrega: o EPI não pode ser entregue (NR-6).',
      'caValidade',
    );
  if (!Number.isInteger(e.quantidade) || e.quantidade < 1)
    return recusaSesmt('quantidade', 'A quantidade é um número inteiro a partir de 1.', 'quantidade');
  return null;
}

export interface EntradaDosimetria {
  readonly periodoInicio: string;
  readonly data: string;
  readonly doseMsv: number;
}

export function conferirDosimetria(e: EntradaDosimetria, hoje: string): RecusaSesmt | null {
  if (diasEntre(hoje, e.data) > 0)
    return recusaSesmt('data-futura', 'O fim do período não pode ser futuro.', 'data');
  if (diasEntre(e.periodoInicio, e.data) < 0)
    return recusaSesmt('periodo-invertido', 'O início do período vem antes do fim.', 'periodoInicio');
  if (!(e.doseMsv >= 0) || e.doseMsv > 1000)
    return recusaSesmt('dose-invalida', 'A dose é um número de 0 a 1.000 mSv.', 'doseMsv');
  return null;
}

export interface LeituraDosimetriaLida {
  readonly tipo: 'epi' | 'dosimetria' | 'quimio';
  readonly dosimetro: string | null;
  readonly periodoInicio: string | null;
  readonly cancelada: boolean;
}

/**
 * CNEN NN 3.01: uma leitura por dosímetro e período. A leitura ativa do mesmo dosímetro com o mesmo início de período
 * recusa a nova (a correção é cancelar a anterior, com o motivo, e lançar a certa). O dosímetro é comparado sem espaço
 * nas pontas e sem caixa.
 */
export function conferirLeituraRepetida(
  leituras: readonly LeituraDosimetriaLida[],
  nova: { readonly dosimetro: string; readonly periodoInicio: string },
): RecusaSesmt | null {
  const chave = nova.dosimetro.trim().toUpperCase();
  const repetida = leituras.some(
    (l) =>
      l.tipo === 'dosimetria' &&
      !l.cancelada &&
      l.periodoInicio === nova.periodoInicio &&
      (l.dosimetro ?? '').trim().toUpperCase() === chave,
  );
  return repetida
    ? recusaSesmt(
        'leitura-repetida',
        'Já há leitura deste dosímetro para o mesmo período: cancele a anterior para lançar a correta.',
        'periodoInicio',
      )
    : null;
}

/** A dose efetiva acumulada no ano civil (soma das leituras cujo período termina no ano), com as parcelas. */
export function doseNoAno(
  entregas: readonly EntregaLida[],
  ano: number,
): { total: number; parcelas: number[]; situacao: 'normal' | 'acima-limite' | 'acima-teto' } {
  const parcelas = ativas(entregas)
    .filter((e) => e.tipo === 'dosimetria' && Number(e.data.slice(0, 4)) === ano && e.doseMsv !== null)
    .map((e) => e.doseMsv as number);
  const total = Math.round(parcelas.reduce((s, x) => s + x, 0) * 1000) / 1000;
  const situacao =
    total > TETO_DOSE_ANUAL_MSV ? 'acima-teto' : total > LIMITE_DOSE_ANUAL_MSV ? 'acima-limite' : 'normal';
  return { total, parcelas, situacao };
}

/** Os EPI exigidos pela função sem nenhuma entrega com CA ainda válido no dia. */
export function episFaltando(
  exigidos: readonly LinhaRiscoLida[],
  entregas: readonly EntregaLida[],
  hoje: string,
): string[] {
  const faltam: string[] = [];
  for (const l of exigidos) {
    if (l.tipo !== 'epi' || !l.epi) continue;
    const chave = chaveFuncao(l.epi);
    const tem = ativas(entregas).some(
      (e) =>
        e.tipo === 'epi' &&
        e.epi !== null &&
        chaveFuncao(e.epi) === chave &&
        e.caValidade !== null &&
        diasEntre(hoje, e.caValidade) >= 0,
    );
    if (!tem && !faltam.includes(l.epi)) faltam.push(l.epi);
  }
  return faltam;
}

/** As pendências de EPI e dose do vínculo no dia. */
export function pendenciasEpi(
  exigidos: readonly LinhaRiscoLida[],
  entregas: readonly EntregaLida[],
  hoje: string,
): PendenciaSesmt[] {
  const r: PendenciaSesmt[] = [];
  if (ativas(entregas).some((e) => e.tipo === 'epi' && e.assinatura === 'pendente')) r.push('epi-assinatura');
  if (episFaltando(exigidos, entregas, hoje).length > 0) r.push('epi-faltando');
  if (doseNoAno(entregas, Number(hoje.slice(0, 4))).situacao !== 'normal') r.push('dose-acima-limite');
  return r;
}
