// Fonte da linha de base de carga sobre o banco próprio do cliente (o núcleo): o estabelecimento da carga é o primeiro
// ativo do cliente, e as leituras vão pelo caminho somente leitura do núcleo.
import type { Leitor } from '@sgh/nucleo';
import type { EstabelecimentoCarga, FonteCarga } from './carga.controller.js';

/** O mínimo do núcleo que a fonte usa (a leitura somente). */
export interface NucleoCarga {
  lerSomente<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (l: Leitor) => Promise<T>): Promise<T>;
}

export class FonteCargaPropria implements FonteCarga {
  constructor(
    private readonly nucleo: NucleoCarga,
    readonly cliente: string,
  ) {}

  lerSomente<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (l: Leitor) => Promise<T>) {
    return this.nucleo.lerSomente(contexto, fn);
  }

  async estabelecimento(): Promise<EstabelecimentoCarga | null> {
    const r = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'carga-estabelecimento' }, (l) =>
      l.uma<{ id: number | string; codigo: string }>(
        'SELECT id, codigo FROM estabelecimento WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY id LIMIT 1',
        [],
      ),
    );
    return r ? { id: Number(r.id), codigo: r.codigo } : null;
  }
}
