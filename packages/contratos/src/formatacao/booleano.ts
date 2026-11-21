// Booleano neutro do produto (F2.4): sim/não trafega como boolean no contrato, na API e na tela, e é BOOLEAN
// (TINYINT 0/1) no banco. Marcas de texto do sistema de origem são convertidas pelo conector, nunca aqui.
import { z } from 'zod';
import { ErroValidacao } from '../validacao/erro.js';

/** Contrato: booleano estrito. */
export const esquemaBooleano = z.boolean();

/**
 * Parâmetro de consulta (query string) → booleano: "true"/"false" e "1"/"0" (também o próprio boolean). Ausente
 * fica ausente; qualquer outro texto é recusado (nunca vira falso em silêncio).
 */
export const esquemaBooleanoConsulta = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1'),
]);

/** Valor lido do banco (BOOLEAN/TINYINT: 0, 1, "0", "1", boolean ou null) → boolean ou null. Lança no resto. */
export function booleanoDoBanco(valor: unknown): boolean | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'boolean') return valor;
  if (valor === 1 || valor === '1' || valor === 1n) return true;
  if (valor === 0 || valor === '0' || valor === 0n) return false;
  throw new ErroValidacao(
    'booleano.valor',
    { entrada: String(valor) },
    `Valor booleano inválido vindo do banco: "${String(valor)}".`,
  );
}

/** boolean → 0/1 para gravar em BOOLEAN; null passa como null. */
export function booleanoParaBanco(valor: boolean | null): 0 | 1 | null {
  return valor === null ? null : valor ? 1 : 0;
}

/** Texto de tela para o booleano ("Sim"/"Não"); null → "" (não informado). */
export function formatarBooleano(valor: boolean | null | undefined): string {
  return valor === null || valor === undefined ? '' : valor ? 'Sim' : 'Não';
}
