// Fila dos atos feitos sem rede (ficha do M25, regra 8): só a checagem, o sinal vital e a anotação simples; cada ato
// leva a hora real (a do aparelho) e a chave dele (a Idempotency-Key), e vai na ordem em que foi feito. Na volta da
// rede, a fila inteira vai num pedido de sincronização; o servidor relê cada horário e, se houve suspensão ou
// checagem em qualquer um dos dois sistemas, abre o conflito (nunca sobrescreve). O ato aceito, repetido ou que
// virou conflito sai da fila; a falha de rede no meio mantém a fila como está (reenviar não grava duas vezes).
import { apagarGuardado, type DonoCofre, guardar, lerGuardado } from './cofre-local.js';

export type AtoNaFila =
  | {
      readonly tipo: 'checagem';
      readonly chave: string;
      readonly horario: number;
      readonly checagem: Record<string, unknown>;
      readonly rotulo: string;
    }
  | {
      readonly tipo: 'sinal';
      readonly chave: string;
      readonly paciente: number;
      readonly sinal: Record<string, unknown>;
      readonly rotulo: string;
    }
  | {
      readonly tipo: 'anotacao';
      readonly chave: string;
      readonly paciente: number;
      readonly atendimento: number;
      readonly texto: string;
      readonly horaReal: string;
      readonly rotulo: string;
    };

const FILA = 'fila';

export async function lerFila(dono: DonoCofre, prazoHoras: number, agora = Date.now()): Promise<AtoNaFila[]> {
  return (await lerGuardado<AtoNaFila[]>(dono, FILA, prazoHoras, agora)) ?? [];
}

/** Acrescenta o ato no fim (a ordem é a do ato); a mesma chave não entra duas vezes. */
export async function enfileirar(
  dono: DonoCofre,
  ato: AtoNaFila,
  prazoHoras: number,
  agora = Date.now(),
): Promise<AtoNaFila[]> {
  const atual = await lerFila(dono, prazoHoras, agora);
  if (atual.some((a) => a.chave === ato.chave)) return atual;
  const nova = [...atual, ato];
  await guardar(dono, FILA, nova, agora);
  return nova;
}

/** Tira da fila os atos já resolvidos pelo servidor (aceitos, repetidos ou que viraram conflito). */
export async function retirar(
  dono: DonoCofre,
  chaves: readonly string[],
  prazoHoras: number,
  agora = Date.now(),
): Promise<AtoNaFila[]> {
  const fora = new Set(chaves);
  const resto = (await lerFila(dono, prazoHoras, agora)).filter((a) => !fora.has(a.chave));
  if (resto.length === 0) await apagarGuardado(dono, FILA);
  else await guardar(dono, FILA, resto, agora);
  return resto;
}

/** O corpo da sincronização (o formato do servidor: sem o rótulo, que é só da tela). */
export function corpoDaSincronizacao(atos: readonly AtoNaFila[]): unknown[] {
  return atos.map((a) => {
    const { rotulo: _rotulo, ...resto } = a;
    void _rotulo;
    return resto;
  });
}

/** Resolvidos: aceitos, repetidos e conflitos (o conflito fica visível na tela dos conflitos). Erro de rede: fica. */
export function resolvidos(
  resultados: readonly { chave: string; ok: boolean; codigo: string | null; conflito?: number }[],
): string[] {
  return resultados
    .filter((r) => r.ok || r.conflito !== undefined || r.codigo !== 'erro')
    .map((r) => r.chave);
}
