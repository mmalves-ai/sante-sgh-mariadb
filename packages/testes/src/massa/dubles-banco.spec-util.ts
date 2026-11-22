// Dublê de Leitor/Escritor (@sgh/nucleo) para os specs de unidade da massa: guarda cada SQL com os parâmetros e
// responde pela função dada. Nada fala com o banco.
import type { Escritor, Linha } from '@sgh/nucleo';

export interface Chamada {
  readonly tipo: 'consultar' | 'executar' | 'travar' | 'inserir';
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

export function dubleEscritor(
  responder: (c: Chamada) => Linha[] | number = () => [],
): Escritor & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const linhas = (c: Chamada) => {
    chamadas.push(c);
    const r = responder(c);
    return Array.isArray(r) ? r : [];
  };
  const numero = (c: Chamada) => {
    chamadas.push(c);
    const r = responder(c);
    return typeof r === 'number' ? r : 1;
  };
  return {
    cliente: 'duble',
    chamadas,
    consultar: async <T extends Linha = Linha>(sql: string, p: readonly unknown[] = []) =>
      linhas({ tipo: 'consultar', sql, parametros: p }) as T[],
    uma: async <T extends Linha = Linha>(sql: string, p: readonly unknown[] = []) =>
      (linhas({ tipo: 'consultar', sql, parametros: p })[0] ?? null) as T | null,
    executar: async (sql: string, p: readonly unknown[] = []) =>
      numero({ tipo: 'executar', sql, parametros: p }),
    inserir: async (sql: string, p: readonly unknown[] = []) =>
      numero({ tipo: 'inserir', sql, parametros: p }),
    executarRetornando: async (sql: string, p: readonly unknown[] = []) =>
      linhas({ tipo: 'executar', sql, parametros: p })[0] ?? {},
    consultarParaAtualizar: async <T extends Linha = Linha>(sql: string, p: readonly unknown[] = []) =>
      linhas({ tipo: 'travar', sql, parametros: p }) as T[],
  };
}

/** Sintaxe do banco de origem que não pode voltar (FIRST n, WITH LOCK, DATEADD, S/N). */
export const SINTAXE_ANTIGA = /\bSELECT\s+FIRST\b|\bWITH\s+LOCK\b|\bDATEADD\b|=\s*'[SNTF]'/i;
