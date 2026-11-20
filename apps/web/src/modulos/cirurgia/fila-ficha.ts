// Ficha anestésica sem rede (M46, etapa 1; ficha, seção 7: a ficha é tela de tablet na sala): sem rede, o lote de
// lançamentos, o marco de tempo ou o fim de um lançamento ficam no cofre cifrado do aparelho (o mesmo do M25), do dono da
// sessão, com a chave do ato (Idempotency-Key). Na volta da rede, os atos vão na ordem, cada um com a MESMA chave:
// reenviar não grava duas vezes (o servidor devolve o que já gravou). O ato recusado pelo servidor sai da fila com o
// motivo; a falha de rede no meio mantém o resto. Os horários são os do momento do ato (a grade de 5 minutos fica certa).
import { apagarGuardado, type DonoCofre, guardar, lerGuardado } from '../enfermagem/cofre-local.js';

export interface AtoDaFicha {
  readonly chave: string;
  readonly agenda: number;
  /** O caminho da gravação abaixo de /api/cirurgia/anestesia (ex.: /701/ficha/lancamentos). */
  readonly url: string;
  readonly corpo: Record<string, unknown>;
  readonly rotulo: string;
}

const FILA = 'fila-ficha-anestesica';

export async function lerFilaFicha(
  dono: DonoCofre,
  prazoHoras: number,
  agora = Date.now(),
): Promise<AtoDaFicha[]> {
  return (await lerGuardado<AtoDaFicha[]>(dono, FILA, prazoHoras, agora)) ?? [];
}

/** Acrescenta no fim (a ordem é a do ato); a mesma chave não entra duas vezes. */
export async function guardarAtoFicha(
  dono: DonoCofre,
  ato: AtoDaFicha,
  prazoHoras: number,
  agora = Date.now(),
): Promise<AtoDaFicha[]> {
  const atual = await lerFilaFicha(dono, prazoHoras, agora);
  if (atual.some((a) => a.chave === ato.chave)) return atual;
  const nova = [...atual, ato];
  await guardar(dono, FILA, nova, agora);
  return nova;
}

export type EnvioDoAto = { chave: string; ok: true } | { chave: string; ok: false; erro: unknown };

/** Envia a fila na ordem; a falha de rede para e mantém o resto; o aceito ou recusado sai. */
export async function enviarFilaFicha(
  dono: DonoCofre,
  prazoHoras: number,
  gravar: (a: AtoDaFicha) => Promise<unknown>,
  semRede: (e: unknown) => boolean,
  agora = Date.now(),
): Promise<{ resultados: EnvioDoAto[]; resto: AtoDaFicha[] }> {
  const fila = await lerFilaFicha(dono, prazoHoras, agora);
  const resultados: EnvioDoAto[] = [];
  let i = 0;
  for (; i < fila.length; i++) {
    const a = fila[i]!;
    try {
      await gravar(a);
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
