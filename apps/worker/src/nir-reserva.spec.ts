// M44 (etapa 2), regra 11, no `worker` (lote F2.2 05-15): a reserva vencida expira UMA vez, a solicitação reservada ou
// a caminho volta à análise; o segundo ciclo não expira de novo; o consumidor que perde a disputa desiste sem erro; a
// falha de leitura de um estabelecimento não para o ciclo. A porta própria é um dublê (nada conecta a banco); a prova
// sobre o MariaDB é a nir-reserva.int.spec.ts.
import { describe, expect, it } from 'vitest';
import type { PortaNir } from './nir-reserva-propria.js';
import { cicloExpiracao, expiracaoLigada, NirReservaService } from './nir-reserva.service.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

const EST: AlvoEstabelecimento = { cliente: 'cli_teste', id: 7, codigo: 'pc', fuso: 'America/Sao_Paulo' };
const AGORA = new Date('2026-10-24T13:00:00.000Z');

function porta(opcoes: { travada?: boolean } = {}) {
  const vigentes = new Map([
    [1, { solicitacao: 10, validaAte: '2026-10-24T12:00:00.000Z' }],
    [2, { solicitacao: 20, validaAte: '2026-10-24T14:00:00.000Z' }],
    [3, { solicitacao: 30, validaAte: '2026-10-24T12:30:00.000Z' }],
  ]);
  const solicitacoes = new Map([
    [10, 'reservado'],
    [20, 'reservado'],
    [30, 'em_transito'],
  ]);
  const p: PortaNir = {
    estabelecimentos: async () => [EST],
    vencidas: async (_e, agora) =>
      [...vigentes.entries()]
        .filter(([, r]) => r.validaAte < agora.toISOString())
        .map(([id, r]) => ({ id, solicitacao: r.solicitacao, leito: id, validaAte: r.validaAte })),
    expirar: async (_e, id, agora) => {
      if (opcoes.travada) return { expirou: false, voltouAnalise: false };
      const r = vigentes.get(id);
      if (!r || r.validaAte >= agora.toISOString()) return { expirou: false, voltouAnalise: false };
      vigentes.delete(id);
      const volta = ['reservado', 'em_transito'].includes(solicitacoes.get(r.solicitacao) ?? '');
      if (volta) solicitacoes.set(r.solicitacao, 'em_analise');
      return { expirou: true, voltouAnalise: volta };
    },
  };
  return { p, vigentes, solicitacoes };
}

describe('expiração das reservas do NIR', () => {
  it('as vencidas expiram uma vez; a reservada e a em trânsito voltam à análise (regra 11)', async () => {
    const { p, vigentes, solicitacoes } = porta();
    expect(await cicloExpiracao(p, EST, AGORA)).toEqual({ vencidas: 2, expiradas: 2, voltaramAnalise: 2 });
    expect(solicitacoes.get(10)).toBe('em_analise');
    expect(solicitacoes.get(30)).toBe('em_analise');
    expect(vigentes.has(2)).toBe(true);
    expect(await cicloExpiracao(p, EST, AGORA)).toEqual({ vencidas: 0, expiradas: 0, voltaramAnalise: 0 });
  });

  it('o consumidor que perde a disputa (linha travada) desiste sem erro', async () => {
    expect(await cicloExpiracao(porta({ travada: true }).p, EST, AGORA)).toEqual({
      vencidas: 2,
      expiradas: 0,
      voltaramAnalise: 0,
    });
  });

  it('ligado fora de dev/ci; em dev/ci só com NIR_EXPIRACAO=ligado; o serviço com a porta de teste', async () => {
    expect(expiracaoLigada({ AMBIENTE: 'producao' })).toBe(true);
    expect(expiracaoLigada({ AMBIENTE: 'producao', NIR_EXPIRACAO: 'desligado' })).toBe(false);
    expect(expiracaoLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(expiracaoLigada({ AMBIENTE: 'ci', NIR_EXPIRACAO: 'ligado' })).toBe(true);
    const s = new NirReservaService();
    expect(await s.ciclo()).toEqual([]);
    const plataforma = { lerPlataforma: async () => [] as never, encerrar: async () => undefined };
    const antes = process.env['WORKER_CLIENTES'];
    process.env['WORKER_CLIENTES'] = 'cli_teste';
    try {
      s.usar(plataforma, () => porta().p);
      expect(await s.ciclo(AGORA)).toEqual([{ cliente: 'cli_teste', estabelecimento: 'pc', expiradas: 2 }]);
      s.usar(plataforma, () => ({ ...porta().p, vencidas: async () => Promise.reject(new Error('x')) }));
      expect(await s.ciclo(AGORA)).toEqual([]);
    } finally {
      if (antes === undefined) delete process.env['WORKER_CLIENTES'];
      else process.env['WORKER_CLIENTES'] = antes;
    }
    await s.onApplicationShutdown();
  });
});
