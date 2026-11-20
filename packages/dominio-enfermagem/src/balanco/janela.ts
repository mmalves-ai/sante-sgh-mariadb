// Janela do balanço hídrico (M45, etapa 3; regra 6): o balanço de 24 horas vai da hora de corte da unidade (padrão
// 7 h) de um dia à do dia seguinte. A janela em curso é a que contém agora; as anteriores, para fechar com atraso ou
// consultar. Horas locais do estabelecimento em texto (AAAA-MM-DDTHH:mm), sem fuso.
import type { JanelaBalanco } from '@sgh/contratos';
import { dataDe, ErroHora, minutosDoDia, somarMinutos } from '../tempo.js';

export const MINUTOS_JANELA = 24 * 60;

const p2 = (n: number) => String(n).padStart(2, '0');

/** HHMM (ou HH:mm) → HH:mm, recusando a hora fora do formato. */
export function horaDoCorte(hhmm: string): string {
  const m = minutosDoDia(hhmm);
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}

/** A janela de 24 horas que contém o instante, com a hora de corte da unidade. */
export function janelaDoInstante(instante: string, horaCorte: string): { inicio: string; fim: string } {
  const t = instante.slice(0, 16);
  const corteDoDia = `${dataDe(t)}T${horaDoCorte(horaCorte)}`;
  const inicio = t >= corteDoDia ? corteDoDia : somarMinutos(corteDoDia, -MINUTOS_JANELA);
  return { inicio, fim: somarMinutos(inicio, MINUTOS_JANELA) };
}

/** A janela que começa no início pedido; o início fora da hora de corte é recusado (a tela só escolhe as do corte). */
export function janelaQueComecaEm(inicio: string, horaCorte: string): { inicio: string; fim: string } {
  const t = inicio.slice(0, 16);
  if (t.slice(11, 16) !== horaDoCorte(horaCorte))
    throw new ErroHora(`A janela do balanço começa na hora de corte da unidade (${horaDoCorte(horaCorte)}).`);
  return { inicio: t, fim: somarMinutos(t, MINUTOS_JANELA) };
}

/**
 * A janela em curso e as anteriores (a mais recente primeiro), com a marca das já fechadas em 24 horas. Com `desde` (a
 * entrada da internação), a janela que acabou antes dela não é oferecida (a em curso fica sempre).
 */
export function janelasRecentes(
  agora: string,
  horaCorte: string,
  fechadas: ReadonlySet<string>,
  quantas = 3,
  desde: string | null = null,
): JanelaBalanco[] {
  const atual = janelaDoInstante(agora, horaCorte);
  const r: JanelaBalanco[] = [];
  for (let i = 0; i < quantas; i++) {
    const inicio = somarMinutos(atual.inicio, -i * MINUTOS_JANELA);
    if (i > 0 && desde && somarMinutos(inicio, MINUTOS_JANELA) <= desde.slice(0, 16)) break;
    r.push({
      inicio,
      fim: somarMinutos(inicio, MINUTOS_JANELA),
      fechada: fechadas.has(inicio),
      atual: i === 0,
    });
  }
  return r;
}

/** O instante está dentro da janela [inicio, fim)? */
export function dentroDaJanela(instante: string, j: { inicio: string; fim: string }): boolean {
  const t = instante.slice(0, 16);
  return t >= j.inicio && t < j.fim;
}
