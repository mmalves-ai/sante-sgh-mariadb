// Valor crítico (ficha do M26, regra 7; cap-05b §5.10; cap-14 §14.5): a lista e o prazo são do laboratório, aprovados
// pela diretoria clínica (SGH_SADT_VALOR_CRITICO); ao liberar, em qualquer um dos dois sistemas, aviso ativo ao médico
// ou enfermeiro responsável em menos de 1 minuto; a ciência é obrigatória e auditada (no prontuário, M23); sem ciência
// no prazo do elemento, o aviso sobe ao plantonista e, no mesmo prazo de novo, ao supervisor.
import type { NivelEscalonamento } from '@sgh/contratos';

export interface FaixaCritica {
  readonly elemento: number;
  readonly abaixoDe: number | null;
  readonly acimaDe: number | null;
  readonly prazoMinutos: number;
  readonly ativo: boolean;
}

/** O valor é crítico pela faixa ativa do elemento (limite estrito: abaixo de, acima de). */
export function valorCritico(valor: number | null, faixa: FaixaCritica | null | undefined): boolean {
  if (valor === null || !faixa || !faixa.ativo) return false;
  return (
    (faixa.abaixoDe !== null && valor < faixa.abaixoDe) || (faixa.acimaDe !== null && valor > faixa.acimaDe)
  );
}

/** Os elementos críticos de um resultado (elemento → valor numérico) pela lista aprovada do exame. */
export function elementosCriticos(
  valores: readonly { readonly elemento: number; readonly numerico: number | null }[],
  faixas: readonly FaixaCritica[],
): { elemento: number; valor: number; prazoMinutos: number }[] {
  const r: { elemento: number; valor: number; prazoMinutos: number }[] = [];
  for (const v of valores) {
    const f = faixas.find((x) => x.elemento === v.elemento && x.ativo);
    if (f && v.numerico !== null && valorCritico(v.numerico, f))
      r.push({ elemento: v.elemento, valor: v.numerico, prazoMinutos: f.prazoMinutos });
  }
  return r;
}

const ms = (iso: string) => Date.parse(iso);

/**
 * O nível do aviso agora: 0 (responsável) até o prazo; 1 (plantonista) depois do prazo; 2 (supervisor) depois de
 * duas vezes o prazo. Com ciência, o nível em que foi dada.
 */
export function nivelDoAviso(a: {
  readonly emitidoEm: string;
  readonly prazoMinutos: number;
  readonly agora: string;
  readonly cienciaEm?: string | null;
}): NivelEscalonamento {
  const fim = a.cienciaEm ? ms(a.cienciaEm) : ms(a.agora);
  const passados = (fim - ms(a.emitidoEm)) / 60_000;
  if (passados >= a.prazoMinutos * 2) return 2;
  if (passados >= a.prazoMinutos) return 1;
  return 0;
}

/** O instante em que o aviso sobe ao próximo nível (null no supervisor). */
export function proximoEscalonamento(a: {
  readonly emitidoEm: string;
  readonly prazoMinutos: number;
  readonly nivel: NivelEscalonamento;
}): string | null {
  if (a.nivel >= 2) return null;
  return new Date(ms(a.emitidoEm) + a.prazoMinutos * 60_000 * (a.nivel + 1)).toISOString();
}

/** A ciência veio no prazo (antes de subir ao plantonista). */
export function noPrazo(a: {
  readonly emitidoEm: string;
  readonly prazoMinutos: number;
  readonly cienciaEm: string | null;
}): boolean {
  if (!a.cienciaEm) return false;
  return ms(a.cienciaEm) - ms(a.emitidoEm) <= a.prazoMinutos * 60_000;
}

/** Segundos da liberação ao aviso (meta: menos de 60 s, cap-14 §14.5). */
export function segundosAteAviso(liberadoEm: string, emitidoEm: string): number {
  return Math.max(0, Math.round((ms(emitidoEm) - ms(liberadoEm)) / 1000));
}

/** Indicadores do período: avisos com ciência no prazo e tempo médio até a ciência (as parcelas sempre). */
export function indicadoresCriticos(
  avisos: readonly {
    readonly emitidoEm: string;
    readonly prazoMinutos: number;
    readonly cienciaEm: string | null;
  }[],
): {
  readonly total: number;
  readonly noPrazo: number;
  readonly comCiencia: number;
  readonly mediaMinutos: number | null;
} {
  let soma = 0;
  let comCiencia = 0;
  let dentro = 0;
  for (const a of avisos) {
    if (noPrazo(a)) dentro++;
    if (a.cienciaEm) {
      comCiencia++;
      soma += (ms(a.cienciaEm) - ms(a.emitidoEm)) / 60_000;
    }
  }
  return {
    total: avisos.length,
    noPrazo: dentro,
    comCiencia,
    mediaMinutos: comCiencia ? Math.round((soma / comCiencia) * 10) / 10 : null,
  };
}
