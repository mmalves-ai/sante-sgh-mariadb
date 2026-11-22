// Unidade do vigia dos arquivos (ADR 0004): configuração, alertas de falta, divergência e espaço baixo, falha de um
// cliente sem derrubar a rodada. Sem banco e sem disco (núcleo, armazém e medidor dublês).
import type { VerificacaoCliente } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  VigiaArquivosService,
  alertasDaVerificacao,
  lerConfiguracaoVigiaArquivos,
} from './vigia-arquivos.service.js';

const verif = (cliente: string, p: Partial<VerificacaoCliente> = {}): VerificacaoCliente => ({
  cliente,
  conferidos: 10,
  integros: 10,
  faltando: [],
  divergentes: [],
  gravaveis: [],
  totalFaltando: 0,
  totalDivergentes: 0,
  totalGravaveis: 0,
  ...p,
});

describe('vigia dos arquivos', () => {
  it('não sobe sem ARQUIVOS_RAIZ ou desligado; padrões de intervalo e limite', () => {
    expect(lerConfiguracaoVigiaArquivos({})).toBeNull();
    expect(lerConfiguracaoVigiaArquivos({ ARQUIVOS_RAIZ: '/srv/a', VIGIA_ARQUIVOS: 'desligado' })).toBeNull();
    expect(lerConfiguracaoVigiaArquivos({ ARQUIVOS_RAIZ: '/srv/a' })).toEqual({
      raiz: '/srv/a',
      intervaloMs: 6 * 3_600_000,
      alertaLivreBytes: 20 * 1024 ** 3,
    });
    expect(() => lerConfiguracaoVigiaArquivos({ ARQUIVOS_RAIZ: 'relativa' })).toThrow();
  });

  it('alerta falta, divergência e somente leitura perdido, só com ids', () => {
    const a = alertasDaVerificacao(
      verif('c1', {
        totalFaltando: 2,
        faltando: [3, 4],
        totalDivergentes: 1,
        divergentes: [9],
        totalGravaveis: 1,
        gravaveis: [5],
      }),
    );
    expect(a.map((x) => [x.tipo, x.quantidade, x.ids])).toEqual([
      ['arquivo_faltando', 2, [3, 4]],
      ['arquivo_divergente', 1, [9]],
      ['arquivo_gravavel', 1, [5]],
    ]);
    expect(alertasDaVerificacao(verif('c1'))).toEqual([]);
  });

  it('uma rodada: espaço baixo, cliente com divergência e cliente em falha', async () => {
    const s = new VigiaArquivosService();
    const nucleo = { lerPlataforma: async () => [] as never };
    s.usar(
      nucleo,
      {
        verificarCliente: async (ctx) => {
          if (ctx.cliente === 'c_falha') throw new Error('fora');
          return verif(ctx.cliente, { totalDivergentes: 1, divergentes: [7] });
        },
      },
      { raiz: '/srv/a', intervaloMs: 60_000, alertaLivreBytes: 20 * 1024 ** 3 },
      { medir: () => 5 * 1024 ** 3, env: { WORKER_CLIENTES: 'c_ok,c_falha' } },
    );
    const r = await s.ciclo();
    expect(r?.livreBytes).toBe(5 * 1024 ** 3);
    expect(r?.alertas.map((a) => `${a.tipo}:${a.cliente ?? '-'}`)).toEqual([
      'espaco_baixo:-',
      'arquivo_divergente:c_ok',
      'falha:c_falha',
    ]);
    expect(s.ultimaRodada()).toBe(r);
  });
});
