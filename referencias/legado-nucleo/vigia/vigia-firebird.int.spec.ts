// Regra 13 da ficha do M09 (vigia-firebird.int.spec.ts): transação do novo segurada de propósito na cópia
// (só leitura) acima do limite gera alerta direto que aponta a conexão responsável; a coleta MON$ fica abaixo
// de 200 ms e nunca lê texto SQL. Nada é gravado: as duas transações são de leitura.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigos, contexto, criarNucleoIntegracao } from '../integracao.spec-util.js';
import type { NucleoLegado } from '../legado.js';
import { coletar } from './coletor.js';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.each(codigos)('coletor MON$ — estabelecimento %s', (cod) => {
  let nucleo: NucleoLegado;
  beforeAll(() => {
    nucleo = criarNucleoIntegracao({ FB_POOL_TETO: '2', SGH_PROCESSO: 'teste-vigia' });
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('transação segurada acima do limite → alerta com a conexão; coleta < 200 ms', async () => {
    const ctx = contexto(cod, nucleo.rede);
    let anexoSegurado = 0;
    const limite = 1_000;
    const segurar = nucleo.lerSomente(ctx, async (l) => {
      const [r] = await l.consultar('SELECT CURRENT_CONNECTION C FROM RDB$DATABASE');
      anexoSegurado = Number(r?.['C']);
      await espera(2.5 * limite);
    });
    await espera(1.6 * limite);
    const coletas = [];
    for (let i = 0; i < 3; i++)
      coletas.push(
        await nucleo.lerSomente(ctx, (l) => coletar(l, { estabelecimento: cod, limiteTransacaoMs: limite })),
      );
    await segurar;
    const c = coletas[0]!;
    const alerta = c.alertas.find((a) => a.tipo === 'transacao-longa' && a.anexo === anexoSegurado);
    expect(alerta).toBeDefined();
    expect(alerta?.marca).toBe(`sgh:${nucleo.rede}:${cod}:teste-vigia`);
    expect(alerta!.duracaoMs!).toBeGreaterThan(limite);
    const novo = c.porSistema.find((s) => s.sistema === 'novo')!;
    expect(novo.conexoes).toBeGreaterThanOrEqual(1);
    expect(c.banco.proxima).toBeGreaterThanOrEqual(c.banco.oit);
    const tempos = coletas.map((x) => x.duracaoMs);
    console.log(
      `[${cod}] coletas MON$ em ${tempos.join(', ')} ms; alerta transacao-longa no anexo do teste (${Math.round(alerta!.duracaoMs! / 100) / 10} s > ${limite / 1000} s); ` +
        `sistemas: ${c.porSistema.map((s) => `${s.sistema}=${s.conexoes}`).join(' ')}; ` +
        `travas ${c.porSistema.map((s) => `${s.sistema}=${s.travas}/${s.esperasPorTrava}/${s.conflitos}`).join(' ')}; folga OIT ${c.banco.folgaOit}, OAT ${c.banco.folgaOat}`,
    );
    // A meta (< 200 ms) vale para cada coleta, não só para a mais rápida.
    expect(Math.max(...tempos)).toBeLessThan(200);
    // Travas por sistema (MON$RECORD_STATS) lidas: contadores numéricos, nunca negativos.
    for (const s of c.porSistema) {
      expect(Number.isFinite(s.travas) && s.travas >= 0).toBe(true);
      expect(Number.isFinite(s.esperasPorTrava) && s.esperasPorTrava >= 0).toBe(true);
      expect(s.comandosParados).toBeGreaterThanOrEqual(0);
    }
    // Depois de fechada, a transação some do alerta.
    const depois = await nucleo.lerSomente(ctx, (l) =>
      coletar(l, { estabelecimento: cod, limiteTransacaoMs: limite }),
    );
    expect(depois.alertas.some((a) => a.anexo === anexoSegurado)).toBe(false);
  });
});
