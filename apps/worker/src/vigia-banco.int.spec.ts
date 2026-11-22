// Vigia do banco próprio contra o MariaDB real (lote F2.2 05-17): a saúde responde e a coleta das transações devolve
// contagens (ou null, sem o privilégio PROCESS). Só leitura; nada é gravado. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, describe, expect, it } from 'vitest';
import { SEM_BANCO } from './importadores/integracao.spec-util.js';
import { VigiaBancoService } from './vigia-banco.service.js';

describe.skipIf(SEM_BANCO)('vigia do banco próprio sobre o MariaDB', () => {
  const nucleo = SEM_BANCO ? null : new NucleoProprio();
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('a rodada mede a plataforma e as transações sem falhar', async () => {
    const s = new VigiaBancoService();
    s.usar(
      {
        saude: () => nucleo!.saude(),
        lerPlataforma: (c, fn) => nucleo!.lerPlataforma(c, fn),
        encerrar: async () => undefined,
      },
      async () => new Map(),
    );
    const r = await s.ciclo();
    expect(r?.plataforma).toBe(true);
    if (r?.transacoes) {
      expect(r.transacoes.abertas).toBeGreaterThanOrEqual(0);
      expect(r.transacoes.maisLongaMs).toBeGreaterThanOrEqual(0);
    } else expect(r?.transacoes).toBeNull();
  });
});
