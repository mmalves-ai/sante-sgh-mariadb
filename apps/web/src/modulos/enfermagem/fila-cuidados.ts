// Checagem dos cuidados de enfermagem sem rede (M45, etapa 4; ficha, seção 7: a prescrição de enfermagem na linha do
// tempo é PWA de beira do leito, com a regra 8 do M25): sem rede, o ato (feito ou não feito com o motivo) fica no cofre
// cifrado do aparelho, do dono da sessão, com a hora real do aparelho acertada pelo relógio do estabelecimento e a chave
// dele (Idempotency-Key). Na volta da rede, os atos vão na ordem, cada um com a MESMA chave: reenviar não grava duas
// vezes (o servidor devolve a checagem já gravada). O ato recusado pelo servidor (o horário checado em outro aparelho,
// a atividade suspensa) sai da fila com o motivo; a falha de rede no meio mantém o resto como está.
import { apagarGuardado, type DonoCofre, guardar, lerGuardado } from './cofre-local.js';

export interface CuidadoNaFila {
  readonly chave: string;
  readonly atendimento: number;
  readonly atividade: number;
  readonly previsto: string;
  readonly feita: boolean;
  readonly motivo: string | null;
  readonly horaReal: string;
  readonly rotulo: string;
}

const FILA = 'fila-cuidados';

export async function lerFilaCuidados(
  dono: DonoCofre,
  prazoHoras: number,
  agora = Date.now(),
): Promise<CuidadoNaFila[]> {
  return (await lerGuardado<CuidadoNaFila[]>(dono, FILA, prazoHoras, agora)) ?? [];
}

/** Acrescenta no fim (a ordem é a do ato); a mesma chave não entra duas vezes. */
export async function guardarCuidado(
  dono: DonoCofre,
  ato: CuidadoNaFila,
  prazoHoras: number,
  agora = Date.now(),
): Promise<CuidadoNaFila[]> {
  const atual = await lerFilaCuidados(dono, prazoHoras, agora);
  if (atual.some((a) => a.chave === ato.chave)) return atual;
  const nova = [...atual, ato];
  await guardar(dono, FILA, nova, agora);
  return nova;
}

export type ResultadoEnvio = { chave: string; ok: true } | { chave: string; ok: false; erro: unknown };

/**
 * Envia a fila na ordem com a função de checagem (que recebe a chave do ato); a falha de rede para o envio e mantém o
 * resto; o ato aceito ou recusado pelo servidor sai da fila. Devolve os resultados e a fila que sobrou.
 */
export async function enviarFilaCuidados(
  dono: DonoCofre,
  prazoHoras: number,
  checar: (a: CuidadoNaFila) => Promise<unknown>,
  semRede: (e: unknown) => boolean,
  agora = Date.now(),
): Promise<{ resultados: ResultadoEnvio[]; resto: CuidadoNaFila[] }> {
  const fila = await lerFilaCuidados(dono, prazoHoras, agora);
  const resultados: ResultadoEnvio[] = [];
  let i = 0;
  for (; i < fila.length; i++) {
    const a = fila[i]!;
    try {
      await checar(a);
      resultados.push({ chave: a.chave, ok: true });
    } catch (e) {
      if (semRede(e)) break;
      resultados.push({ chave: a.chave, ok: false, erro: e });
    }
  }
  const resto = fila.slice(i);
  if (resto.length === 0) await apagarGuardado(dono, FILA);
  else await guardar(dono, FILA, resto, agora);
  return { resultados, resto };
}
