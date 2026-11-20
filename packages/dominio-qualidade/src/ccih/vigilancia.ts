// Vigilância ativa da CCIH (ficha, seção 4, "Pacientes em vigilância"; cap-05b §5.11): o internado entra na fila quando
// tem pelo menos um motivo (dispositivo invasivo, antimicrobiano, cultura recente, febre nas últimas 48 h,
// pós-operatório de até 30 dias, precaução ou IRAS da internação). A ordem é pelo peso dos motivos (o antimicrobiano
// restrito sem liberação no prazo primeiro), depois pelo leito.
import type { MotivoVigilancia } from '@sgh/contratos';
import { MOTIVOS_VIGILANCIA } from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';
import { diferencaDias } from './tempo.js';

/** Febre para a vigilância: temperatura axilar de 37,8 °C ou mais (o alerta do sinal vital do M25). */
export const LIMIAR_FEBRE = 37.8;
export const JANELA_FEBRE_HORAS = 48;
export const JANELA_CULTURA_DIAS = 7;
export const JANELA_POS_OPERATORIO_DIAS = 30;

export interface SinaisVigilancia {
  readonly dispositivosAtivos: number;
  readonly antimicrobianos: number;
  readonly restritosSemLiberacao: number;
  readonly revisoesDevidas: number;
  readonly culturasRecentes: number;
  readonly febre: boolean;
  readonly posOperatorio: boolean;
  readonly precaucoes: number;
  readonly iras: number;
}

export function motivosVigilancia(s: SinaisVigilancia): MotivoVigilancia[] {
  const m: MotivoVigilancia[] = [];
  if (s.restritosSemLiberacao > 0) m.push('antimicrobianoSemLiberacao');
  if (s.dispositivosAtivos > 0) m.push('dispositivo');
  if (s.febre) m.push('febre');
  if (s.antimicrobianos > 0) m.push('antimicrobiano');
  if (s.revisoesDevidas > 0) m.push('revisaoAntimicrobiano');
  if (s.culturasRecentes > 0) m.push('cultura');
  if (s.posOperatorio) m.push('posOperatorio');
  if (s.precaucoes > 0) m.push('precaucao');
  if (s.iras > 0) m.push('iras');
  return m;
}

export function pesoVigilancia(motivos: readonly MotivoVigilancia[]): number {
  return motivos.reduce((s, m) => s + (MOTIVOS_VIGILANCIA.find((x) => x.codigo === m)?.peso ?? 0), 0);
}

/** Houve febre na janela (as temperaturas do internado com o instante da medida). */
export function teveFebre(
  temperaturas: readonly { readonly valor: number; readonly em: string }[],
  agora: string,
): boolean {
  const desde = msLocal(agora) - JANELA_FEBRE_HORAS * 3_600_000;
  return temperaturas.some(
    (t) => t.valor >= LIMIAR_FEBRE && msLocal(t.em) >= desde && msLocal(t.em) <= msLocal(agora),
  );
}

/** A cirurgia (data civil) está na janela do pós-operatório. */
export function emPosOperatorio(datasCirurgia: readonly string[], hoje: string): boolean {
  return datasCirurgia.some((d) => {
    const x = diferencaDias(d, hoje);
    return x >= 0 && x <= JANELA_POS_OPERATORIO_DIAS;
  });
}

/** Ordena a fila: maior peso primeiro, depois pelo leito (setor, acomodação, leito). */
export function ordenarVigilancia<
  T extends { readonly motivos: readonly MotivoVigilancia[]; readonly leito: string },
>(itens: readonly T[]): T[] {
  return [...itens].sort(
    (a, b) =>
      pesoVigilancia(b.motivos) - pesoVigilancia(a.motivos) || a.leito.localeCompare(b.leito, 'pt-BR'),
  );
}
