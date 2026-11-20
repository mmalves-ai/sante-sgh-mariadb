// Regra 5 da ficha do M20: o caráter do atendimento é obrigatório no novo e gravado como o legado grava (CARACTERS 2
// eletivo, 3 urgência: o caráter TISS mais 1; o gatilho da conta grava a ocorrência U quando é 3). Valores antigos
// nulos, 0, 1 e 4 são mostrados como "não informado".
import { CARATERES, type Carater, caraterLido } from '@sgh/contratos';

export function caraterGravado(c: Carater): number {
  const x = CARATERES.find((k) => k.codigo === c);
  if (!x) throw new Error(`Caráter desconhecido: ${String(c)}.`);
  return x.gravado;
}

export function rotuloCarater(gravado: number | null | undefined): string {
  const c = caraterLido(gravado);
  return c ? (CARATERES.find((k) => k.codigo === c)?.rotulo ?? 'Não informado') : 'Não informado';
}

/** O caráter sugerido pelo tipo (o pronto atendimento é urgência; os demais, eletivos): a pessoa confirma. */
export function caraterSugerido(tipo: string): Carater {
  return tipo === 'pa' ? 'urgencia' : 'eletivo';
}
