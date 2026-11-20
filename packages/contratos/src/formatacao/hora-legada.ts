// Hora legada (regra 8 do M07; cap-10 §10.2; porta de toHHMM e formatHora da sante-api, src/utils/sgh.js).
// O legado guarda hora como texto de quatro dígitos sem dois-pontos ("0830"); "08:01" quebra o trigger.
import { z } from 'zod';
import { ErroValidacao } from '../validacao/erro.js';

export const FORMATO_HHMM = /^([01]\d|2[0-3])[0-5]\d$/;

export class ErroHora extends ErroValidacao {
  override readonly name: string = 'ErroHora';
}

/** Aceita "HH:MM", "HHMM", "H:MM" e "HMM"; devolve sempre "HHMM" (quatro dígitos) ou lança. */
export function paraHhmm(entrada: string): string {
  const limpa = entrada.trim();
  const digitos = limpa.replace(':', '');
  if (!/^\d{3,4}$/.test(digitos) || (limpa.includes(':') && !/^\d{1,2}:\d{2}$/.test(limpa))) {
    throw new ErroHora(
      'hora.formato',
      { entrada },
      `Hora inválida: "${entrada}". Use HH:MM, por exemplo 08:30.`,
    );
  }
  const hhmm = digitos.padStart(4, '0');
  if (!FORMATO_HHMM.test(hhmm)) {
    throw new ErroHora(
      'hora.fora-do-intervalo',
      { entrada },
      `Hora fora do intervalo: "${entrada}" (00:00 a 23:59).`,
    );
  }
  return hhmm;
}

/** "HHMM" do legado → "HH:MM" para a tela. Vazio ou nulo → null; já formatado passa como está. */
export function formatarHoraLegada(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const s = valor.trim();
  if (s === '') return null;
  if (s.includes(':')) return s;
  const p = s.padStart(4, '0');
  return `${p.slice(0, 2)}:${p.slice(2)}`;
}

export type SituacaoHora =
  | { readonly tipo: 'vazia' }
  | { readonly tipo: 'valida'; readonly texto: string }
  | { readonly tipo: 'invalida'; readonly bruto: string };

/**
 * Hora vinda do legado para EXIBIÇÃO: válida (HH:MM), vazia, ou inválida com o valor bruto (por exemplo
 * "2575" ou "08300"), que a tela mostra com alerta de dado inválido, nunca "corrigido" (regra 7/8).
 */
export function classificarHora(valor: string | null | undefined): SituacaoHora {
  if (valor === null || valor === undefined || valor.trim() === '') return { tipo: 'vazia' };
  const s = valor.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  const hhmm = m ? `${m[1]!.padStart(2, '0')}${m[2]}` : /^\d{3,4}$/.test(s) ? s.padStart(4, '0') : null;
  if (hhmm === null || !FORMATO_HHMM.test(hhmm)) return { tipo: 'invalida', bruto: valor };
  return { tipo: 'valida', texto: `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` };
}

/** Contrato: hora trafega como "HHMM"; a entrada aceita os formatos da tela e é convertida. */
export const esquemaHoraLegada = z.string().transform((v, ctx) => {
  try {
    return paraHhmm(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});
