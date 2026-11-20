// Dublê de Escritor para os testes unitários do executor e das receitas (nada conecta a banco): cada comando
// passa por um respondedor; os comandos ficam anotados para conferência. Dados sintéticos.
import type { Linha } from './driver.js';
import type { DependenciasExecutor } from './executor.js';
import type { Escritor } from './transacao.js';

export interface Comando {
  readonly tipo: 'consultar' | 'executar' | 'retornando';
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

export type Respondedor = (c: Comando) => Linha[] | number | Linha | Promise<Linha[] | number | Linha>;

export function escritorDuble(responder: Respondedor = () => []): Escritor & { comandos: Comando[] } {
  const comandos: Comando[] = [];
  const rodar = async (c: Comando) => {
    comandos.push(c);
    return responder(c);
  };
  return {
    hospital: 'pc',
    comandos,
    async consultar<T extends Linha>(sql: string, parametros: readonly unknown[] = []): Promise<T[]> {
      const r = await rodar({ tipo: 'consultar', sql, parametros });
      return (Array.isArray(r) ? r : []) as T[];
    },
    async lerBlob() {
      return Buffer.alloc(0);
    },
    async executar(sql: string, parametros: readonly unknown[] = []) {
      const r = await rodar({ tipo: 'executar', sql, parametros });
      return typeof r === 'number' ? r : 1;
    },
    async executarRetornando(sql: string, parametros: readonly unknown[] = []) {
      const r = await rodar({ tipo: 'retornando', sql, parametros });
      return (Array.isArray(r) ? (r[0] ?? {}) : typeof r === 'number' ? {} : r) as Linha;
    },
  };
}

export interface Registro {
  confirmadas: number;
  desfeitas: number;
  leituras: number;
}

/** Dependências do executor sobre o dublê: escrever confirma no fim (ou desfaz em erro / confirmar=false). */
export function depsDuble(
  e: Escritor,
  extra: Partial<DependenciasExecutor> = {},
): { deps: DependenciasExecutor; registro: Registro } {
  const registro: Registro = { confirmadas: 0, desfeitas: 0, leituras: 0 };
  const deps: DependenciasExecutor = {
    ambiente: 'dev',
    catalogo: { estado: () => 'especificada' },
    schema: { bloqueada: () => false },
    async ler(_ctx, fn) {
      registro.leituras++;
      return fn(e);
    },
    async escrever(_ctx, fn, confirmar) {
      try {
        const r = await fn(e);
        if (confirmar) registro.confirmadas++;
        else registro.desfeitas++;
        return r;
      } catch (erro) {
        registro.desfeitas++;
        throw erro;
      }
    },
    ...extra,
  };
  return { deps, registro };
}
