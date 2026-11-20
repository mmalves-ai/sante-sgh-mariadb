// Regra 14 da ficha do M09 (cancelamento.int.spec.ts): consulta que estoura o limite é cancelada pelo driver
// e a conexão volta ao pool; o pool tem teto baixo por estabelecimento (pedido acima do teto espera e estoura
// com erro claro, sem abrir conexão a mais). Só catálogo RDB$, nenhuma tabela de negócio, nada gravado.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigos, contexto, criarNucleoIntegracao } from './integracao.spec-util.js';
import type { NucleoLegado } from './legado.js';
import { ErroPool } from './pool.js';
import { ErroTempoEsgotado } from './transacao.js';

const PESADA =
  'SELECT COUNT(*) N FROM RDB$RELATION_FIELDS a CROSS JOIN RDB$RELATION_FIELDS b CROSS JOIN RDB$RELATIONS c';

describe.each(codigos)('cancelamento e teto do pool — estabelecimento %s', (cod) => {
  let nucleo: NucleoLegado;
  beforeAll(() => {
    nucleo = criarNucleoIntegracao({ FB_POOL_TETO: '2', FB_POOL_ESPERA_MS: '500' });
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('duas consultas pesadas em paralelo (o teto do pool): todas canceladas no limite, conexões reaproveitadas', async () => {
    const ctx = contexto(cod, nucleo.rede);
    const inicio = performance.now();
    const r = await Promise.allSettled(
      [1, 2].map(() => nucleo.lerSomente(ctx, (l) => l.consultar(PESADA, [], { tempoMaximoMs: 400 }))),
    );
    const ms = performance.now() - inicio;
    expect(r.every((x) => x.status === 'rejected' && x.reason instanceof ErroTempoEsgotado)).toBe(true);
    expect(ms).toBeLessThan(5_000);
    const pool = nucleo.estadosDosPools().find((p) => p.estabelecimento === cod)!;
    expect(pool.emUso).toBe(0);
    expect(pool.abertas).toBeLessThanOrEqual(2);
    expect((await nucleo.consultar(ctx, 'SELECT 1 X FROM RDB$DATABASE'))[0]?.['X']).toBe(1);
    console.log(
      `[${cod}] 2 consultas pesadas canceladas em ${Math.round(ms)} ms; pool ${pool.abertas} abertas, 0 em uso`,
    );
  });

  it('pedido acima do teto espera e estoura com ErroPool (nunca abre a 3ª conexão)', async () => {
    const ctx = contexto(cod, nucleo.rede);
    const seguras = [1, 2].map(() =>
      nucleo.lerSomente(ctx, () => new Promise((resolver) => setTimeout(resolver, 1_200))),
    );
    await new Promise((r) => setTimeout(r, 100));
    await expect(nucleo.consultar(ctx, 'SELECT 1 X FROM RDB$DATABASE')).rejects.toBeInstanceOf(ErroPool);
    expect(nucleo.estadosDosPools().find((p) => p.estabelecimento === cod)!.abertas).toBeLessThanOrEqual(2);
    await Promise.all(seguras);
  });
});
