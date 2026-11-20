// Regra 11 (unidade): o fato do legado chega por leitura incremental com a chave anti-duplicação (a mesma versão do
// fato, relida pela sobreposição, não gera outro evento); só o fato que um parceiro ativo assina é lido; a marca anda
// na mesma transação dos eventos; a carga leva só IDs.
import { chaveEvento } from '@sgh/legado';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const b = vi.hoisted(() => ({
  parceiros: [] as { codigo: string; ativo: boolean; eventos: string[] }[],
  marca: { ultimoId: '0', ultimoCarimbo: null as Date | null, lidos: 0 },
  fatos: [] as { id: number; carimbo: Date | null; atendimento: number; paciente: number; ato: number }[],
  outbox: new Map<string, { tipo: string; carga: Record<string, unknown> }>(),
  desdes: [] as (Date | null)[],
  lidos: 0,
}));

vi.mock('@sgh/legado', async (original) => {
  const o = await original<typeof import('@sgh/legado')>();
  // O mesmo contrato da consulta (OpcoesLeituraFato): ordem (carimbo, ID), FIRST lote, o avanço pela chave composta e
  // a releitura limitada pela marca.
  const ler = async (
    _l: unknown,
    desde: Date | null,
    lote: number,
    o: { depoisDoId?: number; ate?: Date } = {},
  ) => {
    b.desdes.push(desde);
    b.lidos++;
    return b.fatos
      .filter((f) => f.carimbo)
      .filter((f) => !desde || f.carimbo! >= desde)
      .filter(
        (f) =>
          o.depoisDoId === undefined ||
          !desde ||
          f.carimbo!.getTime() > desde.getTime() ||
          f.id > o.depoisDoId,
      )
      .filter((f) => !o.ate || f.carimbo! <= o.ate)
      .sort((x, y) => x.carimbo!.getTime() - y.carimbo!.getTime() || x.id - y.id)
      .slice(0, lote);
  };
  return {
    ...o,
    lerParceiros: async () => b.parceiros,
    lerMarcaFato: async () => b.marca,
    fatosResultadoLiberado: ler,
    fatosExameApoio: ler,
    outboxTemChave: async (_l: unknown, k: string) => b.outbox.has(k),
    gravarOutbox: async (
      _e: unknown,
      ev: { tipo: string; chave: string; carga: Record<string, unknown> },
    ) => {
      b.outbox.set(o.chaveEvento(ev.chave), { tipo: ev.tipo, carga: ev.carga });
      return String(b.outbox.size);
    },
    gravarMarcaFato: async (
      _e: unknown,
      _h: string,
      _f: string,
      m: { ultimoId: string; ultimoCarimbo: Date | null; lidos: number },
    ) => {
      b.marca = { ...m, lidos: b.marca.lidos + m.lidos };
    },
  };
});

const { cicloVigiaFatos, proximaMarca } = await import('./vigia-fatos.js');
const acesso = {
  ler: <T>(_h: string, fn: (l: never) => Promise<T>) => fn({} as never),
  gravar: <T>(_h: string, fn: (e: never) => Promise<T>) => fn({} as never),
};

beforeEach(() => {
  b.parceiros = [];
  b.marca = { ultimoId: '0', ultimoCarimbo: null, lidos: 0 };
  b.fatos = [];
  b.outbox.clear();
  b.desdes = [];
  b.lidos = 0;
});

describe('vigia dos fatos (regra 11)', () => {
  it('sem parceiro ativo que assine, nada é lido', async () => {
    b.parceiros = [{ codigo: 'x', ativo: false, eventos: ['fato.resultado.liberado'] }];
    expect(await cicloVigiaFatos(acesso, 'rede', 'pc', 100)).toEqual([]);
    expect(b.lidos).toBe(0);
  });

  it('a mesma versão relida não duplica; a versão nova do mesmo exame gera outro evento; a marca anda', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    const t1 = new Date('2026-10-22T10:00:00Z');
    b.fatos = [
      { id: 10, carimbo: t1, atendimento: 7, paciente: 5, ato: 15 },
      { id: 11, carimbo: t1, atendimento: 8, paciente: 6, ato: 15 },
    ];
    const r1 = await cicloVigiaFatos(acesso, 'rede', 'pc', 100);
    expect(r1).toEqual([{ fato: 'resultado.liberado', lidos: 2, eventos: 2, repetidos: 0 }]);
    expect(b.marca.ultimoCarimbo).toEqual(t1);
    // A releitura recua a sobreposição (5 s) e as já vistas não viram evento de novo.
    const r2 = await cicloVigiaFatos(acesso, 'rede', 'pc', 100);
    expect(r2[0]).toMatchObject({ lidos: 2, eventos: 0, repetidos: 2 });
    expect(b.desdes.at(-1)).toEqual(new Date(t1.getTime() - 5_000));
    // O exame 10 mudou (novo carimbo): outro evento, com outra chave.
    b.fatos = [{ id: 10, carimbo: new Date('2026-10-22T10:05:00Z'), atendimento: 7, paciente: 5, ato: 15 }];
    expect((await cicloVigiaFatos(acesso, 'rede', 'pc', 100))[0]).toMatchObject({ eventos: 1 });
    expect(b.outbox.size).toBe(3);
    const ev = [...b.outbox.values()][0]!;
    expect(ev.tipo).toBe('fato.resultado.liberado');
    expect(ev.carga).toEqual({ exame: 10, paciente: 5, atendimento: 7, ato: 15 });
    expect(b.outbox.has(chaveEvento('fato:resultado.liberado:pc:10:20261022100000000'))).toBe(true);
  });

  it('mais linhas no mesmo carimbo do que o lote: a marca anda por (carimbo, ID) e todas viram evento', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    const t1 = new Date('2026-10-22T11:00:00Z');
    // 25 exames liberados no mesmo segundo (o analisador em massa), lote de 10, e 3 logo depois.
    b.fatos = [
      ...Array.from({ length: 25 }, (_, i) => ({
        id: 100 + i,
        carimbo: t1,
        atendimento: 1,
        paciente: 2,
        ato: 3,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: 50 + i,
        carimbo: new Date(t1.getTime() + 1_000),
        atendimento: 1,
        paciente: 2,
        ato: 3,
      })),
    ];
    const marcas: string[] = [];
    for (let i = 0; i < 6; i++) {
      await cicloVigiaFatos(acesso, 'rede', 'pc', 10);
      marcas.push(`${b.marca.ultimoCarimbo?.toISOString()}#${b.marca.ultimoId}`);
    }
    expect(b.outbox.size).toBe(28);
    // 1º: 100–109; 2º: 110–119; 3º: 120–124 e os 3 do segundo seguinte (o ID menor, carimbo maior).
    expect(marcas.slice(0, 3)).toEqual([
      '2026-10-22T11:00:00.000Z#109',
      '2026-10-22T11:00:00.000Z#119',
      '2026-10-22T11:00:01.000Z#52',
    ]);
    // Parada no fim: a marca não recua nem anda sem linha nova.
    expect(marcas[5]).toBe('2026-10-22T11:00:01.000Z#52');
  });

  it('a releitura da sobreposição pega a gravação atrasada e não move a marca', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    const t1 = new Date('2026-10-22T12:00:00Z');
    b.marca = { ultimoId: '500', ultimoCarimbo: t1, lidos: 0 };
    // A transação gravou 2 s antes da marca e só confirmou agora.
    b.fatos = [{ id: 7, carimbo: new Date(t1.getTime() - 2_000), atendimento: 1, paciente: 2, ato: 3 }];
    expect((await cicloVigiaFatos(acesso, 'rede', 'pc', 10))[0]).toMatchObject({ lidos: 1, eventos: 1 });
    expect(b.marca).toMatchObject({ ultimoId: '500', ultimoCarimbo: t1 });
  });

  it('proximaMarca nunca recua', () => {
    const t = new Date('2026-10-22T12:00:00Z');
    const m = { ultimoId: '10', ultimoCarimbo: t };
    const f = (id: number, c: Date) => ({ id, carimbo: c, atendimento: 0, paciente: 0, ato: 0 });
    expect(proximaMarca(m, f(5, new Date(t.getTime() - 1)))).toEqual(m);
    expect(proximaMarca(m, f(9, t))).toEqual(m);
    expect(proximaMarca(m, f(11, t))).toEqual({ ultimoId: '11', ultimoCarimbo: t });
    expect(proximaMarca(m, undefined)).toEqual(m);
    expect(proximaMarca({ ultimoId: '0', ultimoCarimbo: null }, f(3, t))).toEqual({
      ultimoId: '3',
      ultimoCarimbo: t,
    });
  });
});
