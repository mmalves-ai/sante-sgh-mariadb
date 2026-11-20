// Regra 5 da ficha do M02 sobre a cópia: consulta acima do tempo é cancelada pelo driver e a conexão
// volta ao pool, pronta para a próxima consulta. Só leitura (catálogo RDB$, nenhum dado de linha).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigos, contexto, criarNucleoIntegracao } from './integracao.spec-util.js';
import type { NucleoLegado } from './legado.js';
import { ErroTempoEsgotado, ErroTetoLinhas } from './transacao.js';

// Produto cartesiano do catálogo: segundos de CPU no servidor, sem tocar em tabela do legado.
const PESADA =
  'SELECT COUNT(*) N FROM RDB$RELATION_FIELDS a CROSS JOIN RDB$RELATION_FIELDS b CROSS JOIN RDB$RELATIONS c';

describe.each(codigos)('transação de leitura — estabelecimento %s', (cod) => {
  let nucleo: NucleoLegado;
  beforeAll(() => {
    nucleo = criarNucleoIntegracao({ FB_POOL_TETO: '1' });
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('consulta acima do tempo é cancelada e a conexão volta ao pool', async () => {
    const ctx = contexto(cod, nucleo.rede);
    const [antes] = await nucleo.consultar(ctx, 'SELECT CURRENT_CONNECTION C FROM RDB$DATABASE');
    const inicio = performance.now();
    await expect(
      nucleo.lerSomente(ctx, (l) => l.consultar(PESADA, [], { tempoMaximoMs: 300 })),
    ).rejects.toBeInstanceOf(ErroTempoEsgotado);
    const ms = performance.now() - inicio;
    expect(ms).toBeLessThan(5_000);
    const pool = nucleo.estadosDosPools().find((p) => p.estabelecimento === cod);
    expect(pool).toMatchObject({ abertas: 1, livres: 1, emUso: 0 });
    const [depois] = await nucleo.consultar(ctx, 'SELECT CURRENT_CONNECTION C FROM RDB$DATABASE');
    expect(depois?.['C']).toBe(antes?.['C']); // a mesma conexão, reaproveitada
    console.log(`[${cod}] consulta cancelada em ${Math.round(ms)} ms; conexão reaproveitada`);
  });

  it('teto de linhas é obrigatório: passou, é erro', async () => {
    const ctx = contexto(cod, nucleo.rede);
    await expect(
      nucleo.consultar(ctx, 'SELECT r.RDB$RELATION_NAME FROM RDB$RELATIONS r', [], { teto: 10 }),
    ).rejects.toBeInstanceOf(ErroTetoLinhas);
  });
});
