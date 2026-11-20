// M59 (etapa 6) na cópia: o catálogo do banco para o plano de evolução do modelo (ADR 0033), READ ONLY e só estrutura
// (nenhum valor de linha). Mede o tamanho de cada passo pela mesma regra do painel e prova a premissa da
// retrocompatibilidade: nenhum gatilho SGH_ em tabela do outro sistema e todas as tabelas clínicas da matriz presentes.
// Os agregados vão para o arquivo de SGH_M59_6_SAIDA, se houver (o console não aparece no vitest de integração).
import { writeFileSync } from 'node:fs';
import { TABELAS_CLINICAS_LEGADO } from '@sgh/contratos';
import { medirInventarioRetrocompatibilidade } from '@sgh/dominio-config';
import { lerCatalogoRetrocompatibilidade } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('M59 (etapa 6): catálogo da retrocompatibilidade na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('inventário do plano pelo catálogo; 0 gatilho SGH_ em tabela do outro sistema', async () => {
    const t0 = performance.now();
    const cat = await a.nucleo.lerSomente(ctx(a), (l) => lerCatalogoRetrocompatibilidade(l));
    const ms = Math.round(performance.now() - t0);
    const inv = medirInventarioRetrocompatibilidade(cat, TABELAS_CLINICAS_LEGADO);

    expect(inv.tabelas).toBeGreaterThan(1000);
    expect(cat.tabelas.some((t) => t.startsWith('SGH_'))).toBe(true);
    expect(inv.gatilhosSghEmTabelaLegada).toBe(0);
    expect(inv.tabelasClinicas.presentes).toBe(inv.tabelasClinicas.matriz);
    expect(inv.gatilhos.total).toBeGreaterThan(0);
    expect(inv.gatilhos.ativos).toBeLessThanOrEqual(inv.gatilhos.total);
    expect(inv.colunasDeUmaLetra.colunas).toBeGreaterThan(0);
    expect(inv.chavesEmTexto.chaves).toBeLessThanOrEqual(inv.chavesEmTexto.deTotal);
    expect(ms).toBeLessThan(120_000);

    const saida = process.env['SGH_M59_6_SAIDA'];
    if (saida) writeFileSync(saida, JSON.stringify({ ms, inventario: inv }, null, 2));
  }, 180_000);
});
