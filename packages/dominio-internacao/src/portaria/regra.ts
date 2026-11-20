// Regras de visita por unidade (M50, etapa 5; regra 9): horário, visitantes ao mesmo tempo, idade mínima, UTI e o que
// fazer com o paciente em isolamento. A regra da unidade (bloco) vale primeiro; sem ela, a do estabelecimento (`*`); sem
// nenhuma gravada, a regra de mercado (padrão a conferir com a enfermagem e a supervisão da recepção). Regras puras.
import type { IsolamentoRegra } from '@sgh/contratos';

export interface RegraVisita {
  readonly unidade: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly maxSimultaneos: number;
  readonly idadeMinima: number;
  readonly uti: boolean;
  readonly isolamento: IsolamentoRegra;
  readonly duracaoMaxMin: number;
}

/**
 * Regra de mercado sem regra gravada (D-REGRA-50-5): das 14 h às 20 h, 2 visitantes ao mesmo tempo, 12 anos ou mais,
 * 2 horas por visita; o paciente em isolamento recebe a visita com a orientação da enfermagem.
 */
export const REGRA_PADRAO: RegraVisita = Object.freeze({
  unidade: '*',
  horaInicio: '14:00',
  horaFim: '20:00',
  maxSimultaneos: 2,
  idadeMinima: 12,
  uti: false,
  isolamento: 'orientar',
  duracaoMaxMin: 120,
});

/** A regra que vale para a unidade: a dela, a do estabelecimento ou a de mercado (`padrao`). */
export function regraDaUnidade<R extends RegraVisita>(
  regras: readonly R[],
  unidade: string,
): { readonly regra: R | RegraVisita; readonly padrao: boolean } {
  const u = unidade.trim().toUpperCase();
  const propria = regras.find((r) => r.unidade.trim().toUpperCase() === u);
  if (propria) return { regra: propria, padrao: false };
  const geral = regras.find((r) => r.unidade === '*');
  if (geral) return { regra: geral, padrao: false };
  return { regra: { ...REGRA_PADRAO, unidade: u || '*' }, padrao: true };
}

/** HH:MM do instante local (AAAA-MM-DDTHH:mm). */
export const horaDoInstante = (instante: string): string => instante.slice(11, 16);

/** O instante está dentro do horário de visita [início, fim)? */
export function dentroDoHorario(instante: string, r: Pick<RegraVisita, 'horaInicio' | 'horaFim'>): boolean {
  const h = horaDoInstante(instante);
  return h >= r.horaInicio && h < r.horaFim;
}

export type ConferenciaRegra = { readonly ok: true } | { readonly ok: false; readonly mensagem: string };

/** Conferência da regra antes de gravar (o esquema já conferiu os formatos e os limites). */
export function conferirRegra(r: RegraVisita): ConferenciaRegra {
  if (r.horaInicio >= r.horaFim)
    return { ok: false, mensagem: 'O fim do horário de visita é depois do início.' };
  const [hi, mi] = r.horaInicio.split(':').map(Number);
  const [hf, mf] = r.horaFim.split(':').map(Number);
  const minutos = hf! * 60 + mf! - (hi! * 60 + mi!);
  if (r.duracaoMaxMin > minutos && r.duracaoMaxMin < 1_440)
    return {
      ok: false,
      mensagem: `A duração máxima da visita (${r.duracaoMaxMin} min) passa do horário de visita (${minutos} min).`,
    };
  return { ok: true };
}
