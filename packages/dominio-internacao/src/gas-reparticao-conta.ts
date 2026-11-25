// Repartição do uso de gás medicinal entre as contas parciais (F3.4, 04-INT linha 82; C1-074). Na internação longa a
// conta é fechada por período (parcial): um uso que atravessa o fim de uma conta é dividido no instante da virada, e
// cada parte é cobrada na conta do seu período (cada conta apura o tempo ACUMULADO do gás dentro do próprio período).
// Regras puras:
//   - o período efetivo de cada conta lançável vai do início dela até o início da conta seguinte (a de início mais
//     recente prevalece onde duas se sobrepõem, como na escolha de conta por período); um intervalo de até 1 minuto
//     entre o fim de uma e o início da seguinte é tratado como virada contínua;
//   - a parte do uso sem conta lançável que a cubra recusa o lançamento inteiro, com o uso e o trecho descoberto
//     (nada é lançado nem marcado);
//   - o uso de duração zero vai para a conta que contém o seu início.
import type { ProblemaGas, UsoGasPeriodo } from './gas-cobranca.js';

/** Intervalo máximo entre o fim de uma conta e o início da seguinte tratado como virada contínua. */
export const FOLGA_VIRADA_CONTA_MS = 60_000;

export interface ContaPeriodoGas {
  readonly conta: number;
  readonly inicio: Date;
  /** null: conta aberta sem fim de período. */
  readonly fim: Date | null;
}

export interface UsoARepartir {
  readonly id: number;
  readonly inicio: Date;
  readonly fim: Date;
}

export interface ParteUsoGas {
  readonly uso: number;
  readonly conta: number;
  readonly inicio: Date;
  readonly fim: Date;
}

const ms = (d: Date) => d.getTime();
const iso = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

/** Os períodos efetivos das contas lançáveis, em ordem de início (sem sobreposição; viradas curtas emendadas). */
export function periodosEfetivosContas(contas: readonly ContaPeriodoGas[]): ContaPeriodoGas[] {
  const ord = [...contas].sort((a, b) => ms(a.inicio) - ms(b.inicio) || a.conta - b.conta);
  return ord.map((c, i) => {
    const prox = ord[i + 1];
    if (!prox) return c;
    const emenda = c.fim === null || ms(c.fim) + FOLGA_VIRADA_CONTA_MS >= ms(prox.inicio);
    return { conta: c.conta, inicio: c.inicio, fim: emenda ? prox.inicio : c.fim };
  });
}

/** Os usos recortados ao período (o que cai fora some; o uso em andamento vai até o fim do período). */
export function recortarUsosGas(
  usos: readonly UsoGasPeriodo[],
  periodo: { readonly inicio: Date; readonly fim: Date | null },
): UsoGasPeriodo[] {
  const r: UsoGasPeriodo[] = [];
  for (const u of usos) {
    const ini = Math.max(ms(u.inicio), ms(periodo.inicio));
    const fimUso = u.fim ? ms(u.fim) : Infinity;
    const fimPer = periodo.fim ? ms(periodo.fim) : Infinity;
    const fim = Math.min(fimUso, fimPer);
    if (fim <= ini) continue;
    r.push({ ...u, inicio: new Date(ini), fim: fim === Infinity ? null : new Date(fim) });
  }
  return r;
}

/**
 * Divide cada uso encerrado entre as contas lançáveis do atendimento. Devolve as partes (uso, conta, início, fim) e os
 * problemas (trecho sem conta que o cubra); com problema, quem chama recusa o lançamento inteiro.
 */
export function repartirUsosGasPorConta(
  usos: readonly UsoARepartir[],
  contas: readonly ContaPeriodoGas[],
): { partes: ParteUsoGas[]; problemas: ProblemaGas[] } {
  const periodos = periodosEfetivosContas(contas);
  const partes: ParteUsoGas[] = [];
  const problemas: ProblemaGas[] = [];
  const descoberto = (u: UsoARepartir, de: number, ate: number) =>
    problemas.push({
      campo: 'conta',
      mensagem: `O uso ${u.id} tem tempo sem conta aberta do atendimento (de ${iso(new Date(de))} a ${iso(
        new Date(ate),
      )}): abra a conta do período ou ajuste o período da conta.`,
    });
  for (const u of usos) {
    const ini = ms(u.inicio);
    const fim = ms(u.fim);
    if (fim <= ini) {
      const p = periodos.find((x) => ms(x.inicio) <= ini && (x.fim === null || ini < ms(x.fim)));
      if (p) partes.push({ uso: u.id, conta: p.conta, inicio: u.inicio, fim: u.inicio });
      else descoberto(u, ini, ini);
      continue;
    }
    let cursor = ini;
    for (const p of periodos) {
      const pIni = ms(p.inicio);
      const pFim = p.fim ? ms(p.fim) : Infinity;
      const s = Math.max(cursor, pIni);
      const e = Math.min(fim, pFim);
      if (e <= s) continue;
      if (s > cursor) descoberto(u, cursor, s);
      partes.push({ uso: u.id, conta: p.conta, inicio: new Date(s), fim: new Date(e) });
      cursor = e;
      if (cursor >= fim) break;
    }
    if (cursor < fim) descoberto(u, cursor, fim);
  }
  return { partes, problemas };
}
