// Banco por roteiro para os testes unitários das receitas do prontuário (M23): nada conecta a banco; cada comando
// passa pelas regras (expressão sobre o SQL → resposta), a regra mais nova vale primeiro; sem regra, a consulta
// devolve nenhuma linha, o comando afeta 1 linha e o RETURNING devolve os IDs seguintes. Relógio, sequências e a
// SGH_TRILHA já respondem. Dados sintéticos.
import type { Linha } from './driver.js';
import type { TxOperacao } from './operacao.js';

export interface ChamadaRoteiro {
  readonly tipo: 'consultar' | 'executar' | 'retornando';
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

type Resposta = Linha[] | number | Linha | ((p: readonly unknown[], sql: string) => Linha[] | number | Linha);

export const AGORA_ROTEIRO = new Date(2026, 9, 21, 10, 0, 0);

export class BancoRoteiro {
  readonly chamadas: ChamadaRoteiro[] = [];
  private readonly regras: { re: RegExp; r: Resposta }[] = [];
  private seq = 1000;
  agora: Date = AGORA_ROTEIRO;

  /** Regra nova (vale antes das anteriores). */
  quando(re: RegExp, r: Resposta): this {
    this.regras.unshift({ re, r });
    return this;
  }

  /** Os comandos que casam com a expressão. */
  de(re: RegExp, tipo?: ChamadaRoteiro['tipo']): ChamadaRoteiro[] {
    return this.chamadas.filter((c) => re.test(c.sql.replace(/\s+/g, ' ')) && (!tipo || c.tipo === tipo));
  }

  proximo(): number {
    return ++this.seq;
  }

  private responder(c: ChamadaRoteiro): Linha[] | number | Linha | undefined {
    const s = c.sql.replace(/\s+/g, ' ');
    const regra = this.regras.find((x) => x.re.test(s));
    if (regra) return typeof regra.r === 'function' ? regra.r(c.parametros, s) : regra.r;
    if (s.includes('CURRENT_TIMESTAMP AGORA')) return [{ AGORA: this.agora }];
    if (s.includes('NEXT VALUE FOR SGH_GEN_TRILHA'))
      return [{ ID: String(this.proximo()), H: '2026-10-21 10:00:00.0000', D: '2026-10-21' }];
    if (s.includes('NEXT VALUE FOR')) return [{ ID: this.proximo() }];
    return undefined;
  }

  tx(): TxOperacao {
    const rodar = (c: ChamadaRoteiro) => {
      this.chamadas.push(c);
      return this.responder(c);
    };
    const consultar = async <T extends Linha>(sql: string, parametros: readonly unknown[] = []) => {
      const r = rodar({ tipo: 'consultar', sql, parametros });
      return (Array.isArray(r) ? r : r && typeof r === 'object' ? [r] : []) as T[];
    };
    return {
      hospital: 'pc',
      consultar,
      uma: async (sql: string, parametros: readonly unknown[] = []) =>
        (await consultar(sql, parametros))[0] ?? null,
      lerBlob: async (b: unknown) =>
        Buffer.isBuffer(b) ? b : b instanceof Uint8Array ? Buffer.from(b) : Buffer.from(String(b ?? '')),
      executar: async (sql: string, parametros: readonly unknown[] = []) => {
        const r = rodar({ tipo: 'executar', sql, parametros });
        return typeof r === 'number' ? r : 1;
      },
      executarRetornando: async (sql: string, parametros: readonly unknown[] = []) => {
        const r = rodar({ tipo: 'retornando', sql, parametros });
        if (r && !Array.isArray(r) && typeof r === 'object') return r as Linha;
        if (Array.isArray(r) && r[0]) return r[0];
        const id = this.proximo();
        return { ID: id, ID_RECEITA: id, ID_AGRUPAMENTO: 9000 + id };
      },
    };
  }
}
