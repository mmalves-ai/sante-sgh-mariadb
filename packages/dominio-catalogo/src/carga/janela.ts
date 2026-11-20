// Janela fora do pico (ficha do M13, seção 5; cap-10 §10.11): as cargas aprovadas são publicadas só dentro da
// janela configurada por estabelecimento (parâmetro `catalogo.janelaPublicacao`, padrão 22:00 às 06:00). A
// janela pode atravessar a meia-noite.

export interface JanelaPublicacao {
  readonly inicio: string;
  readonly fim: string;
}

export const JANELA_PADRAO: JanelaPublicacao = { inicio: '22:00', fim: '06:00' };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutosDe(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Lê a janela "HH:MM-HH:MM" (texto do parâmetro); inválida ou vazia = a padrão. */
export function lerJanela(texto: string | null | undefined): JanelaPublicacao {
  const m = /^\s*(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\s*$/.exec(texto ?? '');
  if (!m || !HHMM.test(m[1] as string) || !HHMM.test(m[2] as string)) return JANELA_PADRAO;
  return { inicio: m[1] as string, fim: m[2] as string };
}

export function dentroDaJanela(j: JanelaPublicacao, agoraMinutos: number): boolean {
  const ini = minutosDe(j.inicio);
  const fim = minutosDe(j.fim);
  if (ini === fim) return true;
  return ini < fim ? agoraMinutos >= ini && agoraMinutos < fim : agoraMinutos >= ini || agoraMinutos < fim;
}
