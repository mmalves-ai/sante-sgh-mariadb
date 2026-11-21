// A leitura do período do `contabil:reprocessar` sobre um dublê da porta: teto e parcial, os gravados só dos fatos
// contabilizados sem estorno, as regras tiradas das publicadas e a entrada da linha de comando conferida.
import { describe, expect, it } from 'vitest';
import {
  contextoDe,
  type FonteDoPeriodo,
  lerPeriodo,
  type NucleoDaConferencia,
  pedidoDe,
  reprocessar,
  SAIDA,
} from './reprocessar.ts';

function dubleDe(fatos: { idFato: number; situacao: string; estorno?: boolean }[]) {
  const pedidos: { teto?: number; ids?: readonly number[] } = {};
  const fonte = {
    async fatosDaCompetencia(_c: unknown, _e: number, _k: string, teto: number) {
      pedidos.teto = teto;
      return fatos.slice(0, teto);
    },
    async plano() {
      return [];
    },
    async dePara() {
      return [];
    },
    async regras() {
      return [{ regra: { nome: 'r1' } }];
    },
    async lancamentosDosFatos(_c: unknown, ids: readonly number[]) {
      pedidos.ids = ids;
      return new Map();
    },
  } as unknown as FonteDoPeriodo;
  return { fonte, pedidos };
}

const c = contextoDe({ cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5', estabelecimento: 1 });

describe('lerPeriodo', () => {
  it('pede um a mais que o teto e marca parcial quando passa', async () => {
    const { fonte, pedidos } = dubleDe([1, 2, 3].map((idFato) => ({ idFato, situacao: 'pendente' })));
    const l = await lerPeriodo(fonte, c, 1, '2026-01', 2);
    expect(pedidos.teto).toBe(3);
    expect(l.parcial).toBe(true);
    expect(l.fatos).toHaveLength(2);
    expect(l.regras).toEqual([{ nome: 'r1' }]);
  });

  it('busca os gravados só dos fatos contabilizados sem estorno', async () => {
    const { fonte, pedidos } = dubleDe([
      { idFato: 1, situacao: 'contabilizado' },
      { idFato: 2, situacao: 'contabilizado', estorno: true },
      { idFato: 3, situacao: 'pendente' },
    ]);
    const l = await lerPeriodo(fonte, c, 1, '2026-01');
    expect(pedidos.ids).toEqual([1]);
    expect(l.parcial).toBe(false);
  });
});

describe('pedidoDe', () => {
  it('confere período, cliente e estabelecimento', () => {
    expect(pedidoDe({ periodo: '2026-13', cliente: 'x', estabelecimento: '1' })).toMatch(/periodo/);
    expect(pedidoDe({ periodo: '2026-01', cliente: 'X; DROP', estabelecimento: '1' })).toMatch(/cliente/);
    expect(
      pedidoDe({
        periodo: '2026-01',
        cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5',
        estabelecimento: '0',
      }),
    ).toMatch(/estabelecimento/);
    expect(
      pedidoDe({
        periodo: '2026-01',
        cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5',
        estabelecimento: '7',
      }),
    ).toEqual({
      cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5',
      estabelecimento: 7,
      periodo: '2026-01',
    });
  });

  it('recusa --empresa: a empresa contábil é o estabelecimento (separada, a porta leria zero fatos)', () => {
    expect(
      pedidoDe({
        periodo: '2026-01',
        cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5',
        estabelecimento: '7',
        empresa: '1',
      }),
    ).toMatch(/empresa/);
    expect(
      pedidoDe({
        periodo: '2026-01',
        cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5',
        estabelecimento: '7',
        empresa: '7',
      }),
    ).toMatch(/empresa/);
  });
});

describe('reprocessar (dublês do núcleo e da porta)', () => {
  const p = {
    cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5',
    estabelecimento: 7,
    periodo: '2026-01',
  };
  const nucleo = (existe: boolean) =>
    ({
      lerSomente: async (_c: unknown, fn: (l: { uma: () => Promise<unknown> }) => Promise<unknown>) =>
        fn({ uma: async () => (existe ? { id: 7 } : null) }),
    }) as unknown as NucleoDaConferencia;

  it('estabelecimento inexistente: recusa com 64, sem ler o período', async () => {
    const { fonte, pedidos } = dubleDe([{ idFato: 1, situacao: 'pendente' }]);
    const r = await reprocessar(nucleo(false), fonte, p);
    expect(r.saida).toBe(SAIDA.uso);
    expect(r.texto).toMatch(/não existe/);
    expect(pedidos.teto).toBeUndefined();
  });

  it('zero fatos lidos: SEM FATOS com saída 3, nunca IDÊNTICO', async () => {
    const { fonte } = dubleDe([]);
    const r = await reprocessar(nucleo(true), fonte, p);
    expect(r.saida).toBe(SAIDA.semFatos);
    expect(r.texto).toContain('SEM FATOS');
    expect(r.texto).not.toContain('IDÊNTICO');
  });

  it('modelo pendente na porta: saída 69 com a mensagem da operação; outro erro sobe', async () => {
    const { fonte } = dubleDe([]);
    const pendente = Object.assign(new Error('x'), {
      problema: { codigo: 'modelo-pendente', detail: 'As regras aguardam.' },
    });
    const r = await reprocessar(nucleo(true), { ...fonte, regras: () => Promise.reject(pendente) }, p);
    expect(r).toEqual({
      saida: SAIDA.indisponivel,
      texto: 'conferência indisponível no banco do cliente: As regras aguardam.',
    });
    await expect(
      reprocessar(nucleo(true), { ...fonte, regras: () => Promise.reject(new Error('falha')) }, p),
    ).rejects.toThrow('falha');
  });
});
